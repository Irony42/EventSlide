import { DomainError } from '../shared/errors'
import { err, ok, type Result } from '../shared/result'
import type { EventId, UserId } from '../shared/ids'
import type { JoinCode } from '../shared/joinCode'
import type { Slug } from '../shared/slug'
import type { EventName } from './eventName'
import type { EventSettings } from './eventSettings'
import { fitsInQuota, remainingQuota } from './quota'
import {
  acceptsGuests,
  acceptsUploads,
  allowsModeration,
  canTransition,
  isMutable,
  retentionApplies,
  servesWall,
  type EventStatus,
} from './eventStatus'

const MS_PER_DAY = 24 * 60 * 60 * 1_000

export interface EventProps {
  readonly id: EventId
  readonly ownerId: UserId
  readonly name: EventName
  readonly slug: Slug
  readonly joinCode: JoinCode
  readonly status: EventStatus
  readonly settings: EventSettings
  readonly quotaBytes: number
  readonly createdAt: Date
  /** When the party starts, for the host's own dashboard. `null` when unscheduled. */
  readonly startsAt: Date | null
  /** When the event stopped running. Starts the retention clock; `null` while it runs. */
  readonly closedAt: Date | null
  /**
   * When the doors should open by themselves, or `null` for "I will open them".
   *
   * Deliberately **not** `startsAt`. That field is the printed start of the party and
   * exists for the host's dashboard: it is set when the event is created, read by no
   * rule, and every event already carrying one was given it by a host who was told it
   * did nothing. Teaching it to move the lifecycle would reach back and open events
   * nobody asked to be opened, and there would be no way to decline — `startsAt` cannot
   * be edited after creation. So the trigger is its own field, empty by default, and
   * turning it on is a choice.
   */
  readonly scheduledOpenAt: Date | null
  /** When the event should close by itself, or `null` for "I will close it". */
  readonly scheduledCloseAt: Date | null
  /**
   * When a sweep last threw a due instant away because the lifecycle refused it.
   *
   * It exists because spending a refused instant is the right call — retrying an
   * impossible transition every few minutes forever is worse — but it silently deletes
   * something the host configured, and they are not watching the screen when it
   * happens. Without this the settings page reads back "no schedule" with no
   * explanation for why the one they set is gone.
   *
   * Cleared by {@link Event.reschedule}: saving any schedule, the empty one included, is
   * the host answering the notice.
   */
  readonly scheduleDiscardedAt: Date | null
}

/**
 * What a host asked for, as two independent instants.
 *
 * Independent because both halves are real arrangements on their own: "open at 18:00,
 * I will close it when the last guest leaves" and "I will open it myself, close it at
 * 02:00" are both things a host says.
 *
 * They are **instants**, not wall-clock times. The venue's timezone is not modelled —
 * the host picks a local time on their own laptop, the browser resolves it to a UTC
 * instant, and the column stores that. See docs/API.md §6.
 */
export interface EventSchedule {
  readonly scheduledOpenAt: Date | null
  readonly scheduledCloseAt: Date | null
}

/** Which half of a schedule a sweep acted on. */
export type ScheduledTransition = 'open' | 'close'

/**
 * The result of letting a due schedule run. Not a `Result`: a refusal is an outcome the
 * caller reports, not a failure of the sweep — an archived event that will not reopen is
 * exactly what the lifecycle rules are for.
 */
export interface ScheduleApplication {
  /** The event after every due instant has been honoured or spent. */
  readonly event: Event
  readonly applied: readonly ScheduledTransition[]
  /** Due, but the lifecycle refused it. The instant is spent either way. */
  readonly refused: readonly ScheduledTransition[]
}

/** A `Date` built from a malformed string is `NaN`, and would store as `null`-ish text. */
const isRealInstant = (at: Date | null): boolean => at === null || Number.isFinite(at.getTime())

const MS_PER_MINUTE = 60_000

/**
 * Whether an instant names a minute that has already gone by.
 *
 * **Judged to the minute, deliberately.** A host picks a minute — that is the
 * granularity of the control they are given and of the `min` attribute on it — so an
 * instant twenty seconds old is the minute they are standing in, not a mistake, and
 * refusing it would make "close at 21:35", typed at 21:34:55 and submitted at 21:35:02,
 * an error message. A minute of tolerance does nothing to the case this guard exists for:
 * it is 21:30, the host picks 02:00, and means tomorrow.
 */
const namesAPastMinute = (at: Date, now: Date): boolean =>
  at.getTime() < Math.floor(now.getTime() / MS_PER_MINUTE) * MS_PER_MINUTE

export interface NewEvent {
  readonly ownerId: UserId
  readonly name: EventName
  readonly slug: Slug
  readonly joinCode: JoinCode
  readonly settings: EventSettings
  readonly quotaBytes: number
  readonly startsAt: Date | null
}

/**
 * One event: a wedding, a conference day, a birthday.
 *
 * Immutable — every transition returns a new instance, so a repository is never handed
 * a half-mutated entity and a use case can compare before and after. Time arrives as a
 * parameter, because the clock is a port.
 */
export class Event {
  private constructor(private readonly props: EventProps) {}

  /**
   * A newly created event, always `draft`.
   *
   * The slug and the join code exist from the first second so the host can print the
   * cards days ahead, but neither resolves for a guest until the host opens the doors
   * with {@link Event.goLive}.
   */
  static create(input: NewEvent, id: EventId, now: Date): Result<Event, DomainError> {
    if (!Number.isInteger(input.quotaBytes) || input.quotaBytes <= 0) {
      return err(DomainError.invalid('event.quotaBytesInvalid'))
    }
    return ok(
      new Event({
        id,
        ownerId: input.ownerId,
        name: input.name,
        slug: input.slug,
        joinCode: input.joinCode,
        status: 'draft',
        settings: input.settings,
        quotaBytes: input.quotaBytes,
        createdAt: now,
        startsAt: input.startsAt,
        closedAt: null,
        // Not part of `NewEvent`: a schedule is a decision the host makes on the event
        // they are looking at, not one more field on a form that asks for a name.
        scheduledOpenAt: null,
        scheduledCloseAt: null,
        scheduleDiscardedAt: null,
      }),
    )
  }

  /**
   * Rehydrate from storage. Trusts the row: the values were validated on the way in and
   * the schema's `CHECK` constraints back that up. Anything malformed here is a corrupt
   * database — a bug to surface loudly, not a user error to model.
   */
  static restore(props: EventProps): Event {
    return new Event(props)
  }

  get id(): EventId {
    return this.props.id
  }

  get ownerId(): UserId {
    return this.props.ownerId
  }

  get name(): EventName {
    return this.props.name
  }

  get slug(): Slug {
    return this.props.slug
  }

  get joinCode(): JoinCode {
    return this.props.joinCode
  }

  get status(): EventStatus {
    return this.props.status
  }

  get settings(): EventSettings {
    return this.props.settings
  }

  get quotaBytes(): number {
    return this.props.quotaBytes
  }

  get createdAt(): Date {
    return this.props.createdAt
  }

  get startsAt(): Date | null {
    return this.props.startsAt
  }

  get closedAt(): Date | null {
    return this.props.closedAt
  }

  get scheduledOpenAt(): Date | null {
    return this.props.scheduledOpenAt
  }

  get scheduledCloseAt(): Date | null {
    return this.props.scheduledCloseAt
  }

  get scheduleDiscardedAt(): Date | null {
    return this.props.scheduleDiscardedAt
  }

  // ----------------------------------------------------------------- lifecycle --

  goLive(at: Date): Result<Event, DomainError> {
    return this.transitionTo('live', at)
  }

  close(at: Date): Result<Event, DomainError> {
    return this.transitionTo('closed', at)
  }

  archive(at: Date): Result<Event, DomainError> {
    return this.transitionTo('archived', at)
  }

  /**
   * The single gate for every status change. A no-op transition succeeds, so a host
   * who clicks the close button twice gets a success rather than a confusing conflict.
   */
  transitionTo(next: EventStatus, at: Date): Result<Event, DomainError> {
    if (!canTransition(this.props.status, next)) {
      return err(
        DomainError.conflict('event.illegalTransition', {
          from: this.props.status,
          to: next,
        }),
      )
    }
    return ok(this.with({ status: next, closedAt: this.closedAtAfter(next, at) }))
  }

  /**
   * `closedAt` is when the event stopped running, and it is what starts the retention
   * clock. Archiving stamps it too: an event archived straight from `live` would
   * otherwise have no clock at all and keep its media forever, which is the
   * disk-filling case retention exists to prevent. Reopening clears it, so a party that
   * restarts after the speeches is not purged on the strength of its first ending — and
   * stamping only when unset keeps a repeated close from moving the purge date.
   */
  private closedAtAfter(next: EventStatus, at: Date): Date | null {
    if (next === 'live') return null
    if (retentionApplies(next)) return this.props.closedAt ?? at
    return this.props.closedAt
  }

  // ------------------------------------------------------------------- schedule --

  /**
   * Set or clear the two instants. `null` on either half means "I will do it myself".
   *
   * Goes through {@link whenMutable}, so an archived event refuses a schedule for the
   * same reason it refuses a rename: it is a record, and arming a timer on it would
   * promise a transition the lifecycle will never make.
   *
   * `now` is what makes the past-instant guard below possible, and it is a parameter
   * because the clock is a port.
   */
  reschedule(schedule: EventSchedule, now: Date): Result<Event, DomainError> {
    const { scheduledOpenAt, scheduledCloseAt } = schedule

    if (!isRealInstant(scheduledOpenAt) || !isRealInstant(scheduledCloseAt)) {
      return err(DomainError.invalid('event.scheduleInvalid'))
    }

    /**
     * An instant that has already gone by is refused **at the moment it is set**.
     *
     * This is the likeliest mistake a host makes with this feature, not a corner case.
     * It is 21:30 and the party is running; the host arms the automatic closing, picks
     * `02:00`, and leaves the date on today rather than advancing it to tomorrow. Every
     * layer would otherwise say yes, and within one sweep the evening ends: uploads
     * refused, `closedAt` stamped, the retention clock started. The mirror case opens a
     * draft event before the host meant anyone in.
     *
     * It does **not** contradict the "deadlines, not appointments" rule that lets a
     * missed 18:00 still open at 18:07. That rule is about an instant that *aged* past
     * while nothing was running, and a stored instant is never re-validated: it is
     * judged once, here, against the clock the host set it by.
     */
    const past = [scheduledOpenAt, scheduledCloseAt].some(
      (at) => at !== null && namesAPastMinute(at, now),
    )
    if (past) return err(DomainError.invalid('event.scheduleInPast'))

    // An event that closes before it opens is not a schedule anybody meant. Refused
    // rather than reordered: guessing which of the two the host mistyped is how a party
    // ends at 02:00 on the wrong night.
    if (
      scheduledOpenAt !== null &&
      scheduledCloseAt !== null &&
      scheduledCloseAt.getTime() <= scheduledOpenAt.getTime()
    ) {
      return err(DomainError.invalid('event.scheduleOutOfOrder'))
    }

    // Saving a schedule — the empty one included — is the host answering the notice that
    // a previous one was thrown away, so it goes with the same write.
    return this.whenMutable({ scheduledOpenAt, scheduledCloseAt, scheduleDiscardedAt: null })
  }

  /**
   * `>=`, not `===`. The instant is a deadline that has passed, not an appointment to
   * be kept: the server may well have been down at 18:00, and an event that stayed shut
   * because nobody was listening at exactly the right minute is the failure this
   * feature exists to remove. A sweep at 18:07 opens it.
   */
  isDueToOpen(now: Date): boolean {
    const at = this.props.scheduledOpenAt
    return at !== null && now.getTime() >= at.getTime()
  }

  isDueToClose(now: Date): boolean {
    const at = this.props.scheduledCloseAt
    return at !== null && now.getTime() >= at.getTime()
  }

  /** What a repository narrows on to find the events a sweep has anything to do with. */
  hasDueSchedule(now: Date): boolean {
    return this.isDueToOpen(now) || this.isDueToClose(now)
  }

  /**
   * Let every instant that has come due run, in the order the evening happens in.
   *
   * Open first, then close, so a server that was down from 17:00 to 03:00 catches up on
   * both in one pass and lands where the host said it would — `closed` — rather than
   * opening a party that finished an hour ago.
   *
   * Every transition goes through {@link transitionTo}, so a scheduled open is refused
   * for exactly the reasons a manual one is. An archived event does not quietly reopen
   * because a timestamp passed.
   *
   * **A due instant is spent whether or not it was honoured.** Clearing it is what makes
   * the sweep idempotent — the second run finds nothing due and changes nothing — and it
   * is also what stops a schedule the lifecycle will never accept being retried every
   * few minutes for the rest of the installation's life. A refusal is recorded on
   * `scheduleDiscardedAt` rather than only in the server's log, because the thing that
   * was thrown away is something the host typed and they are not watching the screen.
   */
  applySchedule(now: Date): ScheduleApplication {
    const outcome: { applied: ScheduledTransition[]; refused: ScheduledTransition[] } = {
      applied: [],
      refused: [],
    }

    const afterOpen = this.isDueToOpen(now)
      ? // A no-op when the event is already live: the transition table allows it, and
        // reporting the schedule as honoured is truer than silently dropping it.
        this.runScheduled('open', 'live', now, outcome, { scheduledOpenAt: null })
      : this

    const afterClose = afterOpen.isDueToClose(now)
      ? afterOpen.runScheduled('close', 'closed', now, outcome, { scheduledCloseAt: null })
      : afterOpen

    const event =
      outcome.refused.length > 0 ? afterClose.with({ scheduleDiscardedAt: now }) : afterClose

    return { event, applied: outcome.applied, refused: outcome.refused }
  }

  /** One half of {@link applySchedule}: try the transition, then spend the instant. */
  private runScheduled(
    transition: ScheduledTransition,
    to: EventStatus,
    now: Date,
    outcome: { applied: ScheduledTransition[]; refused: ScheduledTransition[] },
    spent: Partial<EventProps>,
  ): Event {
    const moved = this.transitionTo(to, now)
    if (moved.ok) outcome.applied.push(transition)
    else outcome.refused.push(transition)
    return (moved.ok ? moved.value : this).with(spent)
  }

  // -------------------------------------------------------------------- editing --

  rename(name: EventName): Result<Event, DomainError> {
    return this.whenMutable({ name })
  }

  withSettings(settings: EventSettings): Result<Event, DomainError> {
    return this.whenMutable({ settings })
  }

  /** For a host who finds the join link circulating outside the venue. */
  rotateJoinCode(joinCode: JoinCode): Result<Event, DomainError> {
    return this.whenMutable({ joinCode })
  }

  /**
   * An archived event is a record, not a live object: its media may have been tiered
   * off, and rotating the join code of an event nobody can join would only print a QR
   * code that leads nowhere.
   */
  private whenMutable(changes: Partial<EventProps>): Result<Event, DomainError> {
    if (!isMutable(this.props.status)) {
      return err(DomainError.conflict('event.immutable', { status: this.props.status }))
    }
    return ok(this.with(changes))
  }

  // --------------------------------------------------------------- capabilities --

  acceptsUploads(): boolean {
    return acceptsUploads(this.props.status)
  }

  acceptsGuests(): boolean {
    return acceptsGuests(this.props.status)
  }

  servesWall(): boolean {
    return servesWall(this.props.status)
  }

  allowsModeration(): boolean {
    return allowsModeration(this.props.status)
  }

  // ---------------------------------------------------------------------- quota --

  /**
   * The control that stops a public upload endpoint filling the disk. Arithmetic, not a
   * query: the caller sums the event's bytes once and asks here, so the decision is
   * testable without a database and identical on every path that accepts a photo.
   *
   * It is *not* the last word, though. A total read before a batch is rendered can be
   * stale by the time that batch is written, so the check that enforces the quota is
   * the one the repository takes inside the write transaction. Both call the same
   * arithmetic in `./quota` so the answer a guest is given and the answer the database
   * acts on cannot differ.
   */
  hasQuotaFor(additionalBytes: number, usedBytes: number): boolean {
    return fitsInQuota(this.props.quotaBytes, usedBytes, additionalBytes)
  }

  /** What is left of the quota, never negative. See `./quota`. */
  remainingQuota(usedBytes: number): number {
    return remainingQuota(this.props.quotaBytes, usedBytes)
  }

  // ------------------------------------------------------------------ retention --

  /**
   * When this event's media becomes eligible for deletion, or `null` if it never does.
   *
   * The clock starts when the event ends, not when it was created, so a wedding booked
   * six months ahead is not purged before it happens. No `retentionDays` means keep the
   * album forever, which is the default. A closed row with no `closedAt` can only come
   * from a hand-edited database; it yields no deadline rather than a wrong one.
   */
  retentionDeadline(): Date | null {
    const retentionDays = this.props.settings.retentionDays
    if (retentionDays === null) return null
    if (!retentionApplies(this.props.status)) return null

    const closedAt = this.props.closedAt
    if (closedAt === null) return null
    return new Date(closedAt.getTime() + retentionDays * MS_PER_DAY)
  }

  isDueForPurge(now: Date): boolean {
    const deadline = this.retentionDeadline()
    return deadline !== null && now.getTime() >= deadline.getTime()
  }

  // -------------------------------------------------------------------- helpers --

  equals(other: Event): boolean {
    return this.props.id === other.props.id
  }

  /** Snapshot for a repository to map into a row. */
  toProps(): EventProps {
    return this.props
  }

  private with(changes: Partial<EventProps>): Event {
    return new Event({ ...this.props, ...changes })
  }
}
