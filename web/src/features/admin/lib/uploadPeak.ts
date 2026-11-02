import type { LocalHour } from './uploadsByHour'

/**
 * The busiest local hour, for "Pic : 21 h, 63 envois".
 *
 * Computed here, on the hours the bars show, and not by the server: a peak counted in UTC hours
 * would name an hour the chart does not draw. A tie goes to the earliest hour, so two readers of
 * one evening name the same one. `null` when nothing was sent.
 */
export const uploadPeak = (hours: readonly LocalHour[]): LocalHour | null => {
  let best: LocalHour | null = null
  for (const hour of hours) {
    if (hour.count === 0) continue
    if (best === null || hour.count > best.count) best = hour
  }
  return best
}
