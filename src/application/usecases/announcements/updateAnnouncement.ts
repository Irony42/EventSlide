import type { AnnouncementPatch } from '../../../domain/announcements/announcement'
import { DomainError } from '../../../domain/shared/errors'
import type { AnnouncementId, EventId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { AnnouncementRepository } from '../../ports/announcementRepository'
import type { Clock } from '../../ports/clock'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import type { MembershipRepository } from '../../ports/userRepository'
import { hostAnnouncementAt, openAnnouncements, type HostAnnouncement } from './announcementAccess'

/**
 * A host edits an announcement (spec 21, rule 11).
 *
 * Every field may change while it is `upcoming` or `counting`, its kind included (the duration
 * and the countdown are checked again for the new kind). Once it is on screen or over it is
 * `409 announcement.locked` (correcting a card on screen is removing it and launching again),
 * **except the text of a discreet announcement**, which may stay half an hour and is changed in
 * place. The announcement is looked up **in the event**: an identifier of another evening is
 * `404 announcement.notFound`.
 *
 * An edit that changes nothing writes nothing and publishes nothing: a form saved twice is not a
 * reason for every projector to read again.
 */

export interface UpdateAnnouncementInput extends AnnouncementPatch {
  readonly eventId: EventId
  readonly actorId: UserId
  readonly announcementId: AnnouncementId
}

export interface UpdateAnnouncementDeps {
  readonly events: EventRepository
  readonly announcements: AnnouncementRepository
  readonly memberships: MembershipRepository
  readonly bus: EventBus
  readonly clock: Clock
}

export type UpdateAnnouncement = (
  input: UpdateAnnouncementInput,
) => Promise<Result<HostAnnouncement, DomainError>>

export const makeUpdateAnnouncement =
  ({ events, announcements, memberships, bus, clock }: UpdateAnnouncementDeps): UpdateAnnouncement =>
  async ({ eventId, actorId, announcementId, ...patch }) => {
    const opened = await openAnnouncements({ events, memberships }, eventId, actorId, 'write')
    if (!opened.ok) return opened

    const current = await announcements.findById(eventId, announcementId)
    if (current === null) return err(DomainError.notFound('announcement.notFound'))

    const now = clock.now()
    const edited = current.edit(patch, now)
    if (!edited.ok) return edited
    if (edited.value.sameAs(current)) return ok(hostAnnouncementAt(current, now))

    const outcome = await announcements.trySave(edited.value)
    if (outcome === 'overlap') return err(DomainError.conflict('announcement.overlap'))
    // Deleted between the read and the write by another moderator: the same answer as a miss.
    if (outcome === 'notFound') return err(DomainError.notFound('announcement.notFound'))

    bus.publish({ type: 'announcement.changed', eventId })
    return ok(hostAnnouncementAt(edited.value, now))
  }
