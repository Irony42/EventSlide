import type { Announcement } from '../../../domain/announcements/announcement'
import type { AnnouncementState } from '../../../domain/announcements/announcementSchedule'
import type { Event } from '../../../domain/events/event'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { EventRepository } from '../../ports/eventRepository'
import type { MembershipRepository } from '../../ports/userRepository'
import { requireEventRole, requireReadable, requireWritable } from '../shared/eventRole'

/**
 * What every announcement use case asks first, in the order the rest of the application keeps:
 * the event exists, the actor moderates it (a stranger is told `event.notFound`, as for any
 * other host surface), the client is not frozen and the operator did not take it down, and, for
 * a write, the event is being prepared or is on.
 *
 * **Any moderator** (the owner included) may: the person at the evening with a laptop or a phone
 * is usually the moderator, and an announcement writes a sentence the owner would have said aloud.
 * The state of the event is asked **last**, never before the role: a refusal that names it to a
 * caller with no part in it would confirm the event exists.
 */

export interface AnnouncementAccessDeps {
  readonly events: EventRepository
  readonly memberships: MembershipRepository
}

export const openAnnouncements = async (
  { events, memberships }: AnnouncementAccessDeps,
  eventId: EventId,
  actorId: UserId,
  mode: 'read' | 'write',
): Promise<Result<Event, DomainError>> => {
  const event = await events.findById(eventId)
  if (event === null) return err(DomainError.notFound('event.notFound'))

  const allowed = await requireEventRole(memberships, eventId, actorId, 'moderate')
  if (!allowed.ok) return allowed

  const reachable = mode === 'write' ? requireWritable(event) : requireReadable(event)
  if (!reachable.ok) return reachable

  // A closed or archived event keeps its list and loses its pen: read-only, with a reason.
  if (mode === 'write' && !event.allowsAnnouncementWrites()) {
    return err(DomainError.conflict('announcement.eventNotOpen', { status: event.status }))
  }
  return ok(event)
}

/** What the host's console is shown of one announcement: the row, and where it is in time. */
export interface HostAnnouncement {
  readonly announcement: Announcement
  readonly state: AnnouncementState
}

/** Derived at `now`, the one reading of the clock the whole answer is built on. */
export const hostAnnouncementAt = (announcement: Announcement, now: Date): HostAnnouncement => ({
  announcement,
  state: announcement.phaseAt(now).phase,
})
