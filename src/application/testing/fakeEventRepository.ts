import type { Event } from '../../domain/events/event'
import type { EventId, UserId } from '../../domain/shared/ids'
import type { JoinCode } from '../../domain/shared/joinCode'
import type { Slug } from '../../domain/shared/slug'
import type { EventRepository, EventSummary } from '../ports/eventRepository'
import type { GuestRepository } from '../ports/guestRepository'
import type { PhotoRepository } from '../ports/photoRepository'
import type { MembershipRepository } from '../ports/userRepository'

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
  readonly memberships?: MembershipRepository
  readonly photos?: PhotoRepository
  readonly guests?: GuestRepository
}

export class FakeEventRepository implements EventRepository {
  private readonly rows = new Map<EventId, Event>()

  constructor(private readonly links: FakeEventRepositoryLinks = {}) {}

  /** Enforces the same uniqueness `save` does: a colliding fixture is a broken test. */
  seed(...events: readonly Event[]): this {
    for (const event of events) this.insert(event)
    return this
  }

  private insert(event: Event): void {
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
    this.rows.set(event.id, event)
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

  /** Idempotent. The cascade to photos, guests, reactions and memberships is the
   *  database's job, and each fake owns its own rows — a purge use case deletes from
   *  each repository explicitly, which is what the adapter's `ON DELETE CASCADE` test
   *  covers. */
  async delete(id: EventId): Promise<void> {
    this.rows.delete(id)
  }

  async slugTaken(slug: Slug): Promise<boolean> {
    return (await this.findBySlug(slug)) !== null
  }

  async joinCodeTaken(code: JoinCode): Promise<boolean> {
    return (await this.findByJoinCode(code)) !== null
  }

  /**
   * The retention deadline depends on `settings.retentionDays`, which lives in a JSON
   * column, so neither implementation can express this as a pure SQL predicate: the
   * adapter narrows on `(status, closed_at)` and then asks the entity, exactly as this
   * does. Ordered like every other listing here.
   */
  async listDueForPurge(now: Date): Promise<readonly Event[]> {
    return [...this.rows.values()].filter((event) => event.isDueForPurge(now)).sort(newestFirst)
  }
}
