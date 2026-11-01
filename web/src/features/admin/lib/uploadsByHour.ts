import type { StatsQuarterDto } from '../../../lib/api/dto'

/**
 * The statistics page's bars: sends per **local** hour.
 *
 * The server counts in 15-minute UTC slots and the reader's hours are theirs: a host in India
 * is at +5 h 30, so UTC hours would shift every bar by half an hour. Every real time zone is a
 * whole number of quarters from UTC, which is why regrouping the slots here is exact. A pure
 * function, with the zone offset as a parameter so a test can stand in any zone.
 */

export interface LocalHour {
  /** The instant the local hour starts, as an ISO UTC string. Distinct per bar, and a stable key. */
  readonly start: string
  /** 0 to 23, on the reader's clock. */
  readonly hour: number
  readonly count: number
}

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS

/** Minutes to add to UTC to get local time, at that instant (`getTimezoneOffset` is the opposite sign). */
export type OffsetAt = (instant: Date) => number

export const browserOffset: OffsetAt = (instant) => -instant.getTimezoneOffset()

export const groupByLocalHour = (
  quarters: readonly StatsQuarterDto[],
  offsetAt: OffsetAt = browserOffset,
): readonly LocalHour[] => {
  const hours = new Map<number, number>()

  for (const quarter of quarters) {
    const instant = new Date(quarter.start)
    const shift = offsetAt(instant) * MINUTE_MS
    // The local hour's start, still expressed in the local frame; mapped back to a real instant below.
    const localHourStart = Math.floor((instant.getTime() + shift) / HOUR_MS) * HOUR_MS
    hours.set(localHourStart, (hours.get(localHourStart) ?? 0) + quarter.count)
  }

  return [...hours.entries()]
    .sort(([left], [right]) => left - right)
    .map(([localStart, count]) => {
      const local = new Date(localStart)
      return {
        start: new Date(localStart - offsetAtLocal(localStart, offsetAt)).toISOString(),
        hour: local.getUTCHours(),
        count,
      }
    })
}

/** The offset that applied at a local-frame hour start: asked at the instant it maps to. */
const offsetAtLocal = (localStart: number, offsetAt: OffsetAt): number => {
  const guess = offsetAt(new Date(localStart))
  return offsetAt(new Date(localStart - guess * MINUTE_MS)) * MINUTE_MS
}
