import type { InviteSchedule } from '../guestInvites/inviteStateOf'
import type { RsvpState } from '../guestRsvps/rsvpWindow'
import { rsvpClosesAt } from '../guestRsvps/rsvpWindow'
import type { RsvpSettings } from '../guestRsvps/rsvpSettings'
import { startOfNextLocalDay, addLocalDays, localDayOf } from '../shared/localDay'

/** R3 is sent from this many days before the deadline day. */
export const RSVP_DEADLINE_NOTICE_DAYS = 3

/**
 * R3 (spec 32, section 3.1): the reminder three days before the replies' deadline. Returns the ledger
 * key (the deadline day the host typed, so a moved deadline is a new notice) or `null`.
 *
 * Due when a deadline is set, the replies are **open** (`rsvpStateOf`: an unpublished invitation, a
 * party gone by, a closing by hand or a full house owe nothing), at least one household of the list has
 * not answered, and the invitation's local day has reached the third day before the deadline. It stays
 * due until the replies stop (the notice's validity, `isFresh`), so a pass that was late still writes
 * once.
 */
export const rsvpDeadlineNotice = (
  settings: RsvpSettings,
  schedule: InviteSchedule,
  state: RsvpState,
  hasUnanswered: boolean,
  now: Date,
): string | null => {
  const deadline = settings.deadline
  if (deadline === null || state !== 'open' || !hasUnanswered) return null
  const today = localDayOf(now, schedule.timeZone)
  return today >= addLocalDays(deadline, -RSVP_DEADLINE_NOTICE_DAYS) ? deadline : null
}

/** What R4 is about: the replies stopped on their own, at the deadline. */
export interface RsvpStopped {
  /** The ledger key: the deadline day. */
  readonly key: string
  /** The instant they stopped: the start of the day after the deadline, where the party is. */
  readonly stoppedAt: Date
}

/**
 * R4 (spec 32, section 3.1): the replies **stopped because of the deadline**, or `null`.
 *
 * Exactly: a deadline is set, the host did not close the replies by hand (`closedAt` is null), the
 * moment `rsvpClosesAt` has passed, and **the bound that won is the day after the deadline**, not the
 * start of the party (when the deadline day is the party's day, or later, the party's start wins and
 * the replies did not stop "because of the deadline"). Validity (24 hours after the stop) is `isFresh`.
 */
export const rsvpStoppedByDeadline = (
  settings: RsvpSettings,
  schedule: InviteSchedule,
  now: Date,
): RsvpStopped | null => {
  const deadline = settings.deadline
  if (deadline === null || settings.closedAt !== null) return null
  const closesAt = rsvpClosesAt(settings, schedule)
  if (closesAt.getTime() > now.getTime()) return null
  const afterDeadline = startOfNextLocalDay(deadline, schedule.timeZone)
  if (afterDeadline.getTime() >= schedule.startsAt.getTime()) return null
  return { key: deadline, stoppedAt: closesAt }
}

/**
 * R5's ledger key (spec 32, section 3.1): `full@<capacity>` while the places are all taken, `null`
 * otherwise. **One notice per capacity value**: when the host raises 120 to 150 and the house fills
 * again, the key is new and a second mail is owed.
 */
export const rsvpFullKey = (
  stats: { readonly yes: { readonly people: number } },
  form: { readonly capacity: number | null },
): string | null =>
  form.capacity !== null && stats.yes.people >= form.capacity ? `full@${form.capacity}` : null
