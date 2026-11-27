/**
 * What an account chose to receive (spec 32, section 5): two switches, both **on** for an account that
 * never touched them, so a box with a relay writes the follow-up mails as soon as it is updated.
 *
 * - `rsvp`: the guests' replies (the calendar notices, R3 to R5, and the daily digest R2 when the host
 *   ticked it for an event);
 * - `event`: the life of the host's events (A2, A3, A5).
 *
 * The security mails (A1), the warning before the replies are erased (R1) and the operator's
 * notices (A4) have no switch: they are not listed here.
 */
export interface MailPreferences {
  readonly rsvp: boolean
  readonly event: boolean
}

export const DEFAULT_MAIL_PREFERENCES: MailPreferences = { rsvp: true, event: true }

/** A change of the account's page: a field left out is left as it was. */
export interface MailPreferencesPatch {
  readonly rsvp?: boolean | undefined
  readonly event?: boolean | undefined
}

export const applyMailPreferencesPatch = (
  current: MailPreferences,
  patch: MailPreferencesPatch,
): MailPreferences => ({
  rsvp: patch.rsvp ?? current.rsvp,
  event: patch.event ?? current.event,
})

/** The mail budget's day: a UTC calendar day, `YYYY-MM-DD` (spec 32, section 5). */
export const budgetDayOf = (at: Date): string => at.toISOString().slice(0, 10)

/** The daily counts are kept this many days: enough to read yesterday's, no more. */
export const MAIL_COUNTS_KEPT_DAYS = 7
