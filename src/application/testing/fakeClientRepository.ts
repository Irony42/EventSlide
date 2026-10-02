import type { Client } from '../../domain/clients/client'
import type { ClientId, EventId, UserId } from '../../domain/shared/ids'
import type {
  ClientEventContext,
  ClientMembership,
  ClientPage,
  ClientRepository,
  ClientRole,
} from '../ports/clientRepository'

/**
 * In-memory `ClientRepository`.
 *
 * `events.client_id` belongs to `Event`, wired starting at G2-04/P3-05, so this fake —
 * like the SQLite adapter's `JOIN` — needs a way to answer "which client owns this
 * event" without owning the events table itself. {@link FakeClientRepository.linkEvent}
 * is that link, seeded directly by a test the same way the adapter's own contract test
 * seeds a real `events` row with `client_id` set.
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

  /** See the class doc: the stand-in for `events.client_id` until G2-04 wires it. */
  linkEvent(eventId: EventId, clientId: ClientId): this {
    this.eventClientLinks.set(eventId, clientId)
    return this
  }

  async save(client: Client): Promise<void> {
    this.clients.set(client.id, client)
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
