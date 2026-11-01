import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Guest } from '../../../domain/guests/guest'
import type { Photo } from '../../../domain/photos/photo'
import type { Reaction } from '../../../domain/reactions/reaction'
import { asEventId, asGuestId, type EventId } from '../../../domain/shared/ids'
import type { EventStatsRepository } from '../../ports/eventStatsRepository'
import { aGuest, aPhoto, aReaction, type PhotoInput } from '../builders'

/**
 * The shared `EventStatsRepository` contract (spec 05).
 *
 * The statistics are **derived**, so the interesting cases are the edges of the derivation: what
 * the operator took down, what another event holds, what an erasure removed, and where a
 * 15-minute slot ends. A subject hands over a `StatsWorld` to plant rows with, because the
 * repository under test only reads.
 */

/** Rows a subject must already hold: events (`photos` and `guests` reference them) and a host. */
export const STATS_CONTRACT_FIXTURES = {
  eventIds: ['evt-a', 'evt-b'],
  userIds: ['user-host'],
} as const

export interface StatsWorld {
  addGuest(guest: Guest): Promise<void>
  addPhoto(photo: Photo): Promise<void>
  addReaction(reaction: Reaction): Promise<void>
  takeDown(eventId: EventId, photoId: string): Promise<void>
  deletePhoto(eventId: EventId, photoId: string): Promise<void>
  /** What erasing a guest removes: the guest's row, their photographs and their reactions. */
  deleteGuest(eventId: EventId, guestId: string): Promise<void>
}

const A = asEventId('evt-a')
const B = asEventId('evt-b')

const at = (time: string): Date => new Date(`2026-06-20T${time}Z`)

const photo = (id: string, guest: string | null, extra: PhotoInput = {}): Photo =>
  aPhoto({
    id,
    eventId: 'evt-a',
    author: guest === null ? { kind: 'host', id: 'user-host' } : { kind: 'guest', id: guest },
    status: 'published',
    createdAt: at('19:30:00.000'),
    ...extra,
  })

const guest = (id: string, extra: Parameters<typeof aGuest>[0] = {}): Guest =>
  aGuest({ id, eventId: 'evt-a', displayName: id, ...extra })

const reaction = (id: string, photoId: string, by: string, kind: 'love' | 'laugh' = 'love') =>
  aReaction({ id, eventId: 'evt-a', photoId, guestId: by, kind })

export const eventStatsRepositoryContract = (
  name: string,
  makeSubject: () => Promise<{
    repo: EventStatsRepository
    world: StatsWorld
    dispose?: () => Promise<void>
  }>,
): void => {
  describe(`EventStatsRepository contract: ${name}`, () => {
    let repo: EventStatsRepository
    let world: StatsWorld
    let dispose: (() => Promise<void>) | undefined

    beforeEach(async () => {
      const subject = await makeSubject()
      repo = subject.repo
      world = subject.world
      dispose = subject.dispose
    })

    afterEach(async () => {
      await dispose?.()
    })

    it('reads zeroes and no slot for an event nobody has joined', async () => {
      const stats = await repo.readDerived(A)

      expect(stats).toEqual({
        byQuarter: [],
        byStatus: { pending: 0, published: 0, rejected: 0, hidden: 0 },
        guests: { joined: 0, contributors: 0, revoked: 0 },
        reactions: { total: 0, byKind: { love: 0, laugh: 0, wow: 0, cheers: 0, clap: 0 } },
        contributors: [],
      })
    })

    it('counts sends by status, hosts and clips included', async () => {
      await world.addGuest(guest('lea'))
      await world.addPhoto(photo('p1', 'lea'))
      await world.addPhoto(photo('p2', 'lea', { status: 'pending' }))
      await world.addPhoto(photo('p3', 'lea', { status: 'rejected' }))
      await world.addPhoto(photo('p4', 'lea', { status: 'hidden' }))
      await world.addPhoto(photo('p5', null))
      await world.addPhoto(photo('p6', 'lea', { clip: { durationMs: 4_000 } }))

      const { byStatus } = await repo.readDerived(A)

      expect(byStatus).toEqual({ pending: 1, published: 3, rejected: 1, hidden: 1 })
    })

    it('puts 19:14:59 and 19:15:00 in two slots, and keeps slots sparse and in order', async () => {
      await world.addGuest(guest('lea'))
      await world.addPhoto(photo('late', 'lea', { createdAt: at('19:15:00.000') }))
      await world.addPhoto(photo('early', 'lea', { createdAt: at('19:14:59.999') }))
      await world.addPhoto(photo('same', 'lea', { createdAt: at('19:29:59.000') }))
      await world.addPhoto(photo('night', 'lea', { createdAt: at('23:47:00.000') }))

      const { byQuarter } = await repo.readDerived(A)

      expect(byQuarter).toEqual([
        { start: at('19:00:00.000'), count: 1 },
        { start: at('19:15:00.000'), count: 2 },
        { start: at('23:45:00.000'), count: 1 },
      ])
    })

    it('leaves a photograph the operator took down out of every figure, reactions included', async () => {
      await world.addGuest(guest('lea'))
      await world.addGuest(guest('nils'))
      await world.addPhoto(photo('kept', 'lea'))
      await world.addPhoto(photo('gone', 'lea'))
      await world.addReaction(reaction('r1', 'kept', 'nils'))
      await world.addReaction(reaction('r2', 'gone', 'nils'))
      await world.addReaction(reaction('r3', 'gone', 'nils', 'laugh'))
      await world.takeDown(A, 'gone')

      const stats = await repo.readDerived(A)

      expect(stats.byStatus.published).toBe(1)
      expect(stats.byQuarter).toEqual([{ start: at('19:30:00.000'), count: 1 }])
      expect(stats.reactions).toEqual({
        total: 1,
        byKind: { love: 1, laugh: 0, wow: 0, cheers: 0, clap: 0 },
      })
      expect(stats.contributors).toEqual([
        expect.objectContaining({ guestId: asGuestId('lea'), photos: 1, reactions: 1 }),
      ])
    })

    it("does not let another event's rows into any figure", async () => {
      await world.addGuest(guest('lea'))
      await world.addGuest(aGuest({ id: 'sam', eventId: 'evt-b', displayName: 'Sam' }))
      await world.addPhoto(photo('mine', 'lea'))
      await world.addPhoto(
        aPhoto({
          id: 'theirs',
          eventId: 'evt-b',
          author: { kind: 'guest', id: 'sam' },
          status: 'published',
        }),
      )
      await world.addReaction(
        aReaction({ id: 'rb', eventId: 'evt-b', photoId: 'theirs', guestId: 'sam', kind: 'love' }),
      )

      const stats = await repo.readDerived(A)

      expect(stats.byStatus.published).toBe(1)
      expect(stats.guests.joined).toBe(1)
      expect(stats.reactions.total).toBe(0)
      expect(stats.byQuarter.map((slot) => slot.count)).toEqual([1])
      expect(stats.contributors.map((entry) => entry.guestId)).toEqual([asGuestId('lea')])
      expect((await repo.readDerived(B)).byStatus.published).toBe(1)
    })

    it('forgets a deleted photograph and an erased guest on the next read', async () => {
      await world.addGuest(guest('lea'))
      await world.addGuest(guest('nils'))
      await world.addPhoto(photo('p1', 'lea'))
      await world.addPhoto(photo('p2', 'nils'))
      await world.addReaction(reaction('r1', 'p1', 'nils'))
      expect((await repo.readDerived(A)).byStatus.published).toBe(2)

      await world.deletePhoto(A, 'p1')
      const afterDelete = await repo.readDerived(A)
      expect(afterDelete.byStatus.published).toBe(1)
      expect(afterDelete.reactions.total).toBe(0)

      await world.deleteGuest(A, 'nils')
      const afterErase = await repo.readDerived(A)
      expect(afterErase.byStatus.published).toBe(0)
      expect(afterErase.byQuarter).toEqual([])
      expect(afterErase.guests.joined).toBe(1)
    })

    it('counts a guest the host removed as joined and removed, flagged in the ranking', async () => {
      await world.addGuest(guest('lea', { revokedAt: at('20:00:00.000') }))
      await world.addGuest(guest('nils'))
      await world.addPhoto(photo('p1', 'lea'))
      await world.addReaction(reaction('r1', 'p1', 'nils'))

      const stats = await repo.readDerived(A)

      expect(stats.guests).toEqual({ joined: 2, contributors: 1, revoked: 1 })
      expect(stats.reactions.total).toBe(1)
      expect(stats.contributors).toEqual([
        expect.objectContaining({ guestId: asGuestId('lea'), revoked: true }),
      ])
    })

    it('counts reactions on every reachable photo but credits a guest only for published sends', async () => {
      await world.addGuest(guest('lea'))
      await world.addGuest(guest('nils'))
      await world.addPhoto(photo('shown', 'lea'))
      await world.addPhoto(photo('masked', 'lea', { status: 'hidden' }))
      await world.addReaction(reaction('r1', 'shown', 'nils'))
      await world.addReaction(reaction('r2', 'masked', 'nils'))
      await world.addReaction(reaction('r3', 'masked', 'nils', 'laugh'))

      const stats = await repo.readDerived(A)

      expect(stats.reactions.total).toBe(3)
      expect(stats.reactions.byKind.laugh).toBe(1)
      expect(stats.contributors).toEqual([
        expect.objectContaining({ guestId: asGuestId('lea'), photos: 1, reactions: 1 }),
      ])
    })

    it('keeps a nameless guest whose only photograph was taken down: joined, never ranked', async () => {
      // What `eraseGuestContribution` leaves when the operator took one of the photographs down.
      await world.addGuest(guest('ghost', { displayName: null }))
      await world.addPhoto(photo('evidence', 'ghost'))
      await world.takeDown(A, 'evidence')

      const stats = await repo.readDerived(A)

      expect(stats.guests).toEqual({ joined: 1, contributors: 0, revoked: 0 })
      expect(stats.contributors).toEqual([])
      expect(stats.byStatus.published).toBe(0)
    })

    it('counts a contributor whatever the status of their sends, and a host send as nobody', async () => {
      await world.addGuest(guest('lea'))
      await world.addGuest(guest('quiet'))
      await world.addPhoto(photo('p1', 'lea', { status: 'pending' }))
      await world.addPhoto(photo('p2', null))

      const stats = await repo.readDerived(A)

      expect(stats.guests).toEqual({ joined: 2, contributors: 1, revoked: 0 })
      expect(stats.contributors).toEqual([])
    })

    it('reads the guest name as written, or null', async () => {
      await world.addGuest(guest('lea', { displayName: 'Léa' }))
      await world.addGuest(guest('anon', { displayName: null }))
      await world.addPhoto(photo('p1', 'lea'))
      await world.addPhoto(photo('p2', 'anon'))

      const names = (await repo.readDerived(A)).contributors.map((entry) => entry.displayName)

      expect(names.sort()).toEqual(['Léa', null])
    })
  })
}
