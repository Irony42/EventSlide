/**
 * Which moment "22:00" means (spec 21, rule 9), and nothing else.
 *
 * The host types a time of day, not a date, so the console has to say which day it picked. The
 * server stores an instant and knows no time zone (rule 8): the zone is the browser's, as for the
 * event's scheduled opening (`features/admin/eventSchedule.ts`), and the line this feeds
 * ("Demain 00:30, dans 23 h 30") is what makes a wrong day or a wrong zone visible before the
 * announcement is saved.
 */

/** The server accepts an instant up to this long in the past (rule 2): the same minute of slack. */
export const PAST_TOLERANCE_MS = 60_000

/** Beyond this a time is probably the wrong day: the console says so in words (rule 9). */
export const FAR_AWAY_MS = 12 * 60 * 60 * 1000

export interface ResolvedInstant {
  /** The instant, ms since the epoch. */
  readonly atMs: number
  /** The calendar day it falls on, in the browser's zone, against the day of `nowMs`. */
  readonly day: 'today' | 'tomorrow' | 'later'
  /** Milliseconds from `nowMs` to the instant; at most `PAST_TOLERANCE_MS` below zero. */
  readonly leadMs: number
  /** More than twelve hours away: the console warns. */
  readonly far: boolean
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/

/** The time of day as `{ hours, minutes }`, or `null` for anything but a `HH:mm` of a real clock. */
export const parseTimeOfDay = (hhmm: string): { hours: number; minutes: number } | null => {
  const match = HHMM.exec(hhmm)
  if (match === null) return null
  return { hours: Number(match[1]), minutes: Number(match[2]) }
}

const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate()

/**
 * The first occurrence of `hhmm` (browser zone) that the evening can still reach.
 *
 * - **An opening scheduled in the future** is where the evening starts: the first occurrence **at
 *   or after the opening**. "00:30" for a party that opens at 18:00 is the night after, never the
 *   morning before, however far ahead the host is typing.
 * - **Otherwise** it is the first occurrence **strictly after `nowMs` minus a minute**, the
 *   server's own tolerance: "22:00" typed at 22:00:30 is today, and "22:00" typed at 22:01 is
 *   tomorrow, which the line then says in so many words.
 *
 * `null` when `hhmm` is not a time of day (an empty field, a half-typed value).
 */
export const resolveAnnouncementInstant = (
  hhmm: string,
  nowMs: number,
  openAtMs: number | null,
): ResolvedInstant | null => {
  const time = parseTimeOfDay(hhmm)
  if (time === null) return null

  const fromOpening = openAtMs !== null && openAtMs > nowMs
  const reference = fromOpening ? openAtMs : nowMs - PAST_TOLERANCE_MS
  const reached = (candidate: number): boolean =>
    fromOpening ? candidate >= reference : candidate > reference

  const start = new Date(reference)
  let atMs = NaN
  // Two days are always enough; the loop is a guard against a clock-change night, not a search.
  for (let offset = 0; offset < 3; offset += 1) {
    const candidate = new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate() + offset,
      time.hours,
      time.minutes,
      0,
      0,
    ).getTime()
    if (reached(candidate)) {
      atMs = candidate
      break
    }
  }
  if (Number.isNaN(atMs)) return null

  const now = new Date(nowMs)
  const at = new Date(atMs)
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const day = sameDay(at, now) ? 'today' : sameDay(at, tomorrow) ? 'tomorrow' : 'later'
  const leadMs = atMs - nowMs
  return { atMs, day, leadMs, far: leadMs > FAR_AWAY_MS }
}

/** Whole minutes from now to the instant, rounded to the nearest, for the "dans 1 h 12" of the line. */
export const leadMinutes = (leadMs: number): number => Math.max(0, Math.round(leadMs / 60_000))
