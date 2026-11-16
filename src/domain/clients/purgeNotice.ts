import { MS_PER_DAY } from '../shared/time'

/**
 * The days before an album's deletion on which its owners are written to (spec 22): three
 * constants, not a setting — one more number is one more number to set badly.
 */
export const PURGE_NOTICE_LEVELS = [14, 3, 1] as const

export type PurgeNoticeLevel = (typeof PURGE_NOTICE_LEVELS)[number]

export const isPurgeNoticeLevel = (value: unknown): value is PurgeNoticeLevel =>
  PURGE_NOTICE_LEVELS.some((level) => level === value)

/**
 * Whole days left until a deadline, **rounded up**: with 20 hours left it is still "1 day",
 * and "0" is reserved for an instant that has arrived. Rounding down would announce "dans 0 jours"
 * for an album that has a whole day left, and would never say "1".
 */
export const daysLeftUntil = (deadline: Date, now: Date): number =>
  Math.max(0, Math.ceil((deadline.getTime() - now.getTime()) / MS_PER_DAY))

/**
 * The threshold a number of days left falls under: the **smallest** level that is still at least
 * `daysLeft` (14 for 4 to 14 days, 3 for 2 to 3, 1 for exactly 1), and `null` when the album has
 * more than 14 days left or none at all — a deadline that has arrived is the purge's business,
 * not a warning's.
 */
export const noticeLevelFor = (daysLeft: number): PurgeNoticeLevel | null => {
  if (!(daysLeft > 0)) return null
  for (const level of [...PURGE_NOTICE_LEVELS].reverse()) {
    if (daysLeft <= level) return level
  }
  return null
}

/**
 * The notice to send now, or `null` for none.
 *
 * **One notice per threshold, and never an older one than the last** (spec 22, rule 9): a level
 * already noted is not sent again, and a level less urgent than the last one noted is not sent
 * either. So an album whose deadline shows up late — a retention of 7 days, an offboarding with 2
 * days — gets the most urgent threshold that applies, once, and not the 14 it has already passed.
 */
export const nextNotice = (
  daysLeft: number,
  lastLevel: PurgeNoticeLevel | null,
): PurgeNoticeLevel | null => {
  const level = noticeLevelFor(daysLeft)
  if (level === null) return null
  return lastLevel !== null && lastLevel <= level ? null : level
}
