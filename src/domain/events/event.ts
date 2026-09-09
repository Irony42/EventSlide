import { DomainError } from '../shared/errors'
import { err, ok, type Result } from '../shared/result'
import type { EventId, UserId } from '../shared/ids'
import type { JoinCode } from '../shared/joinCode'
import type { Slug } from '../shared/slug'
import type { EventName } from './eventName'
import type { EventSettings } from './eventSettings'
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
}

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
   */
  hasQuotaFor(additionalBytes: number, usedBytes: number): boolean {
    return additionalBytes <= this.remainingQuota(usedBytes)
  }

  /**
   * Clamped at zero. Usage can legitimately exceed the quota — the host lowered it
   * after the party — and a negative "remaining" shown to a guest, or fed back into
   * this arithmetic, is worse than an honest nothing left.
   */
  remainingQuota(usedBytes: number): number {
    return Math.max(0, this.props.quotaBytes - usedBytes)
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
