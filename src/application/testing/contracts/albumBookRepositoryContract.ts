import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AlbumBookRepository } from '../../ports/albumBookRepository'
import {
  failBook,
  finishBook,
  requestBook,
  startBook,
  type AlbumBook,
  type BookOptions,
  type BookResult,
} from '../../../domain/book/albumBook'
import type { BookPlan } from '../../../domain/book/bookPlan'
import { asEventId, asGuestbookEntryId, asGuestId, asPhotoId } from '../../../domain/shared/ids'

/** A plan as the engine writes it: ids and numbers, every optional key present once. */
const PLAN: BookPlan = {
  chapters: [
    {
      index: 0,
      startMs: 1_000,
      endMs: 9_000,
      photoCount: 2,
      title: { weekday: 6, moment: 'evening', continued: false },
      firstPage: 4,
    },
  ],
  pages: [
    { template: 'title', slots: [] },
    { template: 'wide', slots: [{ photoId: asPhotoId('p1') }], chapter: 0 },
    {
      template: 'twoStack',
      slots: [{ photoId: asPhotoId('p2') }, { photoId: asPhotoId('p3') }],
    },
    { template: 'quote', slots: [], messageIds: [asGuestbookEntryId('m1')] },
    { template: 'end', slots: [] },
  ],
  selectedCount: 3,
  counts: { photos: 9, photographers: 2, hearts: 5, messages: 1, voices: 0, videos: 1 },
  includedMessages: 1,
  extraMessages: 0,
  hearts: { p1: 3 },
  photographers: [{ guestId: asGuestId('g1'), photoCount: 3 }],
  favouritesPage: null,
  guestbookPage: 7,
}

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')

/** Events the subject must be able to hold books for (the SQLite one seeds them). */
export const ALBUM_BOOK_CONTRACT_FIXTURES = { eventIds: ['evt-wedding', 'evt-gala'] } as const

const OPTIONS: BookOptions = {
  title: 'Mariage de Léa & Tom',
  subtitle: '14 juin 2026',
  language: 'fr',
  style: 'souvenir',
  selection: { kind: 'best', target: 120 },
  showAuthors: true,
  showCaptions: false,
  includeGuestbook: true,
  printVersion: true,
  timeZone: 'America/New_York',
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
    const makeDone = async (
      eventId = WEDDING,
      byteSize = 1_000,
      print: Pick<BookResult, 'printByteSize' | 'printSkipped'> | null = null,
    ): Promise<AlbumBook> => {
      await request(eventId)
      const running = await repo.claimNext(at(1))
      if (running === null || running.eventId !== eventId) throw new Error('arrange: claim failed')
      const done = must(
        finishBook(
          running,
          {
            photoCount: 3,
            skippedCount: 1,
            pageCount: 6,
            byteSize,
            selectedCount: 3,
            printByteSize: print?.printByteSize ?? null,
            printSkipped: print?.printSkipped ?? null,
            expiresAt: at(60 * 24 * 7),
          },
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

    it('names the earliest request of the window, or none', async () => {
      await request(WEDDING, 20)
      await request(WEDDING, 10)
      await request(GALA, 1)

      expect(await repo.firstRequestSince(WEDDING, at(0))).toEqual(at(10))
      expect(await repo.firstRequestSince(WEDDING, at(11))).toEqual(at(20))
      expect(await repo.firstRequestSince(WEDDING, at(21))).toBeNull()
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

    it('shows the oldest queued book without claiming it', async () => {
      expect(await repo.findNextQueued()).toBeNull()
      await request(GALA, 5)
      const oldest = await request(WEDDING, 0)

      expect(await repo.findNextQueued()).toEqual(oldest)
      expect((await repo.find(WEDDING))?.status).toBe('queued')
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

    // -------------------------------------------------------------- finish --
    const RESULT = {
      photoCount: 3,
      skippedCount: 1,
      pageCount: 6,
      byteSize: 900,
      selectedCount: 3,
      printByteSize: null,
      printSkipped: null,
      expiresAt: at(60 * 24 * 7),
    }

    const makeRunning = async (eventId = WEDDING): Promise<AlbumBook> => {
      await request(eventId)
      const running = await repo.claimNext(at(1))
      if (running === null) throw new Error('arrange: claim failed')
      return running
    }

    it('finishes a running book as done, with the measures of the render', async () => {
      await makeRunning()

      expect(await repo.finish(WEDDING, { kind: 'finished', result: RESULT }, at(2))).toBe('done')

      expect(await repo.find(WEDDING)).toMatchObject({ status: 'done', doneAt: at(2), ...RESULT })
    })

    it('lets a fact stamped while the book rendered win: stale, never done', async () => {
      await makeRunning()
      await repo.invalidate(WEDDING, 'photoRemoved', at(2))

      expect(await repo.finish(WEDDING, { kind: 'finished', result: RESULT }, at(3))).toBe('stale')

      expect(await repo.find(WEDDING)).toMatchObject({
        status: 'stale',
        staleReason: 'photoRemoved',
      })
    })

    it('records a failure code on a running book', async () => {
      await makeRunning()

      expect(await repo.finish(WEDDING, { kind: 'failed', code: 'tooLarge' }, at(2))).toBe('failed')

      expect(await repo.find(WEDDING)).toMatchObject({ status: 'failed', failureCode: 'tooLarge' })
    })

    it('answers superseded and writes nothing when the host re-requested the book meanwhile', async () => {
      await makeRunning()
      const replacement = requestBook(WEDDING, { ...OPTIONS, title: 'Autre' }, at(5))
      await repo.saveRequest(replacement)

      expect(await repo.finish(WEDDING, { kind: 'finished', result: RESULT }, at(6))).toBe(
        'superseded',
      )
      expect(await repo.finish(WEDDING, { kind: 'failed', code: 'unexpected' }, at(6))).toBe(
        'superseded',
      )

      expect(await repo.find(WEDDING)).toEqual(replacement)
    })

    it('answers superseded when the host deleted the book meanwhile, and creates no row', async () => {
      await makeRunning()
      await repo.delete(WEDDING)

      expect(await repo.finish(WEDDING, { kind: 'finished', result: RESULT }, at(2))).toBe(
        'superseded',
      )

      expect(await repo.find(WEDDING)).toBeNull()
    })

    it('takes a verdict once: a second finish finds a book that is no longer running', async () => {
      await makeRunning()
      await repo.finish(WEDDING, { kind: 'finished', result: RESULT }, at(2))

      expect(await repo.finish(WEDDING, { kind: 'failed', code: 'unexpected' }, at(3))).toBe(
        'superseded',
      )

      expect(await repo.find(WEDDING)).toMatchObject({ status: 'done' })
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

    // ------------------------------------------------------- the plan and the printer --

    it('round-trips the selected count and the printer measures of a finished book', async () => {
      const done = await makeDone(WEDDING, 1_000, { printByteSize: 5_000, printSkipped: null })
      expect(await repo.find(WEDDING)).toEqual(done)
      expect(done).toMatchObject({ selectedCount: 3, printByteSize: 5_000, printSkipped: null })

      const skipped = await makeDone(GALA, 1_000, {
        printByteSize: null,
        printSkipped: 'tooManyPages',
      })
      expect(await repo.find(GALA)).toEqual(skipped)
    })

    it('round-trips every stale reason, the guest book one included', async () => {
      await request()
      const stale = await repo.invalidate(WEDDING, 'messageRemoved', at(3))
      expect(stale?.staleReason).toBe('messageRemoved')
      expect(await repo.find(WEDDING)).toEqual(stale)
    })

    it('records the plan of a running book and reads it back whole', async () => {
      const running = await makeRunning()

      expect(await repo.recordPlan(WEDDING, PLAN)).toBe(true)

      expect(await repo.find(WEDDING)).toEqual({ ...running, plan: PLAN })
    })

    it('refuses a plan for a book that is queued, finished or missing, and writes nothing', async () => {
      await makeDone(GALA)
      expect(await repo.recordPlan(GALA, PLAN)).toBe(false)
      expect((await repo.find(GALA))?.plan).toBeNull()

      await request()
      expect(await repo.recordPlan(WEDDING, PLAN)).toBe(false)
      expect((await repo.find(WEDDING))?.plan).toBeNull()

      expect(await repo.recordPlan(asEventId('evt-nobody'), PLAN)).toBe(false)
    })

    it('keeps the plan of a book that finishes, and voids it with the fact that voids the book', async () => {
      await makeRunning()
      await repo.recordPlan(WEDDING, PLAN)
      await repo.finish(WEDDING, { kind: 'finished', result: RESULT }, at(2))
      expect((await repo.find(WEDDING))?.plan).toEqual(PLAN)

      const stale = await repo.invalidate(WEDDING, 'messageRemoved', at(3))

      expect(stale).toMatchObject({ status: 'stale', plan: null })
      expect((await repo.find(WEDDING))?.plan).toBeNull()
    })

    it('voids the plan of a book that is still rendering when a fact arrives', async () => {
      await makeRunning()
      await repo.recordPlan(WEDDING, PLAN)

      await repo.invalidate(WEDDING, 'photoRemoved', at(3))

      expect(await repo.find(WEDDING)).toMatchObject({ status: 'running', plan: null })
    })

    it('refuses a plan once a fact has voided the running book, and writes nothing', async () => {
      await makeRunning()
      await repo.invalidate(WEDDING, 'messageRemoved', at(3))

      expect(await repo.recordPlan(WEDDING, PLAN)).toBe(false)
      expect((await repo.find(WEDDING))?.plan).toBeNull()
    })

    it('drops the plan of a render that fails', async () => {
      await makeRunning()
      await repo.recordPlan(WEDDING, PLAN)

      await repo.finish(WEDDING, { kind: 'failed', code: 'unexpected' }, at(2))

      expect(await repo.find(WEDDING)).toMatchObject({ status: 'failed', plan: null })
    })

    it('drops the plan of a render a crash interrupted: it goes back to the queue with none', async () => {
      await makeRunning()
      await repo.recordPlan(WEDDING, PLAN)

      expect(await repo.recoverRunning()).toBe(1)

      expect(await repo.find(WEDDING)).toMatchObject({ status: 'queued', plan: null })
    })

    it('starts every new request without a plan', async () => {
      await makeRunning()
      await repo.recordPlan(WEDDING, PLAN)
      await repo.finish(WEDDING, { kind: 'finished', result: RESULT }, at(2))

      await repo.saveRequest(requestBook(WEDDING, OPTIONS, at(5)))

      expect((await repo.find(WEDDING))?.plan).toBeNull()
    })

    it('counts the printer files in the bytes a box holds', async () => {
      await makeDone(WEDDING, 1_000, { printByteSize: 4_000, printSkipped: null })
      await makeDone(GALA, 2_500)

      expect(await repo.doneBytes()).toBe(7_500)
    })

    it('lists the finished books that have a printer version', async () => {
      await makeDone(WEDDING, 1_000, { printByteSize: 4_000, printSkipped: null })
      await makeDone(GALA, 2_500, { printByteSize: null, printSkipped: 'tooLarge' })

      expect(await repo.listDoneWithPrintEventIds()).toEqual([WEDDING])
    })
  })
}
