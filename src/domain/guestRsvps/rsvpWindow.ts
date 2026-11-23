import type { Event } from '../events/event'
import type { GuestInvite } from '../guestInvites/guestInvite'
import {
  servedInviteOf,
  type InviteSchedule,
  type InviteState,
} from '../guestInvites/inviteStateOf'
import { startOfNextLocalDay } from '../shared/localDay'
import type { RsvpSettings } from './rsvpSettings'

/**
 * Whether guests may answer right now (spec 30, section 4.3).
 *
 * - `off`: replies are not asked, or the invitation's page is not served, or the event is over;
 * - `open`, `closed`: the window;
 * - `full`: places are limited and taken (lot 4): a reply may still come, as a waiting list.
 *
 * **The calendar of the party decides, not the wall's status**: opening the wall the evening
 * before for a test does not close the replies, and a draft never opened does not keep them open
 * forever.
 */
export type RsvpState = 'off' | 'open' | 'closed' | 'full'

export interface RsvpCounts {
  /** People in the `yes` replies. */
  readonly yesPeople: number
}

/**
 * The first moment replies stop on their own: the start of the day after the deadline day where
 * the party is, or the start of the party, whichever comes first.
 */
export const rsvpClosesAt = (settings: RsvpSettings, schedule: InviteSchedule): Date => {
  if (settings.deadline === null) return schedule.startsAt
  const afterDeadline = startOfNextLocalDay(settings.deadline, schedule.timeZone)
  return afterDeadline.getTime() < schedule.startsAt.getTime() ? afterDeadline : schedule.startsAt
}

export const rsvpStateOf = (
  settings: RsvpSettings,
  invite: GuestInvite,
  event: Event,
  now: Date,
  counts: RsvpCounts,
): RsvpState => {
  if (!settings.enabled) return 'off'
  const served = servedInviteOf(event, invite)
  if (served === null || served.state === 'over') return 'off'
  if (settings.closedAt !== null) return 'closed'
  if (now.getTime() >= rsvpClosesAt(settings, served.schedule).getTime()) return 'closed'
  const { capacity } = settings.form
  if (capacity !== null && counts.yesPeople >= capacity) return 'full'
  return 'open'
}

/** A guest may send or change a reply only while the window is open (or full: the waiting list). */
export const guestMayWrite = (state: RsvpState): boolean => state === 'open' || state === 'full'

/**
 * A guest may read and delete **their own** reply for as long as the invitation is readable: the
 * right to erase it does not end with the window, nor with the party.
 */
export const guestMayReachOwn = (inviteState: InviteState): boolean => inviteState !== 'unavailable'
