import { DomainError } from '../../../domain/shared/errors'
import type { AnnouncementId, EventId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { AnnouncementRepository } from '../../ports/announcementRepository'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import type { MembershipRepository } from '../../ports/userRepository'
import { openAnnouncements } from './announcementAccess'

/**
 * A host deletes an announcement, in **any state** (spec 21, rule 13): upcoming, counting down,
 * on screen (it leaves the wall at the next read, which the signal triggers) or over. There is
 * no history beyond the row.
 *
 * It is looked up in the event and answered `404 announcement.notFound` when it is not there,
 * rather than `204`: a host deleting another evening's identifier learns nothing, and one
 * deleting twice is told the second one found nothing. Publishes only when a row was removed.
 */

export interface DeleteAnnouncementInput {
  readonly eventId: EventId
  readonly actorId: UserId
  readonly announcementId: AnnouncementId
}

export interface DeleteAnnouncementDeps {
  readonly events: EventRepository
  readonly announcements: AnnouncementRepository
  readonly memberships: MembershipRepository
  readonly bus: EventBus
}

export type DeleteAnnouncement = (
  input: DeleteAnnouncementInput,
) => Promise<Result<void, DomainError>>

export const makeDeleteAnnouncement =
  ({ events, announcements, memberships, bus }: DeleteAnnouncementDeps): DeleteAnnouncement =>
  async ({ eventId, actorId, announcementId }) => {
    const opened = await openAnnouncements({ events, memberships }, eventId, actorId, 'write')
    if (!opened.ok) return opened

    const removed = await announcements.delete(eventId, announcementId)
    if (!removed) return err(DomainError.notFound('announcement.notFound'))

    bus.publish({ type: 'announcement.changed', eventId })
    return ok(undefined)
  }
