import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asEventId, asGuestId, asPhotoId, asUserId } from '../../../domain/shared/ids'
import type { PhotoReview } from '../../../domain/photos/photo'
import type { PhotoStatus } from '../../../domain/photos/photoStatus'
import type { PhotoRepository } from '../../ports/photoRepository'
import { AT, aPhoto, atPlus } from '../builders'

/**
 * The shared `PhotoRepository` contract.
 *
 * Run by the SQLite adapter and by `FakePhotoRepository`. That is the whole point: a
 * fake that drifts from the adapter turns every use-case test in the suite into a lie,
 * and the drift is invisible until an evening at a venue. Adding a port method means
 * adding a case here.
 *
 * The cross-event cases are the most important tests in this codebase. Tenant
 * isolation in this product *is* "was the event id part of the query", so every scoped
 * method is asked for a real id under the wrong event and must miss.
 */

/**
 * Rows the subject must already hold, because `photos` carries foreign keys to
 * `events`, `guests` and `users`. A `:memory:` adapter harness seeds these before
 * handing the repository over; the fake needs nothing.
 */
export const PHOTO_CONTRACT_FIXTURES = {
  eventIds: ['evt-wedding', 'evt-gala'],
  /** `guest-lea` and `guest-nils` belong to the wedding, `guest-sam` to the gala. */
  guestIds: ['guest-lea', 'guest-nils', 'guest-sam'],
  /** A host, as an author and as the reviewer on a host decision. */
  userIds: ['user-host'],
} as const

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')
const LEA = asGuestId('guest-lea')
const NILS = asGuestId('guest-nils')
const SAM = asGuestId('guest-sam')
const HOST = asUserId('user-host')

const AUTOMATIC: PhotoReview = { kind: 'automatic', at: AT }

/**
 * Fail in the arrange step rather than feed a bogus cursor into the act, so a missing
 * cursor is reported as a missing cursor instead of as a rejected read.
 */
const requireCursor = (page: { readonly nextCursor: string | null }): string => {
  if (page.nextCursor === null) throw new Error('expected a page to report a next cursor')
  return page.nextCursor
}

export const photoRepositoryContract = (
  name: string,
  makeSubject: () => Promise<{ repo: PhotoRepository; dispose?: () => Promise<void> }>,
): void => {
  describe(`PhotoRepository contract: ${name}`, () => {
    let repo: PhotoRepository
    let dispose: (() => Promise<void>) | undefined

    beforeEach(async () => {
      const subject = await makeSubject()
      repo = subject.repo
      dispose = subject.dispose
    })

    afterEach(async () => {
      await dispose?.()
    })

    // ------------------------------------------------------------ round trip --

    it('round-trips every field of a saved photo', async () => {
      const photo = aPhoto({
        id: 'p1',
        eventId: WEDDING,
        author: { kind: 'guest', id: LEA },
        status: 'published',
        byteSize: 2_048,
        width: 1_600,
        height: 1_200,
        caption: 'Les mariés arrivent',
        createdAt: atPlus(5_000),
        review: { kind: 'host', userId: HOST, at: atPlus(9_000) },
      })

      await repo.save(photo)
      const stored = await repo.findById(WEDDING, asPhotoId('p1'))

      expect(stored?.eventId).toBe(WEDDING)
      expect(stored?.status).toBe('published')
      expect(stored?.byteSize).toBe(2_048)
      expect(stored?.dimensions.width).toBe(1_600)
      expect(stored?.dimensions.height).toBe(1_200)
      expect(stored?.caption?.value).toBe('Les mariés arrivent')
      expect(stored?.contentHash.value).toBe(photo.contentHash.value)
      expect(stored?.createdAt.toISOString()).toBe(atPlus(5_000).toISOString())
      expect(stored?.author).toEqual({ kind: 'guest', guestId: LEA })
      expect(stored?.review).toEqual({ kind: 'host', userId: HOST, at: atPlus(9_000) })
    })

    it('round-trips a photo uploaded by a host rather than a guest', async () => {
      await repo.save(aPhoto({ id: 'p1', eventId: WEDDING, author: { kind: 'host', id: HOST } }))

      const stored = await repo.findById(WEDDING, asPhotoId('p1'))

      expect(stored?.author).toEqual({ kind: 'host', userId: HOST })
    })

    it('round-trips a photo with no caption and no moderation decision', async () => {
      await repo.save(aPhoto({ id: 'p1', eventId: WEDDING, status: 'pending', caption: null }))

      const stored = await repo.findById(WEDDING, asPhotoId('p1'))

      expect(stored?.caption).toBeNull()
      expect(stored?.review).toBeNull()
    })

    it('replaces the stored row when the same photo is saved again', async () => {
      const photo = aPhoto({ id: 'p1', eventId: WEDDING, status: 'pending' })
      await repo.save(photo)

      const published = photo.publish({ kind: 'automatic' }, atPlus(1_000))
      await repo.save(published.ok ? published.value : photo)

      expect((await repo.findById(WEDDING, asPhotoId('p1')))?.status).toBe('published')
    })

    // ----------------------------------------------------------------- misses --

    it('returns null for a photo id that does not exist', async () => {
      expect(await repo.findById(WEDDING, asPhotoId('nope'))).toBeNull()
    })

    it('returns null for a photo that belongs to another event', async () => {
      await repo.save(aPhoto({ id: 'p1', eventId: GALA, author: { kind: 'guest', id: SAM } }))

      expect(await repo.findById(WEDDING, asPhotoId('p1'))).toBeNull()
    })

    it('returns null for a content hash held only by another event', async () => {
      const gala = aPhoto({ id: 'p1', eventId: GALA, author: { kind: 'guest', id: SAM } })
      await repo.save(gala)

      expect(await repo.findByContentHash(WEDDING, gala.contentHash)).toBeNull()
    })

    it('finds a photo by its content hash inside its own event', async () => {
      const photo = aPhoto({ id: 'p1', eventId: WEDDING })
      await repo.save(photo)

      expect((await repo.findByContentHash(WEDDING, photo.contentHash))?.id).toBe('p1')
    })

    // --------------------------------------------------------------- ordering --

    it('lists newest first', async () => {
      await repo.saveMany([
        aPhoto({ id: 'p-old', eventId: WEDDING, createdAt: atPlus(0) }),
        aPhoto({ id: 'p-new', eventId: WEDDING, createdAt: atPlus(2_000) }),
        aPhoto({ id: 'p-mid', eventId: WEDDING, createdAt: atPlus(1_000) }),
      ])

      const page = await repo.list(WEDDING)

      expect(page.items.map((photo) => photo.id)).toEqual(['p-new', 'p-mid', 'p-old'])
    })

    it('breaks a timestamp tie by ascending id, so two clients agree on the order', async () => {
      await repo.saveMany([
        aPhoto({ id: 'p-b', eventId: WEDDING, createdAt: AT }),
        aPhoto({ id: 'p-a', eventId: WEDDING, createdAt: AT }),
        aPhoto({ id: 'p-c', eventId: WEDDING, createdAt: AT }),
      ])

      const page = await repo.list(WEDDING)

      expect(page.items.map((photo) => photo.id)).toEqual(['p-a', 'p-b', 'p-c'])
    })

    it('lists only the requested event', async () => {
      await repo.save(aPhoto({ id: 'p1', eventId: WEDDING }))
      await repo.save(aPhoto({ id: 'p2', eventId: GALA, author: { kind: 'guest', id: SAM } }))

      const page = await repo.list(WEDDING)

      expect(page.items.map((photo) => photo.id)).toEqual(['p1'])
    })

    // -------------------------------------------------------------- filtering --

    const statuses: readonly PhotoStatus[] = ['pending', 'published', 'rejected', 'hidden']

    it.each(statuses)('filters the listing down to %s', async (status) => {
      await repo.saveMany(
        statuses.map((each) => aPhoto({ id: `p-${each}`, eventId: WEDDING, status: each })),
      )

      const page = await repo.list(WEDDING, { statuses: [status] })

      expect(page.items.map((photo) => photo.id)).toEqual([`p-${status}`])
    })

    it('accepts several statuses at once', async () => {
      await repo.saveMany([
        aPhoto({ id: 'p1', eventId: WEDDING, status: 'published', createdAt: atPlus(2_000) }),
        aPhoto({ id: 'p2', eventId: WEDDING, status: 'hidden', createdAt: atPlus(1_000) }),
        aPhoto({ id: 'p3', eventId: WEDDING, status: 'rejected', createdAt: atPlus(0) }),
      ])

      const page = await repo.list(WEDDING, { statuses: ['published', 'hidden'] })

      expect(page.items.map((photo) => photo.id)).toEqual(['p1', 'p2'])
    })

    it('filters the listing by author', async () => {
      await repo.saveMany([
        aPhoto({ id: 'p-lea', eventId: WEDDING, author: { kind: 'guest', id: LEA } }),
        aPhoto({ id: 'p-nils', eventId: WEDDING, author: { kind: 'guest', id: NILS } }),
      ])

      const page = await repo.list(WEDDING, { authoredBy: LEA })

      expect(page.items.map((photo) => photo.id)).toEqual(['p-lea'])
    })

    it('never attributes a host upload to a guest', async () => {
      await repo.save(aPhoto({ id: 'p1', eventId: WEDDING, author: { kind: 'host', id: HOST } }))

      const page = await repo.list(WEDDING, { authoredBy: LEA })

      expect(page.items).toEqual([])
    })

    // ------------------------------------------------------------- pagination --

    it('pages through the listing without repeating or skipping a photo', async () => {
      await repo.saveMany([
        aPhoto({ id: 'p1', eventId: WEDDING, createdAt: atPlus(0) }),
        aPhoto({ id: 'p2', eventId: WEDDING, createdAt: atPlus(1_000) }),
        aPhoto({ id: 'p3', eventId: WEDDING, createdAt: atPlus(2_000) }),
      ])

      const first = await repo.list(WEDDING, { limit: 2 })
      const second = await repo.list(WEDDING, { limit: 2, cursor: requireCursor(first) })

      expect(first.items.map((photo) => photo.id)).toEqual(['p3', 'p2'])
      expect(second.items.map((photo) => photo.id)).toEqual(['p1'])
    })

    it('reports no cursor on the last page', async () => {
      await repo.saveMany([
        aPhoto({ id: 'p1', eventId: WEDDING, createdAt: atPlus(0) }),
        aPhoto({ id: 'p2', eventId: WEDDING, createdAt: atPlus(1_000) }),
      ])

      const page = await repo.list(WEDDING, { limit: 2 })

      expect(page.nextCursor).toBeNull()
    })

    it('reports no cursor for an event with no photos', async () => {
      const page = await repo.list(WEDDING, { limit: 10 })

      expect(page).toEqual({ items: [], nextCursor: null })
    })

    it('carries the status filter across a page boundary', async () => {
      await repo.saveMany([
        aPhoto({ id: 'p1', eventId: WEDDING, status: 'published', createdAt: atPlus(0) }),
        aPhoto({ id: 'p2', eventId: WEDDING, status: 'pending', createdAt: atPlus(1_000) }),
        aPhoto({ id: 'p3', eventId: WEDDING, status: 'published', createdAt: atPlus(2_000) }),
      ])

      const first = await repo.list(WEDDING, { statuses: ['published'], limit: 1 })
      const second = await repo.list(WEDDING, {
        statuses: ['published'],
        limit: 1,
        cursor: requireCursor(first),
      })

      expect(first.items.map((photo) => photo.id)).toEqual(['p3'])
      expect(second.items.map((photo) => photo.id)).toEqual(['p1'])
    })

    it('rejects a cursor it did not issue', async () => {
      // Silently restarting from page one would show a guest an album that repeats
      // itself forever instead of surfacing the paging bug.
      await expect(repo.list(WEDDING, { cursor: 'not-a-cursor' })).rejects.toThrow()
    })

    it.each([0, -1, 1.5])('rejects a limit of %s', async (limit) => {
      // `LIMIT 0` would answer with an empty page and no cursor, which a caller reads
      // as "the album ended".
      await expect(repo.list(WEDDING, { limit })).rejects.toThrow()
    })

    // ------------------------------------------------------------- wall ids --

    it('lists ids for one status, newest first, up to the limit', async () => {
      await repo.saveMany([
        aPhoto({ id: 'p1', eventId: WEDDING, status: 'published', createdAt: atPlus(0) }),
        aPhoto({ id: 'p2', eventId: WEDDING, status: 'published', createdAt: atPlus(1_000) }),
        aPhoto({ id: 'p3', eventId: WEDDING, status: 'pending', createdAt: atPlus(2_000) }),
      ])

      expect(await repo.listIdsByStatus(WEDDING, 'published', 10)).toEqual(['p2', 'p1'])
    })

    it('honours the id limit so the wall never loads an unbounded playlist', async () => {
      await repo.saveMany([
        aPhoto({ id: 'p1', eventId: WEDDING, status: 'published', createdAt: atPlus(0) }),
        aPhoto({ id: 'p2', eventId: WEDDING, status: 'published', createdAt: atPlus(1_000) }),
      ])

      expect(await repo.listIdsByStatus(WEDDING, 'published', 1)).toEqual(['p2'])
    })

    it('never lists the published ids of another event', async () => {
      await repo.save(
        aPhoto({
          id: 'p1',
          eventId: GALA,
          status: 'published',
          author: { kind: 'guest', id: SAM },
        }),
      )

      expect(await repo.listIdsByStatus(WEDDING, 'published', 10)).toEqual([])
    })

    // ------------------------------------------------------------- counters --

    it('counts every status of one event', async () => {
      await repo.saveMany([
        aPhoto({ id: 'p1', eventId: WEDDING, status: 'pending' }),
        aPhoto({ id: 'p2', eventId: WEDDING, status: 'pending' }),
        aPhoto({ id: 'p3', eventId: WEDDING, status: 'published' }),
        aPhoto({ id: 'p4', eventId: WEDDING, status: 'hidden' }),
      ])

      expect(await repo.countsByStatus(WEDDING)).toEqual({
        pending: 2,
        published: 1,
        rejected: 0,
        hidden: 1,
      })
    })

    it('reports a zero for every status of an event with no photos', async () => {
      expect(await repo.countsByStatus(WEDDING)).toEqual({
        pending: 0,
        published: 0,
        rejected: 0,
        hidden: 0,
      })
    })

    it('counts statuses for the asked event only', async () => {
      await repo.save(
        aPhoto({
          id: 'p1',
          eventId: GALA,
          status: 'pending',
          author: { kind: 'guest', id: SAM },
        }),
      )

      expect((await repo.countsByStatus(WEDDING)).pending).toBe(0)
    })

    it('sums bytes across every status, because storage does not care', async () => {
      await repo.saveMany([
        aPhoto({ id: 'p1', eventId: WEDDING, status: 'published', byteSize: 1_000 }),
        aPhoto({ id: 'p2', eventId: WEDDING, status: 'rejected', byteSize: 200 }),
      ])

      expect(await repo.totalBytes(WEDDING)).toBe(1_200)
    })

    it('sums bytes for one event only, so a quota is never spent by another party', async () => {
      await repo.save(
        aPhoto({
          id: 'p1',
          eventId: GALA,
          byteSize: 9_000,
          author: { kind: 'guest', id: SAM },
        }),
      )

      expect(await repo.totalBytes(WEDDING)).toBe(0)
    })

    it('reports zero bytes for an event with no photos', async () => {
      expect(await repo.totalBytes(WEDDING)).toBe(0)
    })

    it('counts a guest own photos', async () => {
      await repo.saveMany([
        aPhoto({ id: 'p1', eventId: WEDDING, author: { kind: 'guest', id: LEA } }),
        aPhoto({ id: 'p2', eventId: WEDDING, author: { kind: 'guest', id: LEA } }),
        aPhoto({ id: 'p3', eventId: WEDDING, author: { kind: 'guest', id: NILS } }),
      ])

      expect(await repo.countByAuthor(WEDDING, LEA)).toBe(2)
    })

    it('counts a guest photos in the asked event only', async () => {
      await repo.save(aPhoto({ id: 'p1', eventId: GALA, author: { kind: 'guest', id: LEA } }))

      expect(await repo.countByAuthor(WEDDING, LEA)).toBe(0)
    })

    // ------------------------------------------------------------ uniqueness --

    it('refuses a second photo with the same content hash in the same event', async () => {
      const first = aPhoto({ id: 'p1', eventId: WEDDING })
      await repo.save(first)

      await expect(
        repo.save(aPhoto({ id: 'p2', eventId: WEDDING, contentHash: first.contentHash.value })),
      ).rejects.toThrow()
    })

    it('accepts the same content hash in a different event', async () => {
      const wedding = aPhoto({ id: 'p1', eventId: WEDDING })
      await repo.save(wedding)

      await repo.save(
        aPhoto({
          id: 'p2',
          eventId: GALA,
          author: { kind: 'guest', id: SAM },
          contentHash: wedding.contentHash.value,
        }),
      )

      expect((await repo.findById(GALA, asPhotoId('p2')))?.id).toBe('p2')
    })

    it('writes nothing at all when one photo of a batch is a duplicate', async () => {
      const first = aPhoto({ id: 'p1', eventId: WEDDING })
      await repo.save(first)

      await expect(
        repo.saveMany([
          aPhoto({ id: 'p2', eventId: WEDDING }),
          aPhoto({ id: 'p3', eventId: WEDDING, contentHash: first.contentHash.value }),
        ]),
      ).rejects.toThrow()

      expect(await repo.findById(WEDDING, asPhotoId('p2'))).toBeNull()
    })

    it('writes every photo of a valid batch', async () => {
      await repo.saveMany([
        aPhoto({ id: 'p1', eventId: WEDDING }),
        aPhoto({ id: 'p2', eventId: WEDDING }),
      ])

      expect((await repo.list(WEDDING)).items).toHaveLength(2)
    })

    it('accepts an empty batch, because a caller filtered every file out', async () => {
      await repo.saveMany([])

      expect((await repo.list(WEDDING)).items).toEqual([])
    })

    // ---------------------------------------------------------------- delete --

    it('deletes a photo', async () => {
      await repo.save(aPhoto({ id: 'p1', eventId: WEDDING }))

      await repo.delete(WEDDING, asPhotoId('p1'))

      expect(await repo.findById(WEDDING, asPhotoId('p1'))).toBeNull()
    })

    it('is idempotent on delete', async () => {
      await repo.save(aPhoto({ id: 'p1', eventId: WEDDING }))
      await repo.delete(WEDDING, asPhotoId('p1'))

      await expect(repo.delete(WEDDING, asPhotoId('p1'))).resolves.toBeUndefined()
    })

    it('does not delete another event photo of the same id', async () => {
      await repo.save(aPhoto({ id: 'p1', eventId: GALA, author: { kind: 'guest', id: SAM } }))

      await repo.delete(WEDDING, asPhotoId('p1'))

      expect((await repo.findById(GALA, asPhotoId('p1')))?.id).toBe('p1')
    })

    // ------------------------------------------------------ bulk moderation --

    it('returns the ids it actually moved', async () => {
      await repo.saveMany([
        aPhoto({ id: 'p1', eventId: WEDDING, status: 'pending' }),
        aPhoto({ id: 'p2', eventId: WEDDING, status: 'pending' }),
      ])

      const changed = await repo.updateStatuses(
        WEDDING,
        [asPhotoId('p1'), asPhotoId('p2')],
        'published',
        AUTOMATIC,
      )

      expect([...changed].sort()).toEqual(['p1', 'p2'])
      expect((await repo.findById(WEDDING, asPhotoId('p1')))?.status).toBe('published')
    })

    it('records the decision on every photo it moved', async () => {
      await repo.save(aPhoto({ id: 'p1', eventId: WEDDING, status: 'pending' }))

      await repo.updateStatuses(WEDDING, [asPhotoId('p1')], 'published', {
        kind: 'host',
        userId: HOST,
        at: atPlus(60_000),
      })

      expect((await repo.findById(WEDDING, asPhotoId('p1')))?.review).toEqual({
        kind: 'host',
        userId: HOST,
        at: atPlus(60_000),
      })
    })

    it('omits a photo already in the target status, so nothing is announced twice', async () => {
      await repo.saveMany([
        aPhoto({ id: 'p1', eventId: WEDDING, status: 'published' }),
        aPhoto({ id: 'p2', eventId: WEDDING, status: 'pending' }),
      ])

      const changed = await repo.updateStatuses(
        WEDDING,
        [asPhotoId('p1'), asPhotoId('p2')],
        'published',
        AUTOMATIC,
      )

      expect(changed).toEqual(['p2'])
    })

    it('omits an id that does not exist', async () => {
      const changed = await repo.updateStatuses(
        WEDDING,
        [asPhotoId('nope')],
        'published',
        AUTOMATIC,
      )

      expect(changed).toEqual([])
    })

    it('refuses to moderate a photo through the wrong event', async () => {
      await repo.save(
        aPhoto({
          id: 'p1',
          eventId: GALA,
          status: 'pending',
          author: { kind: 'guest', id: SAM },
        }),
      )

      const changed = await repo.updateStatuses(WEDDING, [asPhotoId('p1')], 'published', AUTOMATIC)

      expect(changed).toEqual([])
      expect((await repo.findById(GALA, asPhotoId('p1')))?.status).toBe('pending')
    })

    it('omits a photo whose transition the status machine refuses', async () => {
      // pending → hidden is not a transition: a photo that never reached the wall
      // cannot be taken off it.
      await repo.save(aPhoto({ id: 'p1', eventId: WEDDING, status: 'pending' }))

      const changed = await repo.updateStatuses(WEDDING, [asPhotoId('p1')], 'hidden', AUTOMATIC)

      expect(changed).toEqual([])
      expect((await repo.findById(WEDDING, asPhotoId('p1')))?.status).toBe('pending')
    })

    it('moves what it can when a selection is mixed', async () => {
      await repo.saveMany([
        aPhoto({ id: 'p1', eventId: WEDDING, status: 'pending' }),
        aPhoto({ id: 'p2', eventId: WEDDING, status: 'published' }),
      ])

      const changed = await repo.updateStatuses(
        WEDDING,
        [asPhotoId('p1'), asPhotoId('p2'), asPhotoId('nope')],
        'rejected',
        AUTOMATIC,
      )

      expect([...changed].sort()).toEqual(['p1', 'p2'])
    })

    // ------------------------------------------------------------- export --

    const collect = async (
      stream: AsyncIterable<{ readonly id: string }>,
    ): Promise<readonly string[]> => {
      const ids: string[] = []
      for await (const photo of stream) ids.push(photo.id)
      return ids
    }

    it('streams the album in the listing order', async () => {
      await repo.saveMany([
        aPhoto({ id: 'p1', eventId: WEDDING, status: 'published', createdAt: atPlus(0) }),
        aPhoto({ id: 'p2', eventId: WEDDING, status: 'published', createdAt: atPlus(1_000) }),
      ])

      expect(await collect(repo.streamForExport(WEDDING, ['published']))).toEqual(['p2', 'p1'])
    })

    it('streams only the requested statuses, so a rejected photo stays out of the zip', async () => {
      await repo.saveMany([
        aPhoto({ id: 'p1', eventId: WEDDING, status: 'published' }),
        aPhoto({ id: 'p2', eventId: WEDDING, status: 'rejected' }),
      ])

      expect(await collect(repo.streamForExport(WEDDING, ['published', 'hidden']))).toEqual(['p1'])
    })

    it('streams one event only', async () => {
      await repo.save(
        aPhoto({
          id: 'p1',
          eventId: GALA,
          status: 'published',
          author: { kind: 'guest', id: SAM },
        }),
      )

      expect(await collect(repo.streamForExport(WEDDING, ['published']))).toEqual([])
    })
  })
}
