import type { ClientCeilings } from '../../domain/clients/clientCeilings'
import type { Event } from '../../domain/events/event'
import type { EventStatus } from '../../domain/events/eventStatus'
import type { DomainError } from '../../domain/shared/errors'
import type { EventId, UserId } from '../../domain/shared/ids'
import type { JoinCode } from '../../domain/shared/joinCode'
import type { Result } from '../../domain/shared/result'
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

/**
 * What the purge needs from configuration that the rows themselves do not carry.
 *
 * A policy rather than a bare number, so the next knob is a field and not a third
 * positional argument on a method whose two existing ones are both `Date`-shaped.
 */
export interface PurgePolicy {
  /**
   * `RETENTION_CAP_NOTICE_DAYS`: how long after a client's retention ceiling was lowered
   * an event under it may not yet be purged on that ceiling's account. See `purgeDeadline`.
   */
  readonly capNoticeDays: number
}

/** The membership a new event is created with: its creator, as owner. */
export interface EventOwnerGrant {
  readonly userId: UserId
  readonly grantedAt: Date
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

  /**
   * Insert or update. The unique indexes on slug and join code are the real guard.
   *
   * **Last write wins, over the whole row — except `client_id`**, which is written when the
   * row is created and by nothing else: which client an event answers to decides which
   * ceilings bind it, so a `save` of a copy read before a handover must not undo it. And a
   * `save` that **creates** a row inserts the `client_id` it is given with no ceiling check, no
   * counting and no owner: creating an event is {@link EventRepository.createWithOwner},
   * and `save` is for the aggregate's later changes (and for fixtures).
   *
   * There is no version column and no compare-and-set, which is safe only because the
   * production adapter is synchronous and single-process: `applyEventSchedules` does a
   * read-modify-write over this method and would otherwise be able to revert a concurrent
   * rename. An adapter that is genuinely asynchronous or admits a second writer has to add
   * optimistic concurrency and revisit that use case — the reasoning is written out there.
   */
  save(event: Event): Promise<void>

  /**
   * Creates an event: the event row, its creator's owner membership and — for an event
   * that belongs to a client — the client's creation counter, as **one atomic step**.
   *
   * It exists because those writes used to be three calls with an `await` between each: an
   * event saved and then a failure granting its owner left an event nobody could open, and
   * two requests creating events for one client at the same moment both read a count under
   * the ceiling and both wrote. The adapter does the whole of it inside one write
   * transaction, so a failure anywhere leaves no row and no count behind, and the ceilings
   * are compared against the very rows that the insert then changes.
   *
   * What it checks, in the same transaction as it writes, for an event whose
   * {@link Event.clientId} is set (roadmap §10.5 / P3-05):
   *
   * - the client's events now, **every status**, against `ceilings.maxEvents` — deleting an
   *   event frees a slot of this one;
   * - `clients.events_created_in_period` against `ceilings.maxEventsPerPeriod` — and that
   *   counter is incremented here, by this call and by nothing else. **It never
   *   decreases**: {@link EventRepository.delete} does not touch it, so create, delete,
   *   recreate cannot walk around the ceiling.
   *
   * A refusal is a `Result`, `409 client.ceilingReached {ceiling, used, max}`, and nothing
   * was written. `ceilings` is the event's client's own and is **ignored** for an event with
   * no client, which writes no counter and meets no ceiling: pass
   * `ClientCeilings.unlimited()`.
   *
   * Everything else throws, as {@link EventRepository.save} does: a slug or join code
   * another event holds (the unique indexes are the real guard), an owner or a client that
   * does not exist (foreign keys), an id already taken. None of those leaves a partial
   * write either.
   */
  createWithOwner(
    event: Event,
    owner: EventOwnerGrant,
    ceilings: ClientCeilings,
  ): Promise<Result<void, DomainError>>

  /**
   * Removes the event and, through `ON DELETE CASCADE`, its photos, guests, reactions
   * and memberships in one transaction. Media files are deleted separately by the use
   * case, because the filesystem is not part of that transaction.
   */
  delete(id: EventId): Promise<void>

  slugTaken(slug: Slug): Promise<boolean>

  joinCodeTaken(code: JoinCode): Promise<boolean>

  /**
   * Closed or archived events whose purge deadline has passed.
   *
   * The deadline is `purgeDeadline` in the domain, and an event with a client is judged
   * against that client's ceilings: the host's own retention, **and** the client's
   * `max_retention_days` (so an event kept "for ever" is not kept for ever), **and** the
   * bound that a reopening cannot move (`opened_at + max_live_days + max_retention_days`),
   * **and** the notice a lowered ceiling is owed, **and** the client's `purge_after`. An
   * event with no client is judged on its own retention alone, exactly as before there were
   * clients, and one kept for ever is never listed.
   *
   * **No `NULL` anywhere makes an event undue that should be due**, or crashes the listing:
   * every one of those inputs may be absent and each absent one simply contributes nothing.
   *
   * Both implementations answer the same `now >= deadline`, and the contract suite runs one
   * table of scenarios through them and `purgeDeadline` together.
   */
  listDueForPurge(now: Date, policy: PurgePolicy): Promise<readonly Event[]>

  /**
   * Live events that belong to a client: the candidates for closing an event whose client's
   * live window has run out (`max_live_days`, roadmap §10.5 / G2-05).
   *
   * A **narrowing**, in the way {@link EventRepository.listDueForSchedule} is: which rows are
   * worth looking at, not whether any of them is due. The deadline is
   * `ClientCeilings.liveWindowOver`, applied by the caller, so it has one spelling; the cost
   * is reading every live event of a client each sweep, which is the events a box is serving
   * right now and not an archive. An event with no client has no window and is never listed.
   * Newest first, like every listing here.
   */
  listLiveOfClients(): Promise<readonly Event[]>

  /**
   * Events carrying a scheduled opening or closing whose instant has passed.
   *
   * `<=`, never `=`: the sweep that should have run at 18:00 may not have run at all,
   * and an event that stayed shut because the box was rebooting is the defect this
   * exists to remove. Whether the transition is legal is the aggregate's business —
   * this only narrows the rows worth looking at.
   */
  listDueForSchedule(now: Date): Promise<readonly Event[]>
}
