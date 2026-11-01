import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AlbumBookRepository } from '../../ports/albumBookRepository'
import {
  failBook,
  finishBook,
  requestBook,
  startBook,
  type AlbumBook,
  type BookOptions,
} from '../../../domain/book/albumBook'
import { asEventId } from '../../../domain/shared/ids'

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')

/** Events the subject must be able to hold books for (the SQLite one seeds them). */
export const ALBUM_BOOK_CONTRACT_FIXTURES = { eventIds: ['evt-wedding', 'evt-gala'] } as const

const OPTIONS: BookOptions = {
  title: 'Mariage de Léa & Tom',
  subtitle: '14 juin 2026',
  language: 'fr',
  layout: 'four',
  showAuthors: true,
  showCaptions: false,
}

const T = new Date('2026-11-01T10:00:00.000Z')
const at = (minutes: number): Date => new Date(T.getTime() + minutes * 60_000)

export interface AlbumBookRepositorySubject {
  readonly repo: AlbumBookRepository
  readonly dispose?: () => Promise<void>
}

const must = <T>(result: { ok: boolean; value?: T }): T => {
  if (!result.ok || result.value === undefined) throw new Error('expected an ok result')
  return result.value
}

export const albumBookRepositoryContract = (
  name: string,
  makeSubject: () => Promise<AlbumBookRepositorySubject>,
): void => {
  describe(`AlbumBookRepository contract: ${name}`, () => {
    let repo: AlbumBookRepository
    let dispose: (() => Promise<void>) | undefined

    beforeEach(async () => {
      const subject = await makeSubject()
      repo = subject.repo
      dispose = subject.dispose
    })
    afterEach(async () => {
      await dispose?.()
    })

    const request = async (eventId = WEDDING, minutes = 0): Promise<AlbumBook> => {
      const book = requestBook(eventId, OPTIONS, at(minutes))
      await repo.saveRequest(book)
      return book
    }

    /** A request taken all the way to `done`, as the worker would. */
    const makeDone = async (eventId = WEDDING, byteSize = 1_000): Promise<AlbumBook> => {
      await request(eventId)
      const running = await repo.claimNext(at(1))
      if (running === null || running.eventId !== eventId) throw new Error('arrange: claim failed')
      const done = must(
        finishBook(
          running,
          { photoCount: 3, skippedCount: 1, pageCount: 6, byteSize, expiresAt: at(60 * 24 * 7) },
          at(2),
        ),
      )
      await repo.save(done)
      return done
    }

    it('finds nothing for an event that never asked for a book', async () => {
      expect(await repo.find(WEDDING)).toBeNull()
    })

    it('round-trips a request, options and dates included', async () => {
      const book = await request()

      expect(await repo.find(WEDDING)).toEqual(book)
    })

    it('round-trips a finished book with every measure', async () => {
      const done = await makeDone()

      expect(await repo.find(WEDDING)).toEqual(done)
    })

    it('round-trips a failure code and a stale reason', async () => {
      await request()
      const running = must(startBook((await repo.find(WEDDING)) as AlbumBook, at(1)))
      const failed = must(failBook(running, 'tooLarge'))
      await repo.save(failed)
      expect(await repo.find(WEDDING)).toEqual(failed)

      await request(GALA)
      const stale = await repo.invalidate(GALA, 'captionChanged', at(3))
      expect(stale?.staleReason).toBe('captionChanged')
      expect(await repo.find(GALA)).toEqual(stale)
    })

    it('keeps one book per event: a new request replaces the old row', async () => {
      await makeDone()
      const again = await request(WEDDING, 30)

      expect(await repo.find(WEDDING)).toEqual(again)
      expect((await repo.find(WEDDING))?.status).toBe('queued')
    })

    it('refuses to save a book that was never requested', async () => {
      await expect(repo.save(requestBook(WEDDING, OPTIONS, T))).rejects.toThrow()
    })

    it('never shows one event the book of another', async () => {
      await request(WEDDING)

      expect(await repo.find(GALA)).toBeNull()
    })

    // ------------------------------------------------------------ requests --
    it('counts the requests of one event from an instant on, the instant included', async () => {
      await request(WEDDING, 0)
      await request(WEDDING, 10)
      await request(WEDDING, 20)
      await request(GALA, 15)

      expect(await repo.countRequestsSince(WEDDING, at(10))).toBe(2)
      expect(await repo.countRequestsSince(WEDDING, at(11))).toBe(1)
      expect(await repo.countRequestsSince(WEDDING, at(-5))).toBe(3)
      expect(await repo.countRequestsSince(GALA, at(-5))).toBe(1)
    })

    it('keeps counting a request after its book was deleted, so deleting cannot reset the ceiling', async () => {
      await request(WEDDING, 0)
      await repo.delete(WEDDING)

      expect(await repo.find(WEDDING)).toBeNull()
      expect(await repo.countRequestsSince(WEDDING, at(-5))).toBe(1)
    })

    it('deletes idempotently', async () => {
      await expect(repo.delete(WEDDING)).resolves.toBeUndefined()
    })

    // --------------------------------------------------------------- claim --
    it('claims the oldest queued book and marks it running with the instant', async () => {
      await request(GALA, 5)
      await request(WEDDING, 0)

      const claimed = await repo.claimNext(at(9))

      expect(claimed).toMatchObject({ eventId: WEDDING, status: 'running', startedAt: at(9) })
      expect(await repo.find(WEDDING)).toEqual(claimed)
      expect((await repo.find(GALA))?.status).toBe('queued')
    })

    it('claims nothing when no book is queued, and never claims a running book twice', async () => {
      expect(await repo.claimNext(at(1))).toBeNull()
      await request(WEDDING)
      await repo.claimNext(at(1))

      expect(await repo.claimNext(at(2))).toBeNull()
    })

    it('puts a running book back in the queue after a crash, and says how many', async () => {
      await request(WEDDING, 0)
      await request(GALA, 1)
      await repo.claimNext(at(2))

      expect(await repo.recoverRunning()).toBe(1)
      expect(await repo.find(WEDDING)).toMatchObject({ status: 'queued', startedAt: null })
      expect(await repo.recoverRunning()).toBe(0)
    })

    // ---------------------------------------------------------- invalidate --
    it('turns a done book stale, with the reason and the instant', async () => {
      await makeDone()

      const stale = await repo.invalidate(WEDDING, 'photoRemoved', at(5))

      expect(stale).toMatchObject({
        status: 'stale',
        staleReason: 'photoRemoved',
        invalidatedAt: at(5),
      })
      expect(await repo.find(WEDDING)).toEqual(stale)
    })

    it('only records the instant on a book still queued or running', async () => {
      await request(WEDDING)
      const queued = await repo.invalidate(WEDDING, 'photoRemoved', at(3))
      expect(queued).toMatchObject({ status: 'queued', invalidatedAt: at(3) })

      await repo.claimNext(at(4))
      const running = await repo.invalidate(WEDDING, 'captionChanged', at(5))
      expect(running).toMatchObject({ status: 'running', invalidatedAt: at(5) })
    })

    it('answers null for an event with no book, and touches only the named event', async () => {
      expect(await repo.invalidate(WEDDING, 'photoRemoved', at(1))).toBeNull()

      await makeDone(GALA)
      await repo.invalidate(WEDDING, 'photoRemoved', at(1))
      expect((await repo.find(GALA))?.status).toBe('done')
    })

    // --------------------------------------------------------- box-wide reads --
    it('lists the events whose book is past its expiry', async () => {
      await makeDone(WEDDING)
      await makeDone(GALA)
      const gala = (await repo.find(GALA)) as AlbumBook
      await repo.save({ ...gala, expiresAt: at(3) })

      expect(await repo.listExpired(at(2))).toEqual([])
      expect(await repo.listExpired(at(3))).toEqual([GALA])
      expect([...(await repo.listExpired(at(60 * 24 * 8)))].sort()).toEqual([GALA, WEDDING])
    })

    it('separates the events that hold a file from those still working', async () => {
      await makeDone(WEDDING)
      await request(GALA)

      expect(await repo.listDoneEventIds()).toEqual([WEDDING])
      expect(await repo.listActiveEventIds()).toEqual([GALA])
    })

    it('adds up the bytes of finished books only', async () => {
      await makeDone(WEDDING, 1_000)
      await makeDone(GALA, 2_500)
      await repo.invalidate(GALA, 'photoRemoved', at(9))
      await repo.saveRequest(requestBook(GALA, OPTIONS, at(10)))

      expect(await repo.doneBytes()).toBe(1_000)
    })

    it('reports zero bytes when nothing is finished', async () => {
      expect(await repo.doneBytes()).toBe(0)
    })
  })
}
