import type { DomainError } from '../../../domain/shared/errors'
import type { EventId, UserId } from '../../../domain/shared/ids'
import { ok, type Result } from '../../../domain/shared/result'
import type { AnnouncementRepository } from '../../ports/announcementRepository'
import type { Clock } from '../../ports/clock'
import type { EventRepository } from '../../ports/eventRepository'
import type { MembershipRepository } from '../../ports/userRepository'
import { hostAnnouncementAt, openAnnouncements, type HostAnnouncement } from './announcementAccess'

/**
 * The host's list (spec 21): every announcement of the event, by moment, each with its state
 * derived at this read. Any moderator may read it, in any status of the event: a closed
 * evening's list is a record.
 *
 * It carries `serverNowMs` for the reason the wall's response does: a console on a laptop whose
 * clock is three minutes off must count the same time as the projector. The state is computed
 * here, from the same clock reading, so the console never re-derives it from its own.
 */

export interface ListAnnouncementsInput {
  readonly eventId: EventId
  readonly actorId: UserId
}

export interface HostAnnouncementList {
  readonly announcements: readonly HostAnnouncement[]
  readonly serverNowMs: number
}

export interface ListAnnouncementsDeps {
  readonly events: EventRepository
  readonly announcements: AnnouncementRepository
  readonly memberships: MembershipRepository
  readonly clock: Clock
}

export type ListAnnouncements = (
  input: ListAnnouncementsInput,
) => Promise<Result<HostAnnouncementList, DomainError>>

export const makeListAnnouncements =
  ({ events, announcements, memberships, clock }: ListAnnouncementsDeps): ListAnnouncements =>
  async ({ eventId, actorId }) => {
    const opened = await openAnnouncements({ events, memberships }, eventId, actorId, 'read')
    if (!opened.ok) return opened

    const now = clock.now()
    const rows = await announcements.listByEvent(eventId)
    return ok({
      announcements: rows.map((row) => hostAnnouncementAt(row, now)),
      serverNowMs: now.getTime(),
    })
  }
