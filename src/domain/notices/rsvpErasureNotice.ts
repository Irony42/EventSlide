import { MS_PER_DAY } from '../shared/time'

/**
 * R1, the warning before the guests' replies are erased (spec 32, section 4). The replies hold names
 * and sometimes diets, so the host is told twice, **7 days and 1 day before**, to download the list.
 */
export const RSVP_ERASURE_LEVELS = [7, 1] as const

export type RsvpErasureLevel = (typeof RSVP_ERASURE_LEVELS)[number]

/**
 * When the replies are really erased: the earlier of the retention rule (`rsvpExpiryOf`) and the
 * event's own purge (`purgeDeadline`), because the purge takes them sooner and its hold does not keep
 * them. `null` when neither clock runs.
 */
export const rsvpErasureDate = (
  rsvpExpiry: Date | null,
  purgeDeadline: Date | null,
): Date | null => {
  if (rsvpExpiry === null) return purgeDeadline
  if (purgeDeadline === null) return rsvpExpiry
  return rsvpExpiry.getTime() <= purgeDeadline.getTime() ? rsvpExpiry : purgeDeadline
}

/**
 * The notice to send now, or `null` for none: the same shape as the purge's `nextNotice`.
 *
 * Whole days left are **rounded up** (20 hours left is still "1 day"); 2 to 7 days fall under the
 * 7-day notice and exactly 1 under the 1-day one; more than 7 days, or a date that has arrived, owe
 * nothing (the erasure is the sweep's business, not a warning's). `lastLevelForThisDate` is the most
 * urgent level already noted **for this very date**: a level already noted, or a less urgent one, is
 * not owed again, and an album whose date shows up late gets the most urgent level, once.
 *
 * A date that moves (reopening, an invitation moved) is not handled here but by the ledger's key
 * ({@link rsvpErasureKey}): it carries the date, so the levels start over for a new one.
 */
export const rsvpErasureNotice = (
  erasureDate: Date,
  now: Date,
  lastLevelForThisDate: RsvpErasureLevel | null,
): RsvpErasureLevel | null => {
  const daysLeft = Math.ceil((erasureDate.getTime() - now.getTime()) / MS_PER_DAY)
  if (daysLeft < 1 || daysLeft > 7) return null
  const level: RsvpErasureLevel = daysLeft === 1 ? 1 : 7
  return lastLevelForThisDate !== null && lastLevelForThisDate <= level ? null : level
}

/** The ledger key of an R1 notice: the level and the date it speaks of, `7@2027-01-12T00:00:00.000Z`. */
export const rsvpErasureKey = (level: RsvpErasureLevel, erasureDate: Date): string =>
  `${level}@${erasureDate.toISOString()}`
