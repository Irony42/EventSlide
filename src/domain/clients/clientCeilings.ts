import { DomainError } from '../shared/errors'
import { err, ok, type Result } from '../shared/result'

/**
 * What an operator lets one client do (roadmap §10.5), expressed once so every write
 * path asks the same arithmetic instead of restating the rule.
 *
 * **Every bound here is `NULL`-means-"no ceiling", per the paid plan's "Schéma des
 * clients" (P3-04).** That is the free tier's own answer too: a solo installation has
 * exactly one client-shaped thing — nobody — so every ceiling on it is absent, and
 * `allowsAnotherEvent`, `admitsQuota` and the rest all answer "yes" unconditionally. The
 * bounds below are not product limits; they are the shape a number must have to mean
 * anything at all (a byte quota of zero, a retention of thirty centuries), and they are
 * copied from the table's own `CHECK` constraints, so the two layers use the same numbers.
 * The domain is the stricter where it has to be: it also requires an integer, which a bare
 * SQLite `INTEGER` column does not (it stores `1.5` as a real).
 *
 * **Deliberately stateless with respect to `events_created_in_period`.** The counter that
 * a ceiling is compared against lives on the `Client` record, not here: this type answers
 * "is this count still inside the ceiling", and the caller supplies the count. Folding the
 * counter in would make a `ClientCeilings` instance stale the instant another event is
 * created, for no benefit — the comparison needs both numbers in one place exactly once,
 * at the call site.
 */

export interface ClientCeilingsProps {
  readonly maxEvents: number | null
  readonly maxTotalBytes: number | null
  readonly maxEventQuotaBytes: number | null
  readonly maxRetentionDays: number | null
  readonly clipsAllowed: boolean
  readonly liveAllowed: boolean
  readonly maxLiveDays: number | null
  readonly maxEventsPerPeriod: number | null
  readonly periodStartedAt: Date | null
}

/** A ceiling with no bound at all: a solo installation's only client-shaped thing. */
const UNLIMITED: ClientCeilingsProps = {
  maxEvents: null,
  maxTotalBytes: null,
  maxEventQuotaBytes: null,
  maxRetentionDays: null,
  clipsAllowed: true,
  liveAllowed: true,
  maxLiveDays: null,
  maxEventsPerPeriod: null,
  periodStartedAt: null,
}

export type ClientCeilingsInput = Partial<ClientCeilingsProps>

/**
 * Which event-creation ceiling stopped a creation, and where that client stood against it.
 *
 * Carried into the refusal's details (`client.ceilingReached`) so a client's own page can
 * say "3 of 3" rather than "no".
 */
export interface EventCreationRefusal {
  readonly ceiling: 'events' | 'eventsPerPeriod'
  readonly used: number
  readonly max: number
}

const MIN_RETENTION_DAYS = 1
const MAX_RETENTION_DAYS = 3650
const MIN_LIVE_DAYS = 1
const MAX_LIVE_DAYS = 365
const MS_PER_DAY = 24 * 60 * 60 * 1_000

const isPositiveInteger = (value: number): boolean => Number.isInteger(value) && value > 0

const isInRange = (value: number, min: number, max: number): boolean =>
  Number.isInteger(value) && value >= min && value <= max

/** A `Date` built from a malformed string is `NaN`, and the adapter cannot write it. */
const isRealInstant = (value: unknown): boolean =>
  value instanceof Date && Number.isFinite(value.getTime())

export class ClientCeilings {
  private constructor(private readonly props: ClientCeilingsProps) {}

  /**
   * Every bound defaults to "no ceiling", so `ClientCeilings.create({})` is exactly what
   * a free-tier install's one implicit client has, and what every client had before an
   * operator ever touched this screen.
   */
  static create(input: ClientCeilingsInput = {}): Result<ClientCeilings, DomainError> {
    const props: ClientCeilingsProps = { ...UNLIMITED, ...input }

    if (props.maxEvents !== null && !isPositiveInteger(props.maxEvents)) {
      return err(DomainError.invalid('clientCeilings.maxEventsInvalid'))
    }
    if (props.maxTotalBytes !== null && !isPositiveInteger(props.maxTotalBytes)) {
      return err(DomainError.invalid('clientCeilings.maxTotalBytesInvalid'))
    }
    if (props.maxEventQuotaBytes !== null && !isPositiveInteger(props.maxEventQuotaBytes)) {
      return err(DomainError.invalid('clientCeilings.maxEventQuotaBytesInvalid'))
    }
    if (
      props.maxRetentionDays !== null &&
      !isInRange(props.maxRetentionDays, MIN_RETENTION_DAYS, MAX_RETENTION_DAYS)
    ) {
      return err(
        DomainError.invalid('clientCeilings.maxRetentionDaysInvalid', {
          min: MIN_RETENTION_DAYS,
          max: MAX_RETENTION_DAYS,
        }),
      )
    }
    if (props.maxLiveDays !== null && !isInRange(props.maxLiveDays, MIN_LIVE_DAYS, MAX_LIVE_DAYS)) {
      return err(
        DomainError.invalid('clientCeilings.maxLiveDaysInvalid', {
          min: MIN_LIVE_DAYS,
          max: MAX_LIVE_DAYS,
        }),
      )
    }
    if (props.maxEventsPerPeriod !== null && !isPositiveInteger(props.maxEventsPerPeriod)) {
      return err(DomainError.invalid('clientCeilings.maxEventsPerPeriodInvalid'))
    }

    // The types forbid all three, so these are for a caller the types cannot see: a patch
    // spread over the current values (`setClientCeilings`) turns an explicit `undefined`
    // into a flag the adapter would write as `0`, silently switching clips or opening off.
    if (typeof props.clipsAllowed !== 'boolean') {
      return err(DomainError.invalid('clientCeilings.clipsAllowedInvalid'))
    }
    if (typeof props.liveAllowed !== 'boolean') {
      return err(DomainError.invalid('clientCeilings.liveAllowedInvalid'))
    }
    if (props.periodStartedAt !== null && !isRealInstant(props.periodStartedAt)) {
      return err(DomainError.invalid('clientCeilings.periodStartedAtInvalid'))
    }

    return ok(new ClientCeilings(props))
  }

  /** Rehydrate from storage. The row already satisfied every `CHECK` on the way in. */
  static restore(props: ClientCeilingsProps): ClientCeilings {
    return new ClientCeilings(props)
  }

  /**
   * No ceiling at all: what a solo installation's one implicit client has, and what
   * `Client.create` defaults to when nobody passed any. Unlike {@link ClientCeilings.create},
   * this cannot fail — every field is a literal already inside its own bound — so a
   * caller that only ever wants "unbounded" never narrows a `Result` for an error no
   * input could produce.
   */
  static unlimited(): ClientCeilings {
    return new ClientCeilings(UNLIMITED)
  }

  toProps(): ClientCeilingsProps {
    return this.props
  }

  get maxEvents(): number | null {
    return this.props.maxEvents
  }

  get maxTotalBytes(): number | null {
    return this.props.maxTotalBytes
  }

  get maxEventQuotaBytes(): number | null {
    return this.props.maxEventQuotaBytes
  }

  get maxRetentionDays(): number | null {
    return this.props.maxRetentionDays
  }

  get clipsAllowed(): boolean {
    return this.props.clipsAllowed
  }

  get maxLiveDays(): number | null {
    return this.props.maxLiveDays
  }

  get maxEventsPerPeriod(): number | null {
    return this.props.maxEventsPerPeriod
  }

  get periodStartedAt(): Date | null {
    return this.props.periodStartedAt
  }

  /**
   * Whether a client with `totalEvents` events already on the box (every status, per
   * P3-05's `createWithOwner`) and `eventsCreatedInPeriod` created since the period
   * started may create one more.
   *
   * Two independent ceilings, both `NULL`-means-unbounded: a cap on the events the client
   * has **now** (so deleting one frees a slot), and a cap on the events it has created
   * **this period** (a counter that never decreases, so deleting one frees nothing, and
   * that a renewal resets). Either one being reached refuses the event; passing one does
   * not mean the other grants it.
   */
  allowsAnotherEvent(totalEvents: number, eventsCreatedInPeriod: number): boolean {
    return this.creationRefusal(totalEvents, eventsCreatedInPeriod) === null
  }

  /**
   * The same question as {@link ClientCeilings.allowsAnotherEvent}, answered with the
   * ceiling that said no instead of a bare `false` — which is what the transaction that
   * creates an event needs to build its refusal, and why the rule lives in one place.
   *
   * The total ceiling is named first when both are reached. It is the one a client can
   * act on by deleting an event; the per-period one cannot be cured that way, and telling a
   * client who has hit both only the second would send them to delete something for nothing.
   */
  creationRefusal(totalEvents: number, eventsCreatedInPeriod: number): EventCreationRefusal | null {
    const { maxEvents, maxEventsPerPeriod } = this.props
    if (maxEvents !== null && totalEvents >= maxEvents) {
      return { ceiling: 'events', used: totalEvents, max: maxEvents }
    }
    if (maxEventsPerPeriod !== null && eventsCreatedInPeriod >= maxEventsPerPeriod) {
      return { ceiling: 'eventsPerPeriod', used: eventsCreatedInPeriod, max: maxEventsPerPeriod }
    }
    return null
  }

  /** Whether a single event may be given this many bytes of quota. */
  admitsQuota(requestedBytes: number): boolean {
    return this.props.maxEventQuotaBytes === null || requestedBytes <= this.props.maxEventQuotaBytes
  }

  /**
   * The retention a new or edited event may actually have, after this ceiling.
   *
   * `null` in means "keep forever", which becomes the ceiling itself once one exists —
   * never passed through, because "forever" is exactly the case the ceiling exists to
   * refuse. A finite request is shortened, never lengthened: an event asking for less
   * than the ceiling keeps what it asked for.
   */
  clampRetention(requestedDays: number | null): number | null {
    if (this.props.maxRetentionDays === null) return requestedDays
    if (requestedDays === null) return this.props.maxRetentionDays
    return Math.min(requestedDays, this.props.maxRetentionDays)
  }

  /** Whether an event of this client may open its doors at all (quarantine, an expired Pass). */
  allowsOpening(): boolean {
    return this.props.liveAllowed
  }

  /** When an event opened at `openedAt` must close itself, or `null` for no deadline. */
  liveDeadline(openedAt: Date): Date | null {
    if (this.props.maxLiveDays === null) return null
    return new Date(openedAt.getTime() + this.props.maxLiveDays * MS_PER_DAY)
  }
}
