import { MS_PER_DAY } from '../shared/time'

const MS_PER_HOUR = 60 * 60 * 1000

/** A long job is worth a mail; one the host just watched finish is not (spec 32, decision 6). */
export const JOB_MAIL_MIN_DURATION_MS = 2 * 60 * 1000

/**
 * A2: whether a finished job (archive, book, film) is worth a mail: it took **more than two minutes**
 * since it was asked for. The host who clicked and waited on the page needs no mail; the one who left does.
 * 1:59 is not, 2:00 exactly is not, 2:01 is.
 */
export const jobWorthAMail = (requestedAt: Date, finishedAt: Date): boolean =>
  finishedAt.getTime() - requestedAt.getTime() > JOB_MAIL_MIN_DURATION_MS

/** A3 leaves this long after the event first closed... */
export const EVENT_CLOSED_AFTER_MS = 12 * MS_PER_HOUR
/** ...and no later than this long after it. */
export const EVENT_CLOSED_UNTIL_MS = 2 * MS_PER_DAY

/**
 * A3, "after the party": whether the first closing is between 12 and 48 hours old. Before 12 hours the
 * host is still tidying up; after 48 the moment has gone (and the notice's validity says the same,
 * `isFresh`). `closedAt` is `null` for an event never closed.
 *
 * `purgeDeadline` is the album's own deletion date, when it has one: a notice that would speak of an
 * album already purged is not owed.
 */
export const eventClosedNoticeDue = (
  closedAt: Date | null,
  now: Date,
  purgeDeadline: Date | null = null,
): boolean => {
  if (closedAt === null) return false
  if (purgeDeadline !== null && purgeDeadline.getTime() <= now.getTime()) return false
  const age = now.getTime() - closedAt.getTime()
  return age >= EVENT_CLOSED_AFTER_MS && age < EVENT_CLOSED_UNTIL_MS
}

/** A5 is sent when the wall closes in less than this. */
export const WINDOW_ENDING_WITHIN_MS = MS_PER_DAY

/**
 * A5, "the wall closes within 24 hours": `windowEnd` is the instant `Event.liveWindowEnd(ceilings)` gives (the
 * rule the box acts on, never recomputed here), or `null` for an event with no window. Due when that
 * instant is still ahead and at most a day away, **unless a scheduled closing falls before it**: the host
 * who planned the end does not need to be told the box would have ended it later. A scheduled closing already
 * **in the past** that did not close the event (the schedule was discarded, or never applied) suppresses nothing.
 */
export const windowEndingDue = (
  windowEnd: Date | null,
  scheduledCloseAt: Date | null,
  now: Date,
): boolean => {
  if (windowEnd === null) return false
  const left = windowEnd.getTime() - now.getTime()
  if (left <= 0 || left > WINDOW_ENDING_WITHIN_MS) return false
  if (scheduledCloseAt === null || scheduledCloseAt.getTime() <= now.getTime()) return true
  return scheduledCloseAt.getTime() >= windowEnd.getTime()
}
