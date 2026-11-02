import type { EventId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import { DomainError } from '../../../domain/shared/errors'
import { engagementSince } from '../../../domain/stats/engagementWindow'
import { rankContributors, type ContributorRanking } from '../../../domain/stats/contributorRanking'
import type { Clock } from '../../ports/clock'
import type { DerivedStats } from '../../ports/eventStatsRepository'
import type { EventStatsRepository } from '../../ports/eventStatsRepository'
import type { EventRepository } from '../../ports/eventRepository'
import type { GuestRepository } from '../../ports/guestRepository'
import type { MembershipRepository } from '../../ports/userRepository'
import { PRESENCE_WINDOW_MS } from '../guests/listGuests'
import { requireEventRole, requireReadable } from '../shared/eventRole'

/**
 * "Comment s'est passée la soirée ?": the host's statistics page (spec 05).
 *
 * Audience: the host and the moderators (the same one as the guest list, which already shows
 * every first name and photo count this page shows). The guest and the room see nothing of it.
 *
 * Order of refusals, as `getTopPhotos` and the guest list: role first (a non-member reads
 * `404 event.notFound`), then the event itself (a taken-down event is a `404` too, a suspended
 * client's members read `403 client.suspended`: the page shows first names).
 *
 * Everything is derived from the tables at read time; the first names of at most ten guests come
 * out of `rankContributors`, and guests without one are folded into a single line.
 */

export interface GetEventStatsInput {
  readonly eventId: EventId
  readonly actorId: UserId
}

/**
 * The after-party counters, summed over the days. `since` is the first day anything was counted,
 * so the page can say that nothing was measured before it. `null` when no day was ever counted.
 */
export interface Engagement {
  readonly since: string
  readonly galleryViews: number
  readonly galleryArchiveDownloads: number
}

export interface EventStats {
  readonly derived: DerivedStats
  /** Sends: the sum of the four statuses (photos and videos alike). */
  readonly uploadsTotal: number
  readonly activeNow: number
  readonly contributors: ContributorRanking
  readonly engagement: Engagement | null
}

export interface GetEventStatsDeps {
  readonly events: Pick<EventRepository, 'findById'>
  readonly memberships: Pick<MembershipRepository, 'roleFor'>
  readonly guests: Pick<GuestRepository, 'countActive'>
  readonly stats: EventStatsRepository
  readonly clock: Clock
}

export type GetEventStats = (input: GetEventStatsInput) => Promise<Result<EventStats, DomainError>>

export const makeGetEventStats =
  ({ events, memberships, guests, stats, clock }: GetEventStatsDeps): GetEventStats =>
  async ({ eventId, actorId }) => {
    const allowed = await requireEventRole(memberships, eventId, actorId, 'moderate')
    if (!allowed.ok) return allowed

    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))
    const readable = requireReadable(event)
    if (!readable.ok) return readable

    const derived = await stats.readDerived(eventId)
    const since = new Date(clock.now().getTime() - PRESENCE_WINDOW_MS)
    const { byStatus } = derived

    const counters = await stats.readCounters(eventId)
    const first = engagementSince(counters.map((counter) => counter.day))
    const total = (metric: 'galleryViews' | 'galleryArchiveDownloads'): number =>
      counters.filter((counter) => counter.metric === metric).reduce((sum, c) => sum + c.value, 0)

    return ok({
      derived,
      engagement:
        first === null
          ? null
          : {
              since: first,
              galleryViews: total('galleryViews'),
              galleryArchiveDownloads: total('galleryArchiveDownloads'),
            },
      uploadsTotal: byStatus.pending + byStatus.published + byStatus.rejected + byStatus.hidden,
      activeNow: await guests.countActive(eventId, since),
      contributors: rankContributors(derived.contributors),
    })
  }
