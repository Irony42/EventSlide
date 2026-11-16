import { anotherShowing } from '../../../domain/announcements/announcementSchedule'
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
 * "Lancer maintenant" and "Relancer" (spec 21, rule 12): an existing announcement starts at the
 * server's clock, without a countdown, keeping its text, its kind and its duration. From
 * `upcoming`, `counting` or `over`.
 *
 * Two refusals, each a different thing for the host to do: `409 announcement.showing` when it,
 * or another announcement **of its kind**, is on screen (remove it first), and
 * `409 announcement.overlap` when the new span would touch a neighbour of its kind (decided by
 * the repository in one step). A card of the other kind never refuses it: they are two layers.
 */

export interface LaunchAnnouncementInput {
  readonly eventId: EventId
  readonly actorId: UserId
  readonly announcementId: AnnouncementId
}

export interface LaunchAnnouncementDeps {
  readonly events: EventRepository
  readonly announcements: AnnouncementRepository
  readonly memberships: MembershipRepository
  readonly bus: EventBus
  readonly clock: Clock
}

export type LaunchAnnouncement = (
  input: LaunchAnnouncementInput,
) => Promise<Result<HostAnnouncement, DomainError>>

export const makeLaunchAnnouncement =
  ({
    events,
    announcements,
    memberships,
    bus,
    clock,
  }: LaunchAnnouncementDeps): LaunchAnnouncement =>
  async ({ eventId, actorId, announcementId }) => {
    const opened = await openAnnouncements({ events, memberships }, eventId, actorId, 'write')
    if (!opened.ok) return opened

    const current = await announcements.findById(eventId, announcementId)
    if (current === null) return err(DomainError.notFound('announcement.notFound'))

    const now = clock.now()
    const launched = current.launch(now)
    if (!launched.ok) return launched

    const held = await announcements.listByEvent(eventId)
    if (anotherShowing(held, current.kind, now.getTime(), current.id)) {
      return err(DomainError.conflict('announcement.showing'))
    }

    const outcome = await announcements.trySave(launched.value)
    if (outcome === 'overlap') return err(DomainError.conflict('announcement.overlap'))
    if (outcome === 'notFound') return err(DomainError.notFound('announcement.notFound'))

    bus.publish({ type: 'announcement.changed', eventId })
    return ok(hostAnnouncementAt(launched.value, now))
  }
