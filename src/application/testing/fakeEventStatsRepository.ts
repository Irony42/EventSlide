import type { Photo } from '../../domain/photos/photo'
import { emptyCounts } from '../../domain/reactions/reactionTally'
import type { REACTION_KINDS } from '../../domain/reactions/reactionKind'
import type { EventId, GuestId } from '../../domain/shared/ids'
import { compareIds } from './ordering'
import type { ContributorEntry } from '../../domain/stats/contributorRanking'
import type { StatsMetric } from '../../domain/stats/statsMetric'
import type {
  DerivedStats,
  EventStatsRepository,
  StatsCounter,
} from '../ports/eventStatsRepository'
import type { PhotoStatusCounts } from '../ports/photoRepository'
import type { FakeGuestRepository } from './fakeGuestRepository'
import type { FakePhotoRepository } from './fakePhotoRepository'
import type { FakeReactionRepository } from './fakeReactionRepository'

/**
 * In-memory `EventStatsRepository`, derived from the other fakes the way the adapter derives
 * from the other tables. It owns no row: `FakePhotoRepository.ofEvent` already leaves out a
 * taken-down photograph, and a reaction is counted only through a photograph it can still
 * reach, as the adapter's join does.
 */

const QUARTER_MS = 15 * 60 * 1_000

export class FakeEventStatsRepository implements EventStatsRepository {
  constructor(
    private readonly photos: FakePhotoRepository,
    private readonly guests: FakeGuestRepository,
    private readonly reactions: FakeReactionRepository,
  ) {}

  private readonly counters = new Map<string, StatsCounter & { readonly eventId: EventId }>()

  async bump(eventId: EventId, metric: StatsMetric, day: string, delta: number): Promise<void> {
    if (!Number.isSafeInteger(delta) || delta < 1) {
      throw new RangeError(`bump requires a positive integer delta, got ${delta}`)
    }
    const key = `${eventId}|${metric}|${day}`
    const current = this.counters.get(key)
    this.counters.set(key, { eventId, metric, day, value: (current?.value ?? 0) + delta })
  }

  async readCounters(eventId: EventId): Promise<readonly StatsCounter[]> {
    return [...this.counters.values()]
      .filter((counter) => counter.eventId === eventId)
      .map(({ metric, day, value }) => ({ metric, day, value }))
      .sort(
        (left, right) => compareIds(left.day, right.day) || compareIds(left.metric, right.metric),
      )
  }

  async readDerived(eventId: EventId): Promise<DerivedStats> {
    const photos = this.photos.ofEvent(eventId)
    const reachable = new Map(photos.map((photo) => [photo.id, photo]))
    const guests = await this.guests.list(eventId)

    const byStatus: Record<keyof PhotoStatusCounts, number> = {
      pending: 0,
      published: 0,
      rejected: 0,
      hidden: 0,
    }
    const quarters = new Map<number, number>()
    for (const photo of photos) {
      byStatus[photo.status] += 1
      const slot = Math.floor(photo.createdAt.getTime() / QUARTER_MS) * QUARTER_MS
      quarters.set(slot, (quarters.get(slot) ?? 0) + 1)
    }

    const byKind = emptyCounts() as Record<(typeof REACTION_KINDS)[number], number>
    const receivedBy = new Map<string, number>()
    let total = 0
    for (const reaction of this.reactions.ofEvent(eventId)) {
      const photo = reachable.get(reaction.photoId)
      if (photo === undefined) continue
      byKind[reaction.kind] += 1
      total += 1
      const author = guestOf(photo)
      if (author !== null && photo.status === 'published') {
        receivedBy.set(author, (receivedBy.get(author) ?? 0) + 1)
      }
    }

    const sentBy = new Map<string, number>()
    const publishedBy = new Map<string, number>()
    for (const photo of photos) {
      const author = guestOf(photo)
      if (author === null) continue
      sentBy.set(author, (sentBy.get(author) ?? 0) + 1)
      if (photo.status === 'published') publishedBy.set(author, (publishedBy.get(author) ?? 0) + 1)
    }

    const contributors: ContributorEntry[] = guests
      .filter((guest) => (publishedBy.get(guest.id) ?? 0) > 0)
      .map((guest) => ({
        guestId: guest.id,
        displayName: guest.displayName === null ? null : guest.displayName.value,
        revoked: guest.revokedAt !== null,
        photos: publishedBy.get(guest.id) ?? 0,
        reactions: receivedBy.get(guest.id) ?? 0,
      }))
      .sort((left, right) => compareIds(left.guestId, right.guestId))

    return {
      byQuarter: [...quarters.entries()]
        .sort(([left], [right]) => left - right)
        .map(([start, count]) => ({ start: new Date(start), count })),
      byStatus,
      guests: {
        joined: guests.length,
        contributors: guests.filter((guest) => (sentBy.get(guest.id) ?? 0) > 0).length,
        revoked: guests.filter((guest) => guest.revokedAt !== null).length,
      },
      reactions: { total, byKind },
      contributors,
    }
  }
}

const guestOf = (photo: Photo): GuestId | null =>
  photo.author.kind === 'guest' ? photo.author.guestId : null
