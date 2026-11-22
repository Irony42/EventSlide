import { addDays } from '../shared/time'

/**
 * When replies are erased (spec 30, section 7). They hold names and, sometimes, health data, so
 * they do not outlive the party by much:
 *
 * - **30 days after the event closed.** Archiving stamps `closedAt` too, so it is covered by this
 *   one; reopening clears it, and nothing erased comes back;
 * - **60 days after the invitation's start**, which bounds an event that was never closed (a draft
 *   never opened, a party nobody closed);
 * - the event's own purge takes them sooner, as everything of the event, and the purge **hold does
 *   not keep them**.
 *
 * The earlier of the two dates wins.
 *
 * The dates compared in SQL are stored as ISO text from `toISOString()` (`events.closed_at`,
 * `guest_invites.starts_at`): the sweep's TEXT comparison is correct only because every one of
 * them has the same fixed-width UTC form.
 */
export const RSVP_KEPT_AFTER_CLOSE_DAYS = 30
export const RSVP_KEPT_AFTER_START_DAYS = 60

/** The moment a reply must be gone, or `null` when neither clock runs. */
export const rsvpExpiryOf = (dates: {
  readonly closedAt: Date | null
  readonly startsAt: Date | null
}): Date | null => {
  const afterClose =
    dates.closedAt === null ? null : addDays(dates.closedAt, RSVP_KEPT_AFTER_CLOSE_DAYS)
  const afterStart =
    dates.startsAt === null ? null : addDays(dates.startsAt, RSVP_KEPT_AFTER_START_DAYS)
  if (afterClose === null) return afterStart
  if (afterStart === null) return afterClose
  return afterClose.getTime() <= afterStart.getTime() ? afterClose : afterStart
}

/** Expired from the very instant of its date (day 30 is gone, day 29 is kept). */
export const isRsvpExpired = (
  dates: { readonly closedAt: Date | null; readonly startsAt: Date | null },
  now: Date,
): boolean => {
  const expiry = rsvpExpiryOf(dates)
  return expiry !== null && expiry.getTime() <= now.getTime()
}

/**
 * The same rule turned into two cutoffs a query can compare with the columns: an event whose
 * `closedAt` is at or before `closedBy`, or whose invitation `startsAt` is at or before `startedBy`,
 * has expired. The adapter uses these so the SQL cannot disagree with {@link isRsvpExpired}.
 */
export const rsvpCutoffs = (now: Date): { readonly closedBy: Date; readonly startedBy: Date } => ({
  closedBy: addDays(now, -RSVP_KEPT_AFTER_CLOSE_DAYS),
  startedBy: addDays(now, -RSVP_KEPT_AFTER_START_DAYS),
})
