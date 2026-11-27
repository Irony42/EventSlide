import { MS_PER_DAY } from './time'

/**
 * Calendar days in a time zone: which local day an instant falls in, and the instant a local day
 * begins. The two readings an invitation needs ("reply before the 5th" ends when the 6th begins
 * where the party is, daylight saving included) and that a fixed number of hours cannot give.
 *
 * A zone must already be a valid IANA identifier: the callers hold one the domain accepted.
 */

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/

const formatters = new Map<string, Intl.DateTimeFormat>()

const formatterFor = (timeZone: string): Intl.DateTimeFormat => {
  const known = formatters.get(timeZone)
  if (known !== undefined) return known
  const made = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  })
  formatters.set(timeZone, made)
  return made
}

/** The wall-clock reading of an instant, as numbers. */
const wallClockOf = (ms: number, timeZone: string): Record<string, number> => {
  const value: Record<string, number> = {}
  for (const part of formatterFor(timeZone).formatToParts(new Date(ms))) {
    value[part.type] = Number(part.value)
  }
  return value
}

/** How far ahead of UTC the zone's clock was at `ms`, in milliseconds (DST included). */
const offsetMs = (ms: number, timeZone: string): number => {
  const v = wallClockOf(ms, timeZone)
  const asIfUtc = Date.UTC(
    v['year'] as number,
    (v['month'] as number) - 1,
    v['day'] as number,
    (v['hour'] as number) % 24,
    v['minute'] as number,
    v['second'] as number,
  )
  return asIfUtc - Math.floor(ms / 1000) * 1000
}

const two = (n: number): string => String(n).padStart(2, '0')

const dayText = (year: number, month: number, day: number): string =>
  `${String(year).padStart(4, '0')}-${two(month)}-${two(day)}`

const utcDayTextOf = (ms: number): string => {
  const at = new Date(ms)
  return dayText(at.getUTCFullYear(), at.getUTCMonth() + 1, at.getUTCDate())
}

const naiveMidnightOf = (day: string): number => {
  const parts = DAY.exec(day) as RegExpExecArray
  return Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]))
}

/** Whether `text` is a real calendar day written `YYYY-MM-DD` (no 31 February, no year 0). */
export const isCalendarDay = (text: unknown): text is string => {
  if (typeof text !== 'string' || !DAY.test(text)) return false
  return Number(text.slice(0, 4)) >= 1000 && utcDayTextOf(naiveMidnightOf(text)) === text
}

/** The local day (`YYYY-MM-DD`) an instant falls in, in `timeZone`. */
export const localDayOf = (at: Date, timeZone: string): string => {
  const v = wallClockOf(at.getTime(), timeZone)
  return dayText(v['year'] as number, v['month'] as number, v['day'] as number)
}

/** The first instant of a local day (`YYYY-MM-DD`, a real day) in `timeZone`. */
export const startOfLocalDay = (day: string, timeZone: string): Date => {
  const naive = naiveMidnightOf(day)
  // The offset depends on the instant being looked for: a second pass settles it across a change.
  const first = naive - offsetMs(naive, timeZone)
  const second = naive - offsetMs(first, timeZone)
  // Where the clocks skip midnight (Havana, Santiago, Asuncion: 00:00 becomes 01:00) the second
  // pass lands in the previous day: the day then begins at the later candidate, the instant of
  // the change itself.
  if (localDayOf(new Date(second), timeZone) < day) return new Date(Math.max(first, second))
  return new Date(second)
}

/** The first instant of the local day that follows `day`. */
export const startOfNextLocalDay = (day: string, timeZone: string): Date =>
  startOfLocalDay(utcDayTextOf(naiveMidnightOf(day) + MS_PER_DAY), timeZone)

/** The hour of the wall clock (0 to 23) an instant shows in `timeZone`. */
export const localHourOf = (at: Date, timeZone: string): number =>
  (wallClockOf(at.getTime(), timeZone)['hour'] as number) % 24

/** The local day `count` days after `day` (before it, for a negative count), `YYYY-MM-DD`. */
export const addLocalDays = (day: string, count: number): string =>
  utcDayTextOf(naiveMidnightOf(day) + count * MS_PER_DAY)
