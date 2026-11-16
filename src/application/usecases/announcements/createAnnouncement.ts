import { Announcement } from '../../../domain/announcements/announcement'
import {
  hasRoomForAnnouncement,
  MAX_ANNOUNCEMENTS_PER_EVENT,
} from '../../../domain/announcements/announcementRules'
import { anotherShowing } from '../../../domain/announcements/announcementSchedule'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { AnnouncementRepository } from '../../ports/announcementRepository'
import type { Clock } from '../../ports/clock'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import type { IdGenerator } from '../../ports/idGenerator'
import type { MembershipRepository } from '../../ports/userRepository'
import { hostAnnouncementAt, openAnnouncements, type HostAnnouncement } from './announcementAccess'

/**
 * A host schedules an announcement, or launches one on the spot (spec 21).
 *
 * **`at` decides which.** Given, it is a moment (within a minute of the past and sixty days
 * ahead); absent, it is a launch: the announcement starts at the server's clock, without a
 * countdown, and is refused `409 announcement.showing` if one **of its kind** is already on
 * screen. The fields are parsed by the domain, one code each, and the lists the host sees are
 * the same on every device.
 *
 * Two `409`s are decided by the repository in one step, so two moderators scheduling together
 * cannot both win: the fiftieth announcement of an event is its last, and two announcements of a
 * kind never overlap. The ceiling is also checked here, from the list this reads anyway, so the
 * usual refusal costs no write.
 *
 * Publishes `announcement.changed` (public, no data) once the row is in.
 */

export interface CreateAnnouncementInput {
  readonly eventId: EventId
  readonly actorId: UserId
  readonly text: unknown
  readonly kind?: unknown
  readonly at?: unknown
  readonly durationSeconds?: unknown
  readonly countdownSeconds?: unknown
}

export interface CreateAnnouncementDeps {
  readonly events: EventRepository
  readonly announcements: AnnouncementRepository
  readonly memberships: MembershipRepository
  readonly ids: IdGenerator
  readonly bus: EventBus
  readonly clock: Clock
}

export type CreateAnnouncement = (
  input: CreateAnnouncementInput,
) => Promise<Result<HostAnnouncement, DomainError>>

export const makeCreateAnnouncement =
  ({
    events,
    announcements,
    memberships,
    ids,
    bus,
    clock,
  }: CreateAnnouncementDeps): CreateAnnouncement =>
  async ({ eventId, actorId, ...fields }) => {
    const opened = await openAnnouncements({ events, memberships }, eventId, actorId, 'write')
    if (!opened.ok) return opened

    const now = clock.now()
    const created = Announcement.create(
      { eventId, createdBy: actorId, ...fields },
      ids.announcementId(),
      now,
    )
    if (!created.ok) return created
    const announcement = created.value

    const held = await announcements.listByEvent(eventId)
    // A launch (no moment given) starts now: a card of its kind already on screen is "showing",
    // not an overlap, because the host's next move is "retirer", not another time.
    if (fields.at === undefined && anotherShowing(held, announcement.kind, now.getTime(), null)) {
      return err(DomainError.conflict('announcement.showing'))
    }
    if (!hasRoomForAnnouncement(held.length, MAX_ANNOUNCEMENTS_PER_EVENT)) {
      return err(DomainError.conflict('announcement.limit', { max: MAX_ANNOUNCEMENTS_PER_EVENT }))
    }

    const outcome = await announcements.tryCreate(announcement, MAX_ANNOUNCEMENTS_PER_EVENT)
    if (outcome === 'overlap') return err(DomainError.conflict('announcement.overlap'))
    if (outcome === 'limitReached') {
      return err(DomainError.conflict('announcement.limit', { max: MAX_ANNOUNCEMENTS_PER_EVENT }))
    }

    bus.publish({ type: 'announcement.changed', eventId })
    return ok(hostAnnouncementAt(announcement, now))
  }
