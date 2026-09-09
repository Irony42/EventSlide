import type { Event } from '../../domain/events/event'
import type { EventStatus } from '../../domain/events/eventStatus'
import type { EventId, UserId } from '../../domain/shared/ids'
import type { JoinCode } from '../../domain/shared/joinCode'
import type { Slug } from '../../domain/shared/slug'

/**
 * A host's dashboard row. Deliberately not an `Event`: listing twenty events must not
 * mean hydrating twenty aggregates plus their settings, and the dashboard needs counts
 * the aggregate does not carry.
 */
export interface EventSummary {
  readonly id: EventId
  readonly slug: string
  readonly name: string
  readonly status: EventStatus
  readonly photoCount: number
  readonly pendingCount: number
  readonly guestCount: number
  readonly usedBytes: number
  readonly createdAt: Date
}

export interface EventRepository {
  findById(id: EventId): Promise<Event | null>

  /** Resolves `/e/:slug`. */
  findBySlug(slug: Slug): Promise<Event | null>

  /**
   * Resolves `/join/:code`. Separate from `findBySlug` so the join endpoint can be
   * rate-limited on its own — it is the one lookup an attacker would enumerate.
   */
  findByJoinCode(code: JoinCode): Promise<Event | null>

  /** Events the user owns or moderates, newest first. */
  listForUser(userId: UserId): Promise<readonly EventSummary[]>

  /** Insert or update. The unique indexes on slug and join code are the real guard. */
  save(event: Event): Promise<void>

  /**
   * Removes the event and, through `ON DELETE CASCADE`, its photos, guests, reactions
   * and memberships in one transaction. Media files are deleted separately by the use
   * case, because the filesystem is not part of that transaction.
   */
  delete(id: EventId): Promise<void>

  slugTaken(slug: Slug): Promise<boolean>

  joinCodeTaken(code: JoinCode): Promise<boolean>

  /** Closed or archived events whose retention deadline has passed. */
  listDueForPurge(now: Date): Promise<readonly Event[]>
}
