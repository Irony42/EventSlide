import { beforeEach, describe, expect, it } from 'vitest'
import {
  finishBook,
  requestBook,
  startBook,
  type AlbumBook,
  type BookOptions,
} from '../../../domain/book/albumBook'
import { asEventId } from '../../../domain/shared/ids'
import { AT, atPlus } from '../../testing/builders'
import { CapturingLogger } from '../../testing/capturingLogger'
import { FakeAlbumBookRepository } from '../../testing/fakeAlbumBookRepository'
import { FakeBookFileStore } from '../../testing/fakeBookFileStore'
import { FakeClock } from '../../testing/fakeClock'
import { RecordingEventBus } from '../../testing/recordingEventBus'
import { makeSweepAlbumBooks, type SweepAlbumBooks } from './sweepAlbumBooks'

const A = asEventId('evt-a')
const B = asEventId('evt-b')
const OPTIONS: BookOptions = {
  title: 'T',
  subtitle: '',
  language: 'fr',
  layout: 'one',
  showAuthors: true,
  showCaptions: true,
}
const FILE = new TextEncoder().encode('%PDF-')

let books: FakeAlbumBookRepository
let bookFiles: FakeBookFileStore
let bus: RecordingEventBus
let clock: FakeClock
let logger: CapturingLogger
let sweep: SweepAlbumBooks

/** A book finished at `AT`, expiring `days` later, with its file. */
const finishedBook = async (eventId = A, days = 7, withFile = true): Promise<void> => {
  const queued = requestBook(eventId, OPTIONS, AT)
  await books.saveRequest(queued)
  const running = await books.claimNext(AT)
  if (running === null) throw new Error('arrange')
  const done = finishBook(
    running,
    {
      photoCount: 1,
      skippedCount: 0,
      pageCount: 3,
      byteSize: 5,
      expiresAt: atPlus(days * 86_400_000),
    },
    AT,
  )
  if (!done.ok) throw new Error('arrange')
  await books.save(done.value)
  if (withFile) bookFiles.seed(eventId, FILE)
}

beforeEach(() => {
  books = new FakeAlbumBookRepository()
  bookFiles = new FakeBookFileStore()
  bus = new RecordingEventBus()
  clock = new FakeClock(atPlus(86_400_000))
  logger = new CapturingLogger()
  sweep = makeSweepAlbumBooks({ books, bookFiles, bus, clock, logger })
})

describe('sweepAlbumBooks', () => {
  it('keeps a valid book and its file, and logs nothing', async () => {
    await finishedBook()

    expect(await sweep()).toEqual({ expired: 0, missing: 0, orphans: 0 })
    expect(bookFiles.has(A)).toBe(true)
    expect(logger.lines).toEqual([])
  })

  it('deletes an expired book, its row and its file, and tells the console', async () => {
    await finishedBook(A, 1)
    clock.advance(1)

    expect(await sweep()).toEqual({ expired: 1, missing: 0, orphans: 0 })
    expect(await books.find(A)).toBeNull()
    expect(bookFiles.has(A)).toBe(false)
    expect(bus.published).toEqual([{ type: 'book.changed', eventId: A }])
  })

  it('does not expire a book the instant before its expiry', async () => {
    await finishedBook(A, 2)

    expect((await sweep()).expired).toBe(0)
  })

  it('makes a done book stale when its file is gone, so the host is told to rebuild', async () => {
    await finishedBook(A, 7, false)

    expect(await sweep()).toEqual({ expired: 0, missing: 1, orphans: 0 })
    expect(await books.find(A)).toMatchObject({ status: 'stale', staleReason: 'fileMissing' })
    expect(bus.published).toEqual([{ type: 'book.changed', eventId: A }])
  })

  it('deletes a file no book owns, such as one left by a crash or by a stale book', async () => {
    bookFiles.seed(B, FILE)

    expect(await sweep()).toEqual({ expired: 0, missing: 0, orphans: 1 })
    expect(bookFiles.has(B)).toBe(false)
  })

  it('deletes the file of a stale book', async () => {
    await finishedBook()
    await books.invalidate(A, 'photoRemoved', clock.now())
    bookFiles.seed(A, FILE)

    expect((await sweep()).orphans).toBe(1)
    expect(bookFiles.has(A)).toBe(false)
  })

  it('keeps the older file of a book being rebuilt: the render replaces it, the sweep must not', async () => {
    await books.saveRequest(requestBook(A, OPTIONS, atPlus(1)))
    bookFiles.seed(A, FILE)

    expect((await sweep()).orphans).toBe(0)
    expect(bookFiles.has(A)).toBe(true)
  })

  it('keeps the file of a book that is being made right now', async () => {
    await books.saveRequest(requestBook(A, OPTIONS, atPlus(1)))
    await books.claimNext(atPlus(2))
    const running = (await books.find(A)) as AlbumBook
    expect(startBook(running, atPlus(3)).ok).toBe(false)
    bookFiles.seed(A, FILE)

    expect((await sweep()).orphans).toBe(0)
  })

  it('counts an expired book once, not again as an orphan', async () => {
    await finishedBook(A, 1)
    clock.advance(86_400_000)

    expect(await sweep()).toEqual({ expired: 1, missing: 0, orphans: 0 })
  })
})
