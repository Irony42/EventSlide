import { beforeEach, describe, expect, it } from 'vitest'
import { requestBook, type BookOptions } from '../../../domain/book/albumBook'
import { BOOK_WINDOW_MS } from '../../../domain/book/bookCaps'
import { asEventId } from '../../../domain/shared/ids'
import { AT, aClient, anEvent, aPhoto, atPlus } from '../../testing/builders'
import { CapturingLogger } from '../../testing/capturingLogger'
import { FakeAlbumBookRepository } from '../../testing/fakeAlbumBookRepository'
import { FakeBookFileStore } from '../../testing/fakeBookFileStore'
import { FakeClientRepository } from '../../testing/fakeClientRepository'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'
import { RecordingEventBus } from '../../testing/recordingEventBus'
import { makeDeleteAlbumBook } from './deleteAlbumBook'
import { makeDownloadAlbumBook } from './downloadAlbumBook'
import { makeGetAlbumBook } from './getAlbumBook'
import { makeInvalidateAlbumBook } from './invalidateAlbumBook'
import { makeRequestAlbumBook, type RequestAlbumBookInput } from './requestAlbumBook'

const EVENT = asEventId('event-1')
const OTHER = asEventId('event-2')

const OPTIONS: BookOptions = {
  title: 'Mariage de Léa',
  subtitle: '',
  language: 'fr',
  layout: 'one',
  showAuthors: true,
  showCaptions: true,
}

const INPUT: RequestAlbumBookInput = {
  eventId: EVENT,
  title: '  Mariage de Léa ',
  layout: 'four',
  showAuthors: false,
  showCaptions: true,
}

let clients: FakeClientRepository
let events: FakeEventRepository
let photos: FakePhotoRepository
let books: FakeAlbumBookRepository
let bookFiles: FakeBookFileStore
let bus: RecordingEventBus
let clock: FakeClock
let logger: CapturingLogger
let enabled: boolean

const request = (input: Partial<RequestAlbumBookInput> = {}) =>
  makeRequestAlbumBook({
    events,
    clients,
    photos,
    books,
    bus,
    clock,
    policy: { enabled, maxPerEventPerDay: 3 },
  })({ ...INPUT, ...input })

const invalidate = () => makeInvalidateAlbumBook({ books, bookFiles, bus, clock, logger })
const download = () => makeDownloadAlbumBook({ events, books, bookFiles, clock })
const get = () => makeGetAlbumBook({ events, books })
const remove = () => makeDeleteAlbumBook({ events, books, bookFiles, bus })

/** A finished book with its file, valid for a week. */
const seedDoneBook = async (options: Partial<BookOptions> = {}, eventId = EVENT) => {
  const queued = requestBook(eventId, { ...OPTIONS, ...options }, AT)
  await books.saveRequest(queued)
  const claimed = await books.claimNext(AT)
  if (claimed === null) throw new Error('no book to claim')
  await books.save({
    ...claimed,
    status: 'done',
    doneAt: AT,
    photoCount: 2,
    skippedCount: 0,
    pageCount: 4,
    byteSize: 4,
    expiresAt: new Date(AT.getTime() + 7 * 24 * 3_600_000),
  })
  bookFiles.seed(eventId, new Uint8Array([1, 2, 3, 4]))
}

const drain = async (stream: AsyncIterable<Uint8Array>): Promise<number> => {
  let size = 0
  for await (const chunk of stream) size += chunk.length
  return size
}

beforeEach(() => {
  clients = new FakeClientRepository()
  events = new FakeEventRepository({ clients })
  photos = new FakePhotoRepository()
  books = new FakeAlbumBookRepository()
  bookFiles = new FakeBookFileStore()
  bus = new RecordingEventBus()
  clock = new FakeClock(atPlus(60_000))
  logger = new CapturingLogger()
  enabled = true
  events.seed(
    anEvent({ id: 'event-1' }),
    anEvent({ id: 'event-2', slug: 'gala', joinCode: 'BBBBBB' }),
  )
  photos.seed(aPhoto({ id: 'p1', eventId: 'event-1', status: 'published' }))
})

describe('requestAlbumBook', () => {
  it('queues the book with the host options, a clean title, the wall language and a snapshot', async () => {
    const result = await request()

    expect(result.ok && result.value).toMatchObject({
      status: 'queued',
      snapshotAt: clock.now(),
      options: {
        title: 'Mariage de Léa',
        subtitle: '',
        language: 'fr',
        layout: 'four',
        showAuthors: false,
        showCaptions: true,
      },
    })
    expect(await books.find(EVENT)).toMatchObject({ status: 'queued' })
  })

  it('wakes the worker once the row exists', async () => {
    await request()

    expect(bus.published).toEqual([{ type: 'book.changed', eventId: EVENT }])
  })

  it('keeps the language the host picked over the wall language', async () => {
    const result = await request({ language: 'de' })

    expect(result.ok && result.value.options.language).toBe('de')
  })

  it('refuses an event that does not exist', async () => {
    const result = await request({ eventId: asEventId('nope') })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('answers event.notFound for an event the operator took down, and writes nothing', async () => {
    await events.setTakenDown(EVENT, AT)

    const result = await request()

    expect(!result.ok && result.error.code).toBe('event.notFound')
    expect(await books.find(EVENT)).toBeNull()
  })

  it('answers client.suspended for a suspended client', async () => {
    events.seed(anEvent({ id: 'event-1', clientSuspendedAt: AT }))

    const result = await request()

    expect(!result.ok && result.error.code).toBe('client.suspended')
  })

  it('answers book.unavailable when the box switched the function off', async () => {
    enabled = false

    const result = await request()

    expect(!result.ok && result.error.code).toBe('book.unavailable')
  })

  it('refuses a client whose plan has no books, and lets one that has them through', async () => {
    clients.seed(aClient({ id: 'client-1', ceilings: { booksAllowed: false } }))
    clients.seed(aClient({ id: 'client-2', ceilings: { booksAllowed: true } }))
    events.seed(
      anEvent({ id: 'event-3', slug: 'sans-livre', joinCode: 'CCCCCC', clientId: 'client-1' }),
      anEvent({ id: 'event-4', slug: 'avec-livre', joinCode: 'DDDDDD', clientId: 'client-2' }),
    )
    photos.seed(
      aPhoto({ id: 'p3', eventId: 'event-3', status: 'published' }),
      aPhoto({ id: 'p4', eventId: 'event-4', status: 'published' }),
    )

    const refused = await request({ eventId: asEventId('event-3') })
    expect(!refused.ok && refused.error.code).toBe('book.notAllowed')
    expect((await request({ eventId: asEventId('event-4') })).ok).toBe(true)
  })

  it('refuses a second request while one is queued or running: book.alreadyRunning', async () => {
    await request()

    const queued = await request()
    expect(!queued.ok && queued.error.code).toBe('book.alreadyRunning')

    await books.claimNext(clock.now())
    const running = await request()
    expect(!running.ok && running.error.code).toBe('book.alreadyRunning')
  })

  it('lets the host ask again once the book is done, failed or stale', async () => {
    await seedDoneBook()

    expect((await request()).ok).toBe(true)
  })

  it('refuses a title that is empty or too long, and a subtitle that is too long', async () => {
    const empty = await request({ title: '   ' })
    const long = await request({ title: 'x'.repeat(81) })
    const subtitle = await request({ subtitle: 'y'.repeat(81) })

    expect(!empty.ok && empty.error.code).toBe('book.titleEmpty')
    expect(!long.ok && long.error.code).toBe('book.titleTooLong')
    expect(!subtitle.ok && subtitle.error.code).toBe('book.subtitleTooLong')
  })

  it('answers book.empty for an album with nothing published', async () => {
    const result = await request({ eventId: OTHER })

    expect(!result.ok && result.error.code).toBe('book.empty')
  })

  it('refuses the fourth book of a rolling day, and says when a slot frees up', async () => {
    for (let index = 0; index < 3; index += 1) {
      expect((await request()).ok).toBe(true)
      await books.claimNext(clock.now())
      const queued = await books.find(EVENT)
      if (queued !== null)
        await books.save({ ...queued, status: 'failed', failureCode: 'unexpected' })
      clock.advance(60_000)
    }

    const fourth = await request()

    expect(!fourth.ok && fourth.error.code).toBe('book.dailyLimitReached')
    expect(!fourth.ok && fourth.error.details['max']).toBe(3)
    expect(!fourth.ok && fourth.error.details['retryAfterSeconds']).toBe(
      Math.ceil((BOOK_WINDOW_MS - 3 * 60_000) / 1000),
    )
  })

  it('does not let deleting the book reset the daily ceiling', async () => {
    for (let index = 0; index < 3; index += 1) {
      expect((await request()).ok).toBe(true)
      await remove()({ eventId: EVENT })
    }

    const fourth = await request()

    expect(!fourth.ok && fourth.error.code).toBe('book.dailyLimitReached')
  })

  it('counts the ceiling per event, not per box', async () => {
    photos.seed(aPhoto({ id: 'p2', eventId: 'event-2', status: 'published' }))
    for (let index = 0; index < 3; index += 1) {
      await request()
      await remove()({ eventId: EVENT })
    }

    expect((await request({ eventId: OTHER })).ok).toBe(true)
  })

  it('frees the ceiling once the oldest request leaves the rolling day', async () => {
    for (let index = 0; index < 3; index += 1) {
      await request()
      await remove()({ eventId: EVENT })
    }
    clock.advance(BOOK_WINDOW_MS + 1)

    expect((await request()).ok).toBe(true)
  })
})

describe('invalidateAlbumBook', () => {
  it('turns a done book stale, deletes its file and tells the host screen', async () => {
    await seedDoneBook()

    await invalidate()(EVENT, 'photoRemoved')

    expect(await books.find(EVENT)).toMatchObject({ status: 'stale', staleReason: 'photoRemoved' })
    expect(await bookFiles.stat(EVENT)).toBeNull()
    expect(bus.published).toContainEqual({ type: 'book.changed', eventId: EVENT })
  })

  it('only records the instant for a book still being rendered: the worker rules at the end', async () => {
    await request()
    await books.claimNext(clock.now())

    await invalidate()(EVENT, 'photoRemoved')

    expect(await books.find(EVENT)).toMatchObject({
      status: 'running',
      invalidatedAt: clock.now(),
    })
  })

  it('does nothing for an event with no book', async () => {
    await invalidate()(EVENT, 'photoRemoved')

    expect(bus.published).toEqual([])
  })

  it('ignores a caption change when the book prints no captions, and acts when it does', async () => {
    await seedDoneBook({ showCaptions: false })
    await invalidate()(EVENT, 'captionChanged')
    expect(await books.find(EVENT)).toMatchObject({ status: 'done' })
    expect(await bookFiles.stat(EVENT)).not.toBeNull()

    await seedDoneBook({ showCaptions: true }, OTHER)
    await invalidate()(OTHER, 'captionChanged')
    expect(await books.find(OTHER)).toMatchObject({
      status: 'stale',
      staleReason: 'captionChanged',
    })
  })

  it('is idempotent: a second call on a stale book changes nothing and announces nothing', async () => {
    await seedDoneBook()
    await invalidate()(EVENT, 'photoRemoved')
    bus.clear()

    await invalidate()(EVENT, 'photoRemoved')

    expect(bus.published).toEqual([])
    expect(await books.find(EVENT)).toMatchObject({ status: 'stale' })
  })

  it('never throws: a failing disk is logged for the sweep, the book is no longer served', async () => {
    await seedDoneBook()
    bookFiles.delete = async () => {
      throw new Error('disk gone')
    }

    await expect(invalidate()(EVENT, 'photoRemoved')).resolves.toBeUndefined()

    expect(
      logger.lines.some((line) => line.message.includes('could not retire a photo book')),
    ).toBe(true)
    expect(await books.find(EVENT)).toMatchObject({ status: 'stale' })
    expect((await download()({ eventId: EVENT })).ok).toBe(false)
  })

  it('touches only the event it is told about', async () => {
    await seedDoneBook()
    await seedDoneBook({}, OTHER)

    await invalidate()(EVENT, 'photoRemoved')

    expect(await books.find(OTHER)).toMatchObject({ status: 'done' })
    expect(await bookFiles.stat(OTHER)).not.toBeNull()
  })
})

describe('getAlbumBook', () => {
  it('returns the row, or null when none was ever asked for', async () => {
    const none = await get()({ eventId: EVENT })
    expect(none.ok && none.value).toBeNull()

    await request()
    const some = await get()({ eventId: EVENT })
    expect(some.ok && some.value?.status).toBe('queued')
  })

  it('is event.notFound for an unknown or taken-down event and client.suspended for a suspended one', async () => {
    const unknown = await get()({ eventId: asEventId('nope') })
    expect(!unknown.ok && unknown.error.code).toBe('event.notFound')

    await events.setTakenDown(EVENT, AT)
    const down = await get()({ eventId: EVENT })
    expect(!down.ok && down.error.code).toBe('event.notFound')

    events.seed(anEvent({ id: 'event-2', slug: 'gala', joinCode: 'BBBBBB', clientSuspendedAt: AT }))
    const suspended = await get()({ eventId: OTHER })
    expect(!suspended.ok && suspended.error.code).toBe('client.suspended')
  })
})

describe('downloadAlbumBook', () => {
  it('serves a done book, whole or by range, with its size', async () => {
    await seedDoneBook()

    const result = await download()({ eventId: EVENT })

    expect(result.ok && result.value.byteSize).toBe(4)
    expect(result.ok && (await drain(await result.value.open()))).toBe(4)
    expect(result.ok && (await drain(await result.value.open({ start: 1, end: 2 })))).toBe(2)
  })

  it('says book.notFound for every reason there is nothing to give', async () => {
    const codeOf = async () => {
      const result = await download()({ eventId: EVENT })
      return result.ok ? 'served' : result.error.code
    }

    expect(await codeOf()).toBe('book.notFound')

    await request()
    expect(await codeOf()).toBe('book.notFound')

    await seedDoneBook()
    expect(await codeOf()).toBe('served')

    await invalidate()(EVENT, 'photoRemoved')
    expect(await codeOf()).toBe('book.notFound')
  })

  it('does not serve a book past its expiry, nor a done row whose file is gone', async () => {
    await seedDoneBook()
    await bookFiles.delete(EVENT)
    expect((await download()({ eventId: EVENT })).ok).toBe(false)

    await seedDoneBook()
    clock.advance(8 * 24 * 3_600_000)
    expect((await download()({ eventId: EVENT })).ok).toBe(false)
  })

  it('does not serve a done row that has no expiry', async () => {
    await seedDoneBook()
    const row = await books.find(EVENT)
    if (row !== null) await books.save({ ...row, expiresAt: null })

    expect((await download()({ eventId: EVENT })).ok).toBe(false)
  })

  it('never serves the book of another event', async () => {
    await seedDoneBook({}, OTHER)

    const result = await download()({ eventId: EVENT })

    expect(!result.ok && result.error.code).toBe('book.notFound')
  })

  it('is event.notFound for an unknown or taken-down event, client.suspended for a suspended one, and keeps the file', async () => {
    await seedDoneBook()
    const unknown = await download()({ eventId: asEventId('nope') })
    expect(!unknown.ok && unknown.error.code).toBe('event.notFound')

    events.seed(anEvent({ id: 'event-1', clientSuspendedAt: AT }))
    const suspended = await download()({ eventId: EVENT })
    expect(!suspended.ok && suspended.error.code).toBe('client.suspended')
    expect(await bookFiles.stat(EVENT)).not.toBeNull()

    events.seed(anEvent({ id: 'event-1' }))
    await events.setTakenDown(EVENT, AT)
    const down = await download()({ eventId: EVENT })
    expect(!down.ok && down.error.code).toBe('event.notFound')
    expect(await bookFiles.stat(EVENT)).not.toBeNull()
  })

  it('fails the stream when the file vanishes between the stat and the read', async () => {
    await seedDoneBook()
    const result = await download()({ eventId: EVENT })
    await bookFiles.delete(EVENT)

    if (!result.ok) throw new Error('expected a file')
    await expect(result.value.open()).rejects.toThrow('disappeared')
  })
})

describe('deleteAlbumBook', () => {
  it('removes the row and the file, announces it, and is idempotent', async () => {
    await seedDoneBook()

    expect((await remove()({ eventId: EVENT })).ok).toBe(true)
    expect((await remove()({ eventId: EVENT })).ok).toBe(true)

    expect(await books.find(EVENT)).toBeNull()
    expect(await bookFiles.stat(EVENT)).toBeNull()
    expect(bus.published).toContainEqual({ type: 'book.changed', eventId: EVENT })
  })

  it('leaves the book of another event alone', async () => {
    await seedDoneBook()
    await seedDoneBook({}, OTHER)

    await remove()({ eventId: EVENT })

    expect(await books.find(OTHER)).toMatchObject({ status: 'done' })
    expect(await bookFiles.stat(OTHER)).not.toBeNull()
  })

  it('refuses an unknown event, an event taken down and a suspended client, and deletes nothing', async () => {
    await seedDoneBook()
    const unknown = await remove()({ eventId: asEventId('nope') })
    expect(!unknown.ok && unknown.error.code).toBe('event.notFound')

    events.seed(anEvent({ id: 'event-1', clientSuspendedAt: AT }))
    const suspended = await remove()({ eventId: EVENT })
    expect(!suspended.ok && suspended.error.code).toBe('client.suspended')

    events.seed(anEvent({ id: 'event-1' }))
    await events.setTakenDown(EVENT, AT)
    const down = await remove()({ eventId: EVENT })
    expect(!down.ok && down.error.code).toBe('event.notFound')

    expect(await books.find(EVENT)).not.toBeNull()
    expect(await bookFiles.stat(EVENT)).not.toBeNull()
  })
})
