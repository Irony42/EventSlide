import { localHourOf } from '../shared/localDay'
import { inQuietHours } from './quietHours'

/** The earliest local hour the digest leaves (09:00 on the dot is enough). */
export const RSVP_DIGEST_FROM_HOUR = 9

/** At least this long between two digests to one host: 20 hours, so "once a day" survives a late pass. */
export const RSVP_DIGEST_MIN_GAP_MS = 20 * 60 * 60 * 1000

export interface RsvpDigestInput {
  /** The owner ticked "send me a summary" for this event. */
  readonly subscribed: boolean
  /** The owner's account switch for the replies' family is on (`mail_rsvp`): it beats the tick. */
  readonly familyOn: boolean
  /** When the last digest of this event was claimed for this owner, or `null`. */
  readonly lastDigestAt: Date | null
  /** When this owner last opened the replies page (`rsvp_seen_at`), or `null`. */
  readonly seenAt: Date | null
  /** The latest reply created or changed (`updated_at`), or `null` when the event has none. */
  readonly lastChangeAt: Date | null
  readonly now: Date
  /** The invitation's zone, or `DEFAULT_NOTICE_TIME_ZONE`. */
  readonly timeZone: string
}

/**
 * R2, the daily summary (spec 32, section 3.1): whether one is owed to this owner now.
 *
 * Subscribed **and** the family on; something changed after the later of "I looked" and "the last
 * digest" (so a host who already saw the replies on the page is not told again, and a digest does not
 * repeat itself); at least 20 hours since the last digest; and a civil hour: from 09:00 (and, like every
 * sweep's mail, before 21:00) in the invitation's zone.
 *
 * A reply that was only deleted leaves no change to count (its row is gone): accepted, the next
 * digest's totals are right.
 */
export const rsvpDigestDue = (input: RsvpDigestInput): boolean => {
  if (!input.subscribed || !input.familyOn) return false
  if (input.lastChangeAt === null) return false

  const since = latestOf(input.seenAt, input.lastDigestAt)
  if (since !== null && input.lastChangeAt.getTime() <= since.getTime()) return false

  if (
    input.lastDigestAt !== null &&
    input.now.getTime() - input.lastDigestAt.getTime() < RSVP_DIGEST_MIN_GAP_MS
  ) {
    return false
  }

  return (
    localHourOf(input.now, input.timeZone) >= RSVP_DIGEST_FROM_HOUR &&
    !inQuietHours(input.now, input.timeZone)
  )
}

const latestOf = (a: Date | null, b: Date | null): Date | null => {
  if (a === null) return b
  if (b === null) return a
  return a.getTime() >= b.getTime() ? a : b
}
