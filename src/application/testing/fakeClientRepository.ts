import { Client } from '../../domain/clients/client'
import type { ClientRole } from '../../domain/clients/clientRole'
import type { ClientId, EventId, UserId } from '../../domain/shared/ids'
import type {
  ClientEventContext,
  ClientMembership,
  ClientPage,
  ClientRepository,
} from '../ports/clientRepository'

/**
 * In-memory `ClientRepository`.
 *
 * `events.client_id` belongs to `Event`, so this fake — like the SQLite adapter's `JOIN` —
 * needs a way to answer "which client owns this event" without owning the events table
 * itself. {@link FakeClientRepository.linkEvent} is that link. `FakeEventRepository` makes
 * it for every event it stores that has a client, and drops it when the event is deleted,
 * so a world built from the two fakes answers `contextForEvent` and `deleteIfEmpty` the
 * way one database does; a test that wants a link without an event repository makes it by
 * hand, the way the adapter's own contract test writes a real `events` row.
 */

/** Code-unit order, not locale order: an id sort must not depend on the host's ICU. */
const compareIds = (left: string, right: string): number =>
  Number(left > right) - Number(left < right)

/** Newest first, and a tie breaks on id **descending**, as the adapter's `ORDER BY … id DESC`. */
const newestFirst = (left: Client, right: Client): number =>
  right.createdAt.getTime() - left.createdAt.getTime() || compareIds(right.id, left.id)

const key = (clientId: ClientId, userId: UserId): string => `${clientId}:${userId}`

export class FakeClientRepository implements ClientRepository {
  private readonly clients = new Map<ClientId, Client>()
  private readonly memberships = new Map<string, ClientMembership>()
  private readonly eventClientLinks = new Map<EventId, ClientId>()

  seed(...clients: readonly Client[]): this {
    for (const client of clients) this.clients.set(client.id, client)
    return this
  }

  /** See the class doc: the stand-in for `events.client_id`. */
  linkEvent(eventId: EventId, clientId: ClientId): this {
    this.eventClientLinks.set(eventId, clientId)
    return this
  }

  /** The other half of {@link FakeClientRepository.linkEvent}: the event row is gone. */
  unlinkEvent(eventId: EventId): this {
    this.eventClientLinks.delete(eventId)
    return this
  }

  /**
   * A synchronous read, for `FakeEventRepository`'s atomic section: the adapter's creation
   * reads the client's counter and writes the event inside one transaction, and a fake that
   * had to `await` this read would let a second creation in between.
   */
  peek(id: ClientId): Client | undefined {
    return this.clients.get(id)
  }

  /**
   * `clients.events_created_in_period + 1`, which the adapter does in SQL inside
   * `createWithOwner`'s transaction. Not on the port: nothing outside that one call may
   * move the counter, which is the rule that lets it never decrease.
   */
  recordEventCreated(clientId: ClientId): this {
    const client = this.clients.get(clientId)
    if (client === undefined) {
      throw new Error(`FOREIGN KEY constraint failed: events.client_id (${clientId})`)
    }
    this.clients.set(
      clientId,
      Client.restore({
        ...client.toProps(),
        eventsCreatedInPeriod: client.eventsCreatedInPeriod + 1,
      }),
    )
    return this
  }

  /**
   * Insert or update, and — like the adapter — **never lets a save move the per-period
   * counter** unless the period itself moved.
   *
   * The counter is written by exactly one thing, `FakeEventRepository.createWithOwner`
   * (`recordEventCreated`), exactly as the adapter's `createWithOwner` is the only thing that
   * increments the column. A `Client` read before two creations and saved after them
   * carries a stale count, and writing it back would hand those two slots back: so on an
   * update the stored counter wins, and the one exception is a renewal — a changed
   * `periodStartedAt`, which `Client.withCeilings` pairs with a reset to zero — where the
   * incoming counter is the point of the save.
   */
  async save(client: Client): Promise<void> {
    const existing = this.clients.get(client.id)
    const renewed =
      existing === undefined ||
      (existing.ceilings.periodStartedAt?.getTime() ?? null) !==
        (client.ceilings.periodStartedAt?.getTime() ?? null)
    this.clients.set(
      client.id,
      renewed
        ? client
        : Client.restore({
            ...client.toProps(),
            eventsCreatedInPeriod: existing.eventsCreatedInPeriod,
          }),
    )
  }

  /**
   * Takes back one `recordEventCreated`: the **fake's own rollback**, for a creation that
   * counted and then failed to write its owner. The adapter needs no such method — a
   * transaction that throws leaves the counter where it was — and this is not a way for
   * anything else to give a slot back.
   */
  undoEventCreated(clientId: ClientId): this {
    const client = this.clients.get(clientId)
    if (client !== undefined) {
      this.clients.set(
        clientId,
        Client.restore({
          ...client.toProps(),
          eventsCreatedInPeriod: Math.max(0, client.eventsCreatedInPeriod - 1),
        }),
      )
    }
    return this
  }

  async findById(id: ClientId): Promise<Client | null> {
    return this.clients.get(id) ?? null
  }

  /**
   * Keyset-paginated like the adapter: an unknown cursor — one that has since been
   * deleted — yields an empty page rather than silently restarting from the top.
   */
  async list(page: { readonly after?: ClientId; readonly limit: number }): Promise<ClientPage> {
    const sorted = [...this.clients.values()].sort(newestFirst)

    let startIndex = 0
    if (page.after !== undefined) {
      const index = sorted.findIndex((client) => client.id === page.after)
      if (index === -1) return { items: [], next: null }
      startIndex = index + 1
    }

    const slice = sorted.slice(startIndex, startIndex + page.limit + 1)
    const hasMore = slice.length > page.limit
    const items = hasMore ? slice.slice(0, page.limit) : slice
    const last = items[items.length - 1]
    return { items, next: hasMore && last !== undefined ? last.id : null }
  }

  async membershipsForUser(userId: UserId): Promise<readonly ClientMembership[]> {
    return [...this.memberships.values()]
      .filter((membership) => membership.userId === userId)
      .sort(
        (left, right) =>
          right.grantedAt.getTime() - left.grantedAt.getTime() ||
          compareIds(left.clientId, right.clientId),
      )
  }

  async memberRole(clientId: ClientId, userId: UserId): Promise<ClientRole | null> {
    return this.memberships.get(key(clientId, userId))?.role ?? null
  }

  /** Upsert on `(clientId, userId)`, replacing `grantedAt`: a re-grant is a fresh decision. */
  async grantMember(membership: ClientMembership): Promise<void> {
    // `client_members.client_id` is a foreign key: SQLite refuses a roster row for a client
    // that was never saved, and a fake that stored it would pass the tests of whatever
    // grants a member (G2-09) and then fail in production. The user half cannot be
    // mirrored, because this fake owns no users.
    if (!this.clients.has(membership.clientId)) {
      throw new Error(
        `FOREIGN KEY constraint failed: client_members.client_id (${membership.clientId})`,
      )
    }
    this.memberships.set(key(membership.clientId, membership.userId), membership)
  }

  async revokeMember(clientId: ClientId, userId: UserId): Promise<void> {
    this.memberships.delete(key(clientId, userId))
  }

  async contextForEvent(eventId: EventId): Promise<ClientEventContext | null> {
    const clientId = this.eventClientLinks.get(eventId)
    if (clientId === undefined) return null

    const client = this.clients.get(clientId)
    // The repository trusts the link, exactly as `events.client_id`'s own foreign key
    // does: a test that links an event must seed the client it links to.
    if (client === undefined) {
      throw new Error(`linkEvent(${eventId}, ${clientId}): no such client was seeded`)
    }

    return { clientId, ceilings: client.ceilings, suspended: client.isSuspended() }
  }

  /**
   * Empty means no membership row and no linked event, mirroring the adapter's atomic
   * `DELETE … WHERE NOT EXISTS (…)`. `Map.delete` already reports "did a row exist and
   * get removed", which is exactly `changes > 0`.
   */
  async deleteIfEmpty(id: ClientId): Promise<boolean> {
    const hasMember = [...this.memberships.values()].some(
      (membership) => membership.clientId === id,
    )
    if (hasMember) return false

    const hasEvent = [...this.eventClientLinks.values()].some((clientId) => clientId === id)
    if (hasEvent) return false

    return this.clients.delete(id)
  }
}
