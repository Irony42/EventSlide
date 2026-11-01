import type { ClientCeilingsInput, ClientCeilingsProps } from './clientCeilings'

/**
 * The ceilings a box gives a client it creates when nobody names them (`NEW_CLIENT_*`,
 * free plan G2-18; roadmap §10.5).
 *
 * **Eight of the ten, on purpose.** `liveAllowed` is the quarantine switch and has no
 * default to configure: a new client is allowed to open, and an operator who wants it held
 * says so for that client. `periodStartedAt` is not a setting at all but a moment, and
 * {@link startingCeilings} is what supplies it.
 *
 * Every bound is `null` ("no ceiling") and `clipsAllowed` and `booksAllowed` are `true` on a box that configured
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
  | 'booksAllowed'
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
 * **A period that has a count starts now, unless the operator dated it.** `maxEventsPerPeriod`
 * counts the events created since `periodStartedAt`; a count with no start would leave the
 * period undated, and a renewal (`setClientCeilings`, which resets the counter when the start
 * moves) would have nothing to move. So whenever the client ends up with a count, whether it
 * came from the defaults or from the operator (a console form pre-filled from the defaults
 * sends the count back **named**), the period starts at `now`, the moment of provisioning. The
 * operator's own start is kept; with no count there is no period to date.
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

  // The period's start is the operator's if they gave one; otherwise it is stamped for a count.
  const periodStartedAt =
    named.periodStartedAt !== undefined
      ? named.periodStartedAt
      : maxEventsPerPeriod !== null
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
    booksAllowed: orDefault(named.booksAllowed, defaults.booksAllowed),
    ...(named.liveAllowed === undefined ? {} : { liveAllowed: named.liveAllowed }),
    ...(periodStartedAt === undefined ? {} : { periodStartedAt }),
  }
}
