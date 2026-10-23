import type { ClientCeilingsInput, ClientCeilingsProps } from './clientCeilings'

/**
 * The ceilings a box gives a client it creates when nobody names them (`NEW_CLIENT_*`,
 * free plan G2-18; roadmap §10.5).
 *
 * **Seven of the nine, on purpose.** `liveAllowed` is the quarantine switch and has no
 * default to configure: a new client is allowed to open, and an operator who wants it held
 * says so for that client. `periodStartedAt` is not a setting at all but a moment, and
 * {@link startingCeilings} is what supplies it.
 *
 * Every bound is `null` ("no ceiling") and `clipsAllowed` is `true` on a box that configured
 * nothing, which is exactly what `ClientCeilings.unlimited()` is, so a self-hosted box
 * provisions every client as it always did.
 */
export type NewClientDefaults = Pick<
  ClientCeilingsProps,
  | 'maxEvents'
  | 'maxEventsPerPeriod'
  | 'maxTotalBytes'
  | 'maxEventQuotaBytes'
  | 'maxRetentionDays'
  | 'maxLiveDays'
  | 'clipsAllowed'
>

/** What the operator named, or the default when they did not. `null` is a value, `undefined` is not. */
const orDefault = <T>(named: T | undefined, fallback: T): T =>
  named === undefined ? fallback : named

/**
 * The ceilings a client is created with: what the operator named, and for every ceiling the
 * operator left out, the box's default.
 *
 * **Naming a ceiling wins, `null` included.** `{ maxEvents: null }` lifts the default for
 * this client, which is how an operator gives one customer more than the box's free tier
 * without a second configuration. A ceiling the operator did not mention takes the default
 * rather than "none", so omitting a field can never quietly hand out more than the box was
 * set to hand out: the failure the other reading allows (a console form that forgot a
 * field) is a client with no storage ceiling on a box that meant to have one. An explicit
 * `undefined` is an omission, as `ClientCeilings.create` would read it from a spread.
 *
 * **A period that the defaults start starts now.** `maxEventsPerPeriod` counts the events
 * created since `periodStartedAt`; a default for the count with no start would leave the
 * period undated, and a renewal (`setClientCeilings`, which resets the counter when the
 * start moves) would have nothing to move. So when the count comes from the defaults, the
 * period starts at `now`, the moment of provisioning. When the operator names the count, or
 * the start, they have decided and nothing here adds to it.
 *
 * Pure: it neither validates (`ClientCeilings.create` does, on the result) nor reads a
 * clock, so the caller's `now` is the one instant an audit entry and the period share.
 */
export const startingCeilings = (
  defaults: NewClientDefaults,
  given: ClientCeilingsInput | undefined,
  now: Date,
): ClientCeilingsInput => {
  const named: ClientCeilingsInput = given ?? {}
  const maxEventsPerPeriod = orDefault(named.maxEventsPerPeriod, defaults.maxEventsPerPeriod)

  // The period's start is the operator's if they gave one; otherwise it is stamped only for a
  // count that came from the defaults and is a count at all.
  const periodStartedAt =
    named.periodStartedAt !== undefined
      ? named.periodStartedAt
      : named.maxEventsPerPeriod === undefined && maxEventsPerPeriod !== null
        ? new Date(now.getTime())
        : undefined

  return {
    maxEvents: orDefault(named.maxEvents, defaults.maxEvents),
    maxEventsPerPeriod,
    maxTotalBytes: orDefault(named.maxTotalBytes, defaults.maxTotalBytes),
    maxEventQuotaBytes: orDefault(named.maxEventQuotaBytes, defaults.maxEventQuotaBytes),
    maxRetentionDays: orDefault(named.maxRetentionDays, defaults.maxRetentionDays),
    maxLiveDays: orDefault(named.maxLiveDays, defaults.maxLiveDays),
    clipsAllowed: orDefault(named.clipsAllowed, defaults.clipsAllowed),
    ...(named.liveAllowed === undefined ? {} : { liveAllowed: named.liveAllowed }),
    ...(periodStartedAt === undefined ? {} : { periodStartedAt }),
  }
}
