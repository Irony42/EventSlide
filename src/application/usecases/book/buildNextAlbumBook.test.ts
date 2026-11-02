import { beforeEach, describe, expect, it } from 'vitest'
import { requestBook, type AlbumBook, type BookOptions } from '../../../domain/book/albumBook'
import { DomainError } from '../../../domain/shared/errors'
import { asEventId } from '../../../domain/shared/ids'
import {
  AT,
  aClient,
  aClipJob,
  aGuest,
  anEvent,
  aPhoto,
  atPlus,
  type PhotoInput,
} from '../../testing/builders'
import { CapturingLogger } from '../../testing/capturingLogger'
import { FakeAlbumBookRepository } from '../../testing/fakeAlbumBookRepository'
import { FakeBookFileStore } from '../../testing/fakeBookFileStore'
import { FakeBookRenderer } from '../../testing/fakeBookRenderer'
import { FakeClientRepository } from '../../testing/fakeClientRepository'
import { FakeClipJobRepository } from '../../testing/fakeClipJobRepository'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeGuestRepository } from '../../testing/fakeGuestRepository'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'
import { InMemoryMediaStore } from '../../testing/inMemoryMediaStore'
import { RecordingEventBus } from '../../testing/recordingEventBus'
import {
  makeBuildNextAlbumBook,
  type BuildAlbumBookPolicy,
  type BuildNextAlbumBook,
} from './buildNextAlbumBook'

const EVENT = asEventId('event-1')
const OTHER_EVENT = asEventId('event-2')

const OPTIONS: BookOptions = {
  title: 'Mariage de Léa',
  subtitle: '14 juin 2026',
  language: 'fr',
  layout: 'one',
  showAuthors: true,
  showCaptions: true,
}

const POLICY: BuildAlbumBookPolicy = {
  maxPhotos: 300,
  maxBytes: 1_000_000,
  ttlDays: 7,
  maxTotalBytes: 10_000_000,
  maxWaitMs: 10 * 60_000,
  capNoticeDays: 30,
}

const DISPLAY_BYTES = new TextEncoder().encode('jpeg-bytes')

interface World {
  events: FakeEventRepository
  clients: FakeClientRepository
  guests: FakeGuestRepository
  photos: FakePhotoRepository
  media: InMemoryMediaStore
  books: FakeAlbumBookRepository
  bookFiles: FakeBookFileStore
  renderer: FakeBookRenderer
  clips: FakeClipJobRepository
  bus: RecordingEventBus
  clock: FakeClock
  logger: CapturingLogger
  diskHasRoom: boolean
  build: BuildNextAlbumBook
}

let world: World

const makeWorld = (policy: BuildAlbumBookPolicy = POLICY): World => {
  const clients = new FakeClientRepository()
  const state: World = {
    clients,
    events: new FakeEventRepository({ clients }),
    guests: new FakeGuestRepository(),
    photos: new FakePhotoRepository(),
    media: new InMemoryMediaStore(),
    books: new FakeAlbumBookRepository(),
    bookFiles: new FakeBookFileStore(),
    renderer: new FakeBookRenderer(),
    clips: new FakeClipJobRepository(),
    bus: new RecordingEventBus(),
    clock: new FakeClock(atPlus(60 * 60_000)),
    logger: new CapturingLogger(),
    diskHasRoom: true,
    build: async () => ({ kind: 'idle' }),
  }
  state.build = makeBuildNextAlbumBook({
    events: state.events,
    clients: state.clients,
    guests: state.guests,
    photos: state.photos,
    media: state.media,
    books: state.books,
    bookFiles: state.bookFiles,
    renderer: state.renderer,
    clips: state.clips,
    bus: state.bus,
    clock: state.clock,
    logger: state.logger,
    policy,
    diskHasRoom: async () => state.diskHasRoom,
  })
  return state
}

/** A published photograph with its `display` file on the disk. */
const seedPhoto = async (input: PhotoInput & { id: string }): Promise<void> => {
  const photo = aPhoto({ eventId: 'event-1', status: 'published', ...input })
  world.photos.seed(photo)
  if (photo.kind === 'photo') {
    await world.media.put(photo.eventId, photo.hashFor('display'), 'display', DISPLAY_BYTES)
  }
}

const askForBook = async (
  options: Partial<BookOptions> = {},
  at = world.clock.now(),
): Promise<AlbumBook> => {
  const book = requestBook(EVENT, { ...OPTIONS, ...options }, at)
  await world.books.saveRequest(book)
  return book
}

beforeEach(() => {
  world = makeWorld()
  world.events.seed(anEvent({ id: 'event-1' }))
})

describe('buildNextAlbumBook', () => {
  it('does nothing when no book was asked for', async () => {
    expect(await world.build()).toEqual({ kind: 'idle' })
  })

  describe('a book that goes well', () => {
    it('makes the book, oldest photograph first, and records its measures', async () => {
      await seedPhoto({ id: 'p-late', createdAt: atPlus(2_000) })
      await seedPhoto({ id: 'p-early', createdAt: atPlus(1_000), caption: 'Le gâteau' })
      await askForBook({}, atPlus(10_000))

      const outcome = await world.build()

      expect(outcome).toMatchObject({ kind: 'built', eventId: EVENT, photoCount: 2, pageCount: 4 })
      expect(world.renderer.books[0]?.photos.map((photo) => photo.caption)).toEqual([
        'Le gâteau',
        null,
      ])
      const book = await world.books.find(EVENT)
      expect(book).toMatchObject({ status: 'done', photoCount: 2, pageCount: 4, skippedCount: 0 })
      expect(book?.byteSize).toBe((await world.bookFiles.stat(EVENT))?.size)
      expect(book?.expiresAt).toEqual(new Date(world.clock.now().getTime() + 7 * 86_400_000))
    })

    it('hands the renderer the cover, the closing page and the layout, with safe text', async () => {
      await seedPhoto({ id: 'p1' })
      await askForBook({ title: 'Fête 🎉 de Léa', layout: 'four' }, atPlus(10_000))

      await world.build()

      expect(world.renderer.books[0]?.input).toEqual({
        layout: 'four',
        cover: { title: 'Fête de Léa', subtitle: '14 juin 2026' },
        closing: { createdWith: 'Album créé avec EventSlide', videosNote: null },
      })
    })

    it('says in the language of the book how many videos are left out, and counts none as a photo', async () => {
      await seedPhoto({ id: 'p1' })
      await seedPhoto({ id: 'clip-1', clip: {} })
      await seedPhoto({ id: 'clip-2', clip: {} })
      await askForBook({ language: 'en' })

      const outcome = await world.build()

      expect(outcome).toMatchObject({ photoCount: 1 })
      expect(world.renderer.books[0]?.input.closing.videosNote).toBe(
        '2 videos from this event are not in this book',
      )
    })

    it('names the guest only when the host asked for names, and never invents one', async () => {
      world.guests.seed(aGuest({ id: 'guest-1', eventId: 'event-1', displayName: 'Zoë 🎉' }))
      world.guests.seed(aGuest({ id: 'guest-2', eventId: 'event-1', displayName: null }))
      await seedPhoto({ id: 'p1', createdAt: atPlus(1), author: { kind: 'guest', id: 'guest-1' } })
      await seedPhoto({ id: 'p2', createdAt: atPlus(2), author: { kind: 'guest', id: 'guest-2' } })
      await seedPhoto({ id: 'p3', createdAt: atPlus(3), author: { kind: 'host', id: 'user-1' } })
      await askForBook()

      await world.build()

      expect(world.renderer.books[0]?.photos.map((photo) => photo.author)).toEqual([
        'Zoë',
        null,
        null,
      ])
    })

    it('leaves out the names, and the captions, when the host turned them off', async () => {
      world.guests.seed(aGuest({ id: 'guest-1', eventId: 'event-1', displayName: 'Zoë' }))
      await seedPhoto({
        id: 'p1',
        caption: 'Secret',
        author: { kind: 'guest', id: 'guest-1' },
      })
      await askForBook({ showAuthors: false, showCaptions: false })

      await world.build()

      expect(world.renderer.books[0]?.photos).toEqual([
        { bytes: DISPLAY_BYTES, caption: null, author: null },
      ])
    })

    it('draws a caption that is only emoji as no caption at all', async () => {
      await seedPhoto({ id: 'p1', caption: '🎉🎉' })
      await askForBook()

      await world.build()

      expect(world.renderer.books[0]?.photos[0]?.caption).toBeNull()
    })

    it('puts in only what is published: never pending, rejected or hidden', async () => {
      await seedPhoto({ id: 'ok' })
      await seedPhoto({ id: 'pending', status: 'pending' })
      await seedPhoto({ id: 'rejected', status: 'rejected' })
      await seedPhoto({ id: 'hidden', status: 'hidden' })
      await askForBook()

      expect(await world.build()).toMatchObject({ photoCount: 1 })
    })

    it('freezes the book at the instant it was asked for: a later photograph is not in it', async () => {
      await seedPhoto({ id: 'before', createdAt: atPlus(1_000) })
      await seedPhoto({ id: 'after', createdAt: atPlus(5_000) })
      await askForBook({}, atPlus(2_000))

      expect(await world.build()).toMatchObject({ photoCount: 1 })
    })

    it('never puts another event’s photograph in the book', async () => {
      world.events.seed(anEvent({ id: 'event-2', slug: 'autre', joinCode: 'B4N9PT' }))
      await seedPhoto({ id: 'mine' })
      const theirs = aPhoto({ id: 'theirs', eventId: 'event-2', status: 'published' })
      world.photos.seed(theirs)
      await world.media.put(OTHER_EVENT, theirs.hashFor('display'), 'display', DISPLAY_BYTES)
      await askForBook()

      expect(await world.build()).toMatchObject({ photoCount: 1 })
      expect(world.renderer.books[0]?.photos).toHaveLength(1)
    })

    it('skips a photograph whose file is missing, says so, and counts it', async () => {
      await seedPhoto({ id: 'ok', createdAt: atPlus(1) })
      world.photos.seed(
        aPhoto({ id: 'ghost', eventId: 'event-1', status: 'published', createdAt: atPlus(2) }),
      )
      await askForBook()

      const outcome = await world.build()

      expect(outcome).toMatchObject({ kind: 'built', photoCount: 1 })
      expect((await world.books.find(EVENT))?.skippedCount).toBe(1)
    })

    it('skips a file that vanished between the first pass and the render', async () => {
      await seedPhoto({ id: 'ok', createdAt: atPlus(1) })
      await seedPhoto({ id: 'gone-later', createdAt: atPlus(2) })
      const gone = aPhoto({ id: 'gone-later', eventId: 'event-1' })
      await askForBook()
      const realRead = world.media.read.bind(world.media)
      world.media.read = async (eventId, hash, variant) =>
        hash.value === gone.hashFor('display').value ? null : realRead(eventId, hash, variant)

      const outcome = await world.build()

      expect(outcome).toMatchObject({ kind: 'built', photoCount: 1 })
      expect(world.logger.lines.some((line) => line.level === 'warn')).toBe(true)
      expect((await world.books.find(EVENT))?.skippedCount).toBe(1)
    })

    it('announces the book to the console when it starts and when it ends, and logs no title nor caption', async () => {
      await seedPhoto({ id: 'p1', caption: 'Un secret' })
      await askForBook()

      await world.build()

      expect(world.bus.published.filter((fact) => fact.type === 'book.changed')).toHaveLength(2)
      expect(JSON.stringify(world.logger.lines)).not.toContain('Un secret')
      expect(JSON.stringify(world.logger.lines)).not.toContain('Mariage de Léa')
    })

    it('does not let the book outlive the purge date of the album', async () => {
      world.events.seed(
        anEvent({
          id: 'event-1',
          status: 'closed',
          closedAt: atPlus(0),
          settings: { retentionDays: 1 },
        }),
      )
      await seedPhoto({ id: 'p1' })
      await askForBook()

      await world.build()

      const book = await world.books.find(EVENT)
      expect(book?.expiresAt?.getTime()).toBeLessThan(
        (book?.doneAt?.getTime() ?? 0) + 7 * 86_400_000,
      )
    })
  })

  describe('waiting behind the transcoder (one core)', () => {
    it('waits while a clip is being transcoded and the request is recent', async () => {
      await seedPhoto({ id: 'p1' })
      await askForBook({}, world.clock.now())
      world.clips.seed(aClipJob({ id: 'job-1', eventId: 'event-1', status: 'queued' }))

      expect(await world.build()).toEqual({ kind: 'waiting' })
      expect((await world.books.find(EVENT))?.status).toBe('queued')
    })

    it('starts anyway once the request has waited the whole allowance', async () => {
      await seedPhoto({ id: 'p1' })
      await askForBook({}, world.clock.now())
      world.clips.seed(aClipJob({ id: 'job-1', eventId: 'event-1', status: 'queued' }))
      world.clock.advance(10 * 60_000)

      expect(await world.build()).toMatchObject({ kind: 'built' })
    })

    it('does not wait when no clip is active', async () => {
      await seedPhoto({ id: 'p1' })
      await askForBook({}, world.clock.now())

      expect(await world.build()).toMatchObject({ kind: 'built' })
    })
  })

  describe('an event nobody may be given a book of any more', () => {
    it('fails a book of a suspended client as unavailable, and the queue moves on', async () => {
      world.events.seed(anEvent({ id: 'event-1', clientSuspendedAt: AT }))
      await seedPhoto({ id: 'p1' })
      await askForBook()

      expect(await world.build()).toEqual({ kind: 'failed', eventId: EVENT, code: 'unavailable' })
      expect(await world.books.find(EVENT)).toMatchObject({
        status: 'failed',
        failureCode: 'unavailable',
      })
      expect(await world.books.findNextQueued()).toBeNull()
    })

    it('fails a book of an event the operator took down', async () => {
      await world.events.setTakenDown(EVENT, AT)
      await seedPhoto({ id: 'p1' })
      await askForBook()

      expect(await world.build()).toMatchObject({ kind: 'failed', code: 'unavailable' })
    })

    it('fails a book of a client whose plan no longer has books', async () => {
      world = makeWorld()
      world.clients.seed(aClient({ id: 'client-1', ceilings: { booksAllowed: false } }))
      world.events.seed(anEvent({ id: 'event-1', clientId: 'client-1' }))
      await seedPhoto({ id: 'p1' })
      await askForBook()

      expect(await world.build()).toMatchObject({ kind: 'failed', code: 'unavailable' })
    })

    it('makes the book of a client whose plan has books', async () => {
      world = makeWorld()
      world.clients.seed(aClient({ id: 'client-1' }))
      world.events.seed(anEvent({ id: 'event-1', clientId: 'client-1' }))
      await seedPhoto({ id: 'p1' })
      await askForBook()

      expect(await world.build()).toMatchObject({ kind: 'built' })
    })

    it('fails a book whose event disappeared', async () => {
      await world.events.delete(EVENT)
      await askForBook()

      expect(await world.build()).toMatchObject({ kind: 'failed', code: 'unavailable' })
    })

    it('fails the book when the event is taken down during the render, before the closing page', async () => {
      await seedPhoto({ id: 'p1' })
      await askForBook()
      const realRead = world.media.read.bind(world.media)
      world.media.read = async (eventId, hash, variant) => {
        await world.events.setTakenDown(EVENT, AT)
        return realRead(eventId, hash, variant)
      }

      expect(await world.build()).toMatchObject({ kind: 'failed', code: 'unavailable' })
      expect(world.bookFiles.has(EVENT)).toBe(false)
    })

    it('fails the book when the disk has no room', async () => {
      await seedPhoto({ id: 'p1' })
      await askForBook()
      world.diskHasRoom = false

      expect(await world.build()).toMatchObject({ kind: 'failed', code: 'unavailable' })
      expect(world.renderer.books).toHaveLength(0)
    })
  })

  describe('limits, judged before anything is rendered', () => {
    it('fails an empty book as empty', async () => {
      await askForBook()

      expect(await world.build()).toMatchObject({ kind: 'failed', code: 'empty' })
    })

    it('fails a book with only clips as empty', async () => {
      await seedPhoto({ id: 'clip-1', clip: {} })
      await askForBook()

      expect(await world.build()).toMatchObject({ kind: 'failed', code: 'empty' })
    })

    it('allows exactly the photo ceiling and refuses one more', async () => {
      world = makeWorld({ ...POLICY, maxPhotos: 2 })
      world.events.seed(anEvent({ id: 'event-1' }))
      await seedPhoto({ id: 'p1', createdAt: atPlus(1) })
      await seedPhoto({ id: 'p2', createdAt: atPlus(2) })
      await askForBook()
      expect(await world.build()).toMatchObject({ kind: 'built', photoCount: 2 })

      await seedPhoto({ id: 'p3', createdAt: atPlus(3) })
      await askForBook({}, atPlus(10))

      expect(await world.build()).toMatchObject({ kind: 'failed', code: 'tooLarge' })
    })

    it('fails a book that would weigh too much, before rendering it', async () => {
      world = makeWorld({ ...POLICY, maxBytes: 4 })
      world.events.seed(anEvent({ id: 'event-1' }))
      await seedPhoto({ id: 'p1' })
      await seedPhoto({ id: 'p2', createdAt: atPlus(1) })
      await askForBook()

      expect(await world.build()).toMatchObject({ kind: 'failed', code: 'tooLarge' })
      expect(world.renderer.books).toHaveLength(0)
    })

    it('fails a book the box has no room to keep next to the others', async () => {
      world = makeWorld({ ...POLICY, maxTotalBytes: 100 })
      world.events.seed(
        anEvent({ id: 'event-1' }),
        anEvent({ id: 'event-2', slug: 'event-two-slug', joinCode: 'B4N9PT' }),
      )
      await seedPhoto({ id: 'p1' })
      await askForBook()
      world.renderer.paddingBytes = 90
      expect(await world.build()).toMatchObject({ kind: 'built' })

      world.renderer.paddingBytes = 0
      const second = requestBook(OTHER_EVENT, OPTIONS, atPlus(5))
      await world.books.saveRequest(second)
      const theirs = aPhoto({ id: 'theirs', eventId: 'event-2', status: 'published' })
      world.photos.seed(theirs)
      await world.media.put(OTHER_EVENT, theirs.hashFor('display'), 'display', new Uint8Array(40))

      expect(await world.build()).toMatchObject({ kind: 'failed', code: 'unavailable' })
    })

    it('fails a book that grows past the ceiling while it is written, and leaves no file', async () => {
      world = makeWorld({ ...POLICY, maxBytes: 100 })
      world.events.seed(anEvent({ id: 'event-1' }))
      await seedPhoto({ id: 'p1' })
      await askForBook()
      world.renderer.paddingBytes = 500

      expect(await world.build()).toMatchObject({ kind: 'failed', code: 'tooLarge' })
      expect(world.bookFiles.has(EVENT)).toBe(false)
    })
  })

  describe('a failure of the render', () => {
    it('fails the book as unexpected, writes no file and logs without the cause’s text', async () => {
      await seedPhoto({ id: 'p1' })
      await askForBook()
      world.renderer.failsAfter = 0
      world.renderer.failure = new Error('secret /path/to/file')

      expect(await world.build()).toMatchObject({ kind: 'failed', code: 'unexpected' })
      expect(world.bookFiles.has(EVENT)).toBe(false)
      expect(JSON.stringify(world.logger.lines)).not.toContain('secret')
    })

    it('fails a book as unexpected when the failure is a domain error it does not know', async () => {
      await seedPhoto({ id: 'p1' })
      await askForBook()
      world.renderer.failsAfter = 0
      world.renderer.failure = DomainError.invalid('something.else')

      expect(await world.build()).toMatchObject({ kind: 'failed', code: 'unexpected' })
    })

    it('records no failure on a book the host deleted during a render that then failed', async () => {
      await seedPhoto({ id: 'p1' })
      await askForBook()
      const realRead = world.media.read.bind(world.media)
      world.media.read = async (eventId, hash, variant) => {
        await world.books.delete(EVENT)
        return realRead(eventId, hash, variant)
      }
      world.renderer.failsAfter = 1
      await seedPhoto({ id: 'p2', createdAt: atPlus(1) })

      expect(await world.build()).toMatchObject({ kind: 'failed', code: 'unexpected' })
      expect(await world.books.find(EVENT)).toBeNull()
    })

    it('records no failure on a book the host asked for again during a render that then failed', async () => {
      await seedPhoto({ id: 'p1' })
      await askForBook()
      const realRead = world.media.read.bind(world.media)
      world.media.read = async (eventId, hash, variant) => {
        await world.books.saveRequest(requestBook(EVENT, OPTIONS, atPlus(9_000_000)))
        return realRead(eventId, hash, variant)
      }
      world.renderer.failsAfter = 1
      await seedPhoto({ id: 'p2', createdAt: atPlus(1) })

      await world.build()

      expect((await world.books.find(EVENT))?.status).toBe('queued')
    })

    it('can be asked again after a failure, which is a new request', async () => {
      await seedPhoto({ id: 'p1' })
      await askForBook()
      world.renderer.failsAfter = 0
      await world.build()
      world.renderer.failsAfter = null

      await askForBook({}, atPlus(5_000_000))

      expect(await world.build()).toMatchObject({ kind: 'built' })
    })
  })

  describe('a fact that arrives while the book renders', () => {
    it('ends the book stale, never done, and deletes the file, when a photograph left meanwhile', async () => {
      await seedPhoto({ id: 'p1' })
      await askForBook()
      const realRead = world.media.read.bind(world.media)
      world.media.read = async (eventId, hash, variant) => {
        await world.books.invalidate(EVENT, 'photoRemoved', world.clock.now())
        return realRead(eventId, hash, variant)
      }

      expect(await world.build()).toEqual({ kind: 'stale', eventId: EVENT })
      expect(await world.books.find(EVENT)).toMatchObject({
        status: 'stale',
        staleReason: 'photoRemoved',
      })
      expect(world.bookFiles.has(EVENT)).toBe(false)
    })

    it('deletes the file when the host deleted the book while it rendered', async () => {
      await seedPhoto({ id: 'p1' })
      await askForBook()
      const realRead = world.media.read.bind(world.media)
      world.media.read = async (eventId, hash, variant) => {
        await world.books.delete(EVENT)
        return realRead(eventId, hash, variant)
      }

      expect(await world.build()).toEqual({ kind: 'superseded', eventId: EVENT })
      expect(world.bookFiles.has(EVENT)).toBe(false)
    })

    it('deletes the file when the host asked again while it rendered', async () => {
      await seedPhoto({ id: 'p1' })
      await askForBook()
      const realRead = world.media.read.bind(world.media)
      world.media.read = async (eventId, hash, variant) => {
        await world.books.saveRequest(requestBook(EVENT, OPTIONS, atPlus(9_000_000)))
        return realRead(eventId, hash, variant)
      }

      expect(await world.build()).toEqual({ kind: 'superseded', eventId: EVENT })
      expect(world.bookFiles.has(EVENT)).toBe(false)
    })
  })

  describe('shutdown', () => {
    it('stops at the next photograph, leaves the row running for the boot to re-queue, and keeps no file', async () => {
      await seedPhoto({ id: 'p1' })
      await askForBook()
      const stop = new AbortController()
      const realRead = world.media.read.bind(world.media)
      world.media.read = async (eventId, hash, variant) => {
        stop.abort()
        return realRead(eventId, hash, variant)
      }
      await seedPhoto({ id: 'p2', createdAt: atPlus(1) })

      expect(await world.build(stop.signal)).toEqual({ kind: 'aborted', eventId: EVENT })
      expect((await world.books.find(EVENT))?.status).toBe('running')
      expect(world.bookFiles.has(EVENT)).toBe(false)
    })
  })

  it('walks an album longer than one page of rows, in order', async () => {
    for (let index = 0; index < 205; index += 1) {
      await seedPhoto({ id: `p-${String(index).padStart(3, '0')}`, createdAt: atPlus(index) })
    }
    await askForBook()

    expect(await world.build()).toMatchObject({ kind: 'built', photoCount: 205, pageCount: 207 })
  })

  it('does nothing when another process claimed the book first', async () => {
    await seedPhoto({ id: 'p1' })
    await askForBook()
    world.books.claimNext = async () => null

    expect(await world.build()).toEqual({ kind: 'idle' })
  })

  it('replaces the older file of a rebuilt book', async () => {
    await seedPhoto({ id: 'p1' })
    world.bookFiles.seed(EVENT, new TextEncoder().encode('older'))
    await askForBook()

    await world.build()

    expect((await world.bookFiles.stat(EVENT))?.size).not.toBe(5)
  })

  it('reads only the display rendition of a photograph', async () => {
    await seedPhoto({ id: 'p1' })
    await askForBook()
    const read: string[] = []
    const realRead = world.media.read.bind(world.media)
    world.media.read = async (eventId, hash, variant) => {
      read.push(variant)
      return realRead(eventId, hash, variant)
    }

    await world.build()

    expect(read).toEqual(['display'])
  })
})
