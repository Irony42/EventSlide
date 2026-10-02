import type { ClientCeilings } from '../../domain/clients/clientCeilings'
import { Event } from '../../domain/events/event'
import { DomainError } from '../../domain/shared/errors'
import type { ClientId, EventId, UserId } from '../../domain/shared/ids'
import type { JoinCode } from '../../domain/shared/joinCode'
import { err, ok, type Result } from '../../domain/shared/result'
import type { Slug } from '../../domain/shared/slug'
import { purgeDeadline } from '../../domain/clients/purgeDeadline'
import type {
  EventOwnerGrant,
  EventRepository,
  EventSummary,
  PurgePolicy,
} from '../ports/eventRepository'
import type { GuestRepository } from '../ports/guestRepository'
import type { PhotoRepository } from '../ports/photoRepository'
import type { MembershipRepository, UserRepository } from '../ports/userRepository'
import type { FakeClientRepository } from './fakeClientRepository'

/**
 * In-memory `EventRepository`.
 *
 * The uniqueness rules are the point of this double. Slug and join code are unique
 * across every event (`idx_events_slug`, `idx_events_join_code`), and the join code
 * has to be, because `/join/:code` resolves without knowing which event it belongs to:
 * a collision sends a guest to the wrong party, which is precisely the 1.0 defect
 * where every guest silently uploaded to a default event. A double that accepted a
 * duplicate would let a use case ship without the collision retry it needs.
 */

/** Code-unit order, not locale order: an id sort must not depend on the host's ICU. */
const compareIds = (left: string, right: string): number =>
  Number(left > right) - Number(left < right)

const newestFirst = (left: Event, right: Event): number =>
  right.createdAt.getTime() - left.createdAt.getTime() || compareIds(left.id, right.id)

/**
 * `listForUser` returns a dashboard row, which in SQLite is a join over memberships,
 * photos and guests. Passing the neighbouring repositories in keeps that shape honest
 * instead of inventing counts; each is optional so a test that only cares about
 * ownership constructs the fake with no arguments and reads zeros.
 */
export interface FakeEventRepositoryLinks {
  /**
   * Where `createWithOwner` writes the creator's owner membership. Required for that
   * method, which throws without it rather than create an event nobody can open — the very
   * defect the method exists to remove.
   */
  readonly memberships?: MembershipRepository
  readonly photos?: PhotoRepository
  readonly guests?: GuestRepository
  /**
   * The clients an event may belong to: read for the creation counter, linked to each
   * event that has one, and unlinked when it is deleted. Required to create or store an
   * event **with** a client, which throws without it rather than skip a ceiling.
   */
  readonly clients?: FakeClientRepository
  /**
   * The accounts `createWithOwner` may name as an owner. With it linked, an owner who is not
   * an account is refused as the adapter's foreign key refuses it; without it the fake has
   * no accounts to check and accepts any id, which is the same limit
   * `FakeMembershipRepository` documents for its own `users` link.
   */
  readonly users?: UserRepository
}

export class FakeEventRepository implements EventRepository {
  private readonly rows = new Map<EventId, Event>()

  constructor(private readonly links: FakeEventRepositoryLinks = {}) {}

  /** Enforces the same uniqueness `save` does: a colliding fixture is a broken test. */
  seed(...events: readonly Event[]): this {
    for (const event of events) this.insert(event)
    return this
  }

  /** Throws what the unique indexes would, and writes nothing. */
  private assertFree(event: Event): void {
    for (const row of this.rows.values()) {
      if (row.id === event.id) continue
      // The messages mirror better-sqlite3's, so a rejection reads the same way
      // against either implementation.
      if (row.slug.equals(event.slug)) {
        throw new Error(`UNIQUE constraint failed: events.slug (${event.slug.value})`)
      }
      if (row.joinCode.equals(event.joinCode)) {
        throw new Error(`UNIQUE constraint failed: events.join_code (${event.joinCode.value})`)
      }
    }
  }

  /**
   * `save` and `seed`: an upsert that, like the adapter's, never changes the client an
   * event already has — which client an event answers to is fixed when it is created.
   */
  private insert(event: Event): void {
    this.assertFree(event)
    const existing = this.rows.get(event.id)
    const stored =
      existing === undefined
        ? event
        : Event.restore({ ...event.toProps(), clientId: existing.clientId })
    if (stored.clientId !== null) {
      // events.client_id is a foreign key: SQLite refuses an event naming no client.
      this.requireExistingClient(stored.clientId).linkEvent(stored.id, stored.clientId)
    }
    this.rows.set(stored.id, stored)
  }

  /** `requireClients()`, and the client has to exist — the foreign key on `events.client_id`. */
  private requireExistingClient(clientId: ClientId): FakeClientRepository {
    const clients = this.requireClients()
    if (clients.peek(clientId) === undefined) {
      throw new Error(`FOREIGN KEY constraint failed: events.client_id (${clientId})`)
    }
    return clients
  }

  private requireClients(): FakeClientRepository {
    if (this.links.clients === undefined) {
      throw new Error(
        'FakeEventRepository: an event with a client needs the clients fake linked, or its ceilings and counter would be silently skipped',
      )
    }
    return this.links.clients
  }

  async findById(id: EventId): Promise<Event | null> {
    return this.rows.get(id) ?? null
  }

  async findBySlug(slug: Slug): Promise<Event | null> {
    return [...this.rows.values()].find((event) => event.slug.equals(slug)) ?? null
  }

  async findByJoinCode(code: JoinCode): Promise<Event | null> {
    return [...this.rows.values()].find((event) => event.joinCode.equals(code)) ?? null
  }

  /**
   * Events the user owns or moderates, newest first.
   *
   * Ownership is the `events.owner_id` column; moderating is a membership row. Both
   * qualify, because a moderator handed a laptop for the evening still needs the event
   * on their dashboard.
   */
  async listForUser(userId: UserId): Promise<readonly EventSummary[]> {
    const memberOf = new Set<string>()
    if (this.links.memberships !== undefined) {
      for (const membership of await this.links.memberships.listForUser(userId)) {
        memberOf.add(membership.eventId)
      }
    }

    const visible = [...this.rows.values()]
      .filter((event) => event.ownerId === userId || memberOf.has(event.id))
      .sort(newestFirst)

    return Promise.all(visible.map((event) => this.summarise(event)))
  }

  private async summarise(event: Event): Promise<EventSummary> {
    const counts = await this.links.photos?.countsByStatus(event.id)
    const guests = await this.links.guests?.list(event.id)
    return {
      id: event.id,
      slug: event.slug.value,
      name: event.name.value,
      status: event.status,
      photoCount:
        counts === undefined
          ? 0
          : counts.pending + counts.published + counts.rejected + counts.hidden,
      pendingCount: counts?.pending ?? 0,
      guestCount: guests?.length ?? 0,
      usedBytes: (await this.links.photos?.totalBytes(event.id)) ?? 0,
      createdAt: event.createdAt,
    }
  }

  async save(event: Event): Promise<void> {
    this.insert(event)
  }

  /**
   * The adapter's transaction, kept honest in two ways.
   *
   * **Everything that can refuse is decided, and the rows written, without an `await` in
   * between.** SQLite gets that from `.immediate()` and a synchronous driver; a fake that
   * read the client's counter, `await`ed something and then wrote would let a second
   * creation read the same count — two events for a client at `max_events=1`, which is
   * exactly the race the transaction exists to remove, and which the contract's concurrent
   * case would otherwise only ever exercise against the adapter. So the one `await` that
   * writes (the owner's membership) comes **after** the event and the counter are reserved,
   * and undoes the reservation if it throws: a failing neighbour leaves no event, no owner
   * and no count, the same end state a rollback gives.
   */
  async createWithOwner(
    event: Event,
    owner: EventOwnerGrant,
    ceilings: ClientCeilings,
  ): Promise<Result<void, DomainError>> {
    const memberships = this.links.memberships
    if (memberships === undefined) {
      throw new Error(
        'FakeEventRepository.createWithOwner needs the memberships fake linked: the owner is part of the creation',
      )
    }
    // The one read that may wait: an owner that is not an account is a foreign key in
    // SQLite. It decides nothing about the ceilings, so it sits before the atomic section.
    if (
      this.links.users !== undefined &&
      (await this.links.users.findById(owner.userId)) === null
    ) {
      throw new Error(`FOREIGN KEY constraint failed: event_memberships.user_id (${owner.userId})`)
    }

    // ---- no await from here until the event and the counter are written ----------------
    if (this.rows.has(event.id)) {
      throw new Error(`UNIQUE constraint failed: events.id (${event.id})`)
    }
    this.assertFree(event)

    const clientId = event.clientId
    const clients = clientId === null ? null : this.requireExistingClient(clientId)
    if (clients !== null && clientId !== null) {
      const total = [...this.rows.values()].filter((row) => row.clientId === clientId).length
      const counted = clients.peek(clientId)?.eventsCreatedInPeriod ?? 0
      const refusal = ceilings.creationRefusal(total, counted)
      if (refusal !== null) {
        return err(
          DomainError.conflict('client.ceilingReached', {
            ceiling: refusal.ceiling,
            used: refusal.used,
            max: refusal.max,
          }),
        )
      }
    }

    this.rows.set(event.id, event)
    if (clients !== null && clientId !== null) {
      clients.linkEvent(event.id, clientId).recordEventCreated(clientId)
    }
    // ---- reserved. The owner is the last write, and it can still fail ------------------

    try {
      await memberships.grant({
        eventId: event.id,
        userId: owner.userId,
        role: 'owner',
        grantedAt: owner.grantedAt,
      })
    } catch (cause) {
      this.rows.delete(event.id)
      if (clients !== null && clientId !== null) {
        clients.unlinkEvent(event.id).undoEventCreated(clientId)
      }
      throw cause
    }
    return ok(undefined)
  }

  /** Idempotent. The cascade to photos, guests, reactions and memberships is the
   *  database's job, and each fake owns its own rows — a purge use case deletes from
   *  each repository explicitly, which is what the adapter's `ON DELETE CASCADE` test
   *  covers. The one thing it does that cascade is not: it drops the client link, because
   *  that link *is* `events.client_id` and goes with the row. It never touches the
   *  creation counter, exactly as the adapter does not. */
  async delete(id: EventId): Promise<void> {
    this.rows.delete(id)
    this.links.clients?.unlinkEvent(id)
  }

  async slugTaken(slug: Slug): Promise<boolean> {
    return (await this.findBySlug(slug)) !== null
  }

  async joinCodeTaken(code: JoinCode): Promise<boolean> {
    return (await this.findByJoinCode(code)) !== null
  }

  /**
   * The deadline is `purgeDeadline`, which the adapter spells again in SQL; the contract
   * suite is what holds the two to one answer. An event with a client is judged against that
   * client's current row, read synchronously from the linked clients fake. Ordered like every
   * other listing here.
   */
  async listDueForPurge(now: Date, policy: PurgePolicy): Promise<readonly Event[]> {
    const due = [...this.rows.values()].filter((event) => {
      const client =
        event.clientId === null ? null : (this.requireClients().peek(event.clientId) ?? null)
      const deadline = purgeDeadline(event, client, policy.capNoticeDays)
      return deadline !== null && now.getTime() >= deadline.getTime()
    })
    return due.sort(newestFirst)
  }

  /** Live, and with a client: the adapter's `WHERE status = 'live' AND client_id IS NOT NULL`. */
  async listLiveOfClients(): Promise<readonly Event[]> {
    return [...this.rows.values()]
      .filter((event) => event.status === 'live' && event.clientId !== null)
      .sort(newestFirst)
  }

  /**
   * Unlike `listDueForPurge`, this one *is* expressible as a SQL predicate — the two
   * instants are their own columns — so the adapter narrows in the database and this
   * asks the entity. Both answer the same `now >= instant`, and the contract suite is
   * what keeps them saying so.
   */
  async listDueForSchedule(now: Date): Promise<readonly Event[]> {
    return [...this.rows.values()].filter((event) => event.hasDueSchedule(now)).sort(newestFirst)
  }
}
