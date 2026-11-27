import { localHourOf } from '../shared/localDay'

/**
 * The zone the quiet hours are read in when the invitation has none: events have no zone of their own
 * (spec 32, section 3), only the invitation does, and this is the fallback.
 */
export const DEFAULT_NOTICE_TIME_ZONE = 'Europe/Paris'

/** The first hour (inclusive) the box may write to a host in the sweep's mails. */
export const QUIET_HOURS_END = 8
/** The first hour (inclusive) the box stops writing: 21:00 on the dot is already night. */
export const QUIET_HOURS_START = 21

/**
 * Whether it is night where the host is. The sweep's mails (R1 to R5, A3, A5) leave only between 08:00 and
 * 21:00 in the invitation's zone: outside it a notice **waits for the next pass, it is not noted**, so
 * no mail is lost and none wakes anybody up. The account notices (A1) and the ones that answer an action
 * (A2, A4, A6) are not held by this.
 */
export const inQuietHours = (now: Date, timeZone: string): boolean => {
  const hour = localHourOf(now, timeZone)
  return hour < QUIET_HOURS_END || hour >= QUIET_HOURS_START
}

/**
 * A zone `Intl` can read, else `fallback`: a stored zone nobody validated (an old row, a hand-edited base) must not make a notice
 * throw **after** it was noted, which would lose it for good.
 */
export const usableTimeZone = (zone: string | null | undefined, fallback: string): string => {
  if (zone === null || zone === undefined) return fallback
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return zone
  } catch {
    return fallback
  }
}
