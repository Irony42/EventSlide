import { beforeEach, describe, expect, it } from 'vitest'
import { requestBook, type AlbumBook, type BookOptions } from '../../../domain/book/albumBook'
import { GuestbookEntry } from '../../../domain/guestbook/guestbookEntry'
import { asGuestbookEntryId } from '../../../domain/shared/ids'
import { pageCountOf } from '../../../domain/book/bookTemplates'
import { DomainError } from '../../../domain/shared/errors'
import { asEventId } from '../../../domain/shared/ids'
import {
  AT,
  aClient,
  aClipJob,
  aGuest,
  aGuestbookEntry,
  aMission,
  aReaction,
  aVoiceEntry,
  anEvent,
  aPhoto,
  atPlus,
  type PhotoInput,
} from '../../testing/builders'
import type { JobFinished } from '../notices/notifyJobDone'
import { CapturingLogger } from '../../testing/capturingLogger'
import { FakeAlbumBookRepository } from '../../testing/fakeAlbumBookRepository'
import { FakeBookFileStore } from '../../testing/fakeBookFileStore'
import { FakeBookRenderer } from '../../testing/fakeBookRenderer'
import { FakeClientRepository } from '../../testing/fakeClientRepository'
import { FakeClipJobRepository } from '../../testing/fakeClipJobRepository'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeGuestRepository } from '../../testing/fakeGuestRepository'
import { FakeGuestbookRepository } from '../../testing/fakeGuestbookRepository'
import { FakeMissionRepository } from '../../testing/fakeMissionRepository'
import { FakeReactionRepository } from '../../testing/fakeReactionRepository'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'
import { InMemoryMediaStore } from '../../testing/inMemoryMediaStore'
import { RecordingEventBus } from '../../testing/recordingEventBus'
import {
  makeBuildNextAlbumBook,
  type BuildAlbumBookPolicy,
  type BuildNextAlbumBookDeps,
  type BuildNextAlbumBook,
} from './buildNextAlbumBook'

const EVENT = asEventId('event-1')
const OTHER_EVENT = asEventId('event-2')

const OPTIONS: BookOptions = {
  title: 'Mariage de Léa',
  subtitle: '14 juin 2026',
  language: 'fr',
  style: 'classique',
  selection: { kind: 'all' },
  showAuthors: true,
  showCaptions: true,
  includeGuestbook: false,
  printVersion: false,
  timeZone: 'Europe/Paris',
}

const POLICY: BuildAlbumBookPolicy = {
  maxPhotos: 300,
  maxBytes: 20_000_000,
  maxPrintBytes: 50_000_000,
  maxMessages: 60,
  ttlDays: 7,
  maxTotalBytes: 100_000_000,
  maxWaitMs: 10 * 60_000,
  capNoticeDays: 30,
}

const DISPLAY_BYTES = new TextEncoder().encode('jpeg-bytes')

interface World {
  events: FakeEventRepository
  clients: FakeClientRepository
  guests: FakeGuestRepository
  photos: FakePhotoRepository
  reactions: FakeReactionRepository
  guestbook: FakeGuestbookRepository
  missions: FakeMissionRepository
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
  const photos = new FakePhotoRepository()
  const state: World = {
    clients,
    events: new FakeEventRepository({ clients }),
    guests: new FakeGuestRepository(),
    photos,
    reactions: new FakeReactionRepository(),
    guestbook: new FakeGuestbookRepository(),
    missions: new FakeMissionRepository(photos),
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
  state.build = makeBuildNextAlbumBook(depsOf(state, policy))
  return state
}

const depsOf = (state: World, policy: BuildAlbumBookPolicy): BuildNextAlbumBookDeps => ({
  events: state.events,
  clients: state.clients,
  guests: state.guests,
  photos: state.photos,
  reactions: state.reactions,
  guestbook: state.guestbook,
  missions: state.missions,
  media: state.media,
  books: state.books,
  bookFiles: state.bookFiles,
  renderer: state.renderer,
  clips: state.clips,
  bus: state.bus,
  clock: state.clock,
  logger: state.logger,
  diskHasRoom: async () => state.diskHasRoom,
  policy,
})

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
    /** The words the renderer pulled, page after page. */
    const pulled = (): { captions: (string | null)[]; authors: (string | null)[] } => {
      const texts = world.renderer.books[0]?.texts ?? []
      return {
        captions: texts.flatMap((t) => t.captions),
        authors: texts.flatMap((t) => t.authors),
      }
    }

    it('makes the book from a plan, oldest photograph first, and records its measures', async () => {
      await seedPhoto({ id: 'p-late', createdAt: atPlus(2_000) })
      await seedPhoto({ id: 'p-early', createdAt: atPlus(1_000), caption: 'Le gâteau' })
      await askForBook({}, atPlus(10_000))

      const outcome = await world.build()

      expect(outcome).toMatchObject({ kind: 'built', eventId: EVENT, photoCount: 2 })
      const book = await world.books.find(EVENT)
      expect(book).toMatchObject({
        status: 'done',
        photoCount: 2,
        selectedCount: 2,
        skippedCount: 0,
      })
      expect(book?.plan?.selectedCount).toBe(2)
      // the cover and its inside count: the host reads the page count of the file
      expect(book?.pageCount).toBe(pageCountOf(book?.plan?.pages ?? []) + 2)
      expect((book?.pageCount ?? 1) % 2).toBe(0)
      expect(pulled().captions).toContain('Le gâteau')
      const order = world.renderer.books[0]?.photos.filter((id, i, all) => all.indexOf(id) === i)
      expect(new Set(order)).toEqual(new Set(['p-early', 'p-late']))
      expect(book?.byteSize).toBe((await world.bookFiles.stat(EVENT))?.size)
      expect(book?.printByteSize).toBeNull()
      expect(book?.expiresAt).toEqual(new Date(world.clock.now().getTime() + 7 * 86_400_000))
    })

    it('hands the renderer the style, the cover with safe text, the plan and the closing notes', async () => {
      await seedPhoto({ id: 'p1' })
      await askForBook(
        { title: 'Fête 🎉 de Léa', style: 'souvenir', selection: { kind: 'best', target: 60 } },
        atPlus(10_000),
      )

      await world.build()

      const input = world.renderer.books[0]?.input
      expect(input?.style.id).toBe('souvenir')
      expect(input?.cover).toEqual({
        title: 'Fête de Léa',
        subtitle: '14 juin 2026',
        photoId: 'p1',
      })
      expect(input?.closing).toEqual({
        videosNote: null,
        voicesNote: null,
        extraMessagesNote: null,
      })
      expect(input?.timeZone).toBe('Europe/Paris')
      expect(input?.printPages).toBeNull()
      expect(input?.plan.selectedCount).toBe(1)
    })

    it('writes the date of the first photograph as the subtitle when the host left it empty', async () => {
      await seedPhoto({ id: 'p1', createdAt: new Date('2026-06-14T10:00:00Z') })
      await askForBook({ subtitle: '', timeZone: 'UTC' }, atPlus(10_000))

      await world.build()

      expect(world.renderer.books[0]?.input.cover.subtitle).toBe('14 juin 2026')
    })

    it('reads the colours of the theme of the event', async () => {
      await seedPhoto({ id: 'p1' })
      await askForBook({ style: 'magazine' })

      await world.build()

      const colours = world.renderer.books[0]?.input.colours
      expect(colours?.paper).toBe('#ffffff')
      expect(colours?.accent).toMatch(/^#[0-9a-f]{6}$/)
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

      expect(pulled().authors.filter((a) => a !== null)).toEqual(['Zoë'])
      expect(pulled().authors.filter((a) => a === null)).toHaveLength(2)
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

      expect(pulled().captions.every((c) => c === null)).toBe(true)
      expect(pulled().authors.every((a) => a === null)).toBe(true)
    })

    it('draws a caption that is only emoji as no caption at all', async () => {
      await seedPhoto({ id: 'p1', caption: '🎉🎉' })
      await askForBook()

      await world.build()

      expect(pulled().captions.every((c) => c === null)).toBe(true)
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
      expect(new Set(world.renderer.books[0]?.photos)).toEqual(new Set(['mine']))
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

    it('fails the book as unavailable when a file vanished between the first pass and the render, and keeps no file', async () => {
      await seedPhoto({ id: 'ok', createdAt: atPlus(1) })
      await seedPhoto({ id: 'gone-later', createdAt: atPlus(2) })
      const gone = aPhoto({ id: 'gone-later', eventId: 'event-1' })
      await askForBook()
      const realRead = world.media.read.bind(world.media)
      world.media.read = async (eventId, hash, variant) =>
        hash.value === gone.hashFor('display').value ? null : realRead(eventId, hash, variant)

      const outcome = await world.build()

      expect(outcome).toMatchObject({ kind: 'failed', code: 'unavailable' })
      expect(world.bookFiles.has(EVENT)).toBe(false)
      expect(await world.books.find(EVENT)).toMatchObject({
        status: 'failed',
        failureCode: 'unavailable',
        plan: null,
      })
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
      world = makeWorld({ ...POLICY, maxTotalBytes: 3_000_000 })
      world.events.seed(
        anEvent({ id: 'event-1' }),
        anEvent({ id: 'event-2', slug: 'event-two-slug', joinCode: 'B4N9PT' }),
      )
      await seedPhoto({ id: 'p1' })
      await askForBook()
      world.renderer.paddingBytes = 2_500_000
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

  describe('a failure after the claim, before the render (BUG-26)', () => {
    it('gives the book up as unexpected when the disk probe throws, instead of leaving it running', async () => {
      await seedPhoto({ id: 'p1' })
      await askForBook()
      const probe = new Error('statfs: secret /path')
      const failing = makeBuildNextAlbumBook({
        ...depsOf(world, POLICY),
        diskHasRoom: async () => {
          throw probe
        },
      })

      expect(await failing()).toMatchObject({ kind: 'failed', eventId: EVENT, code: 'unexpected' })
      expect((await world.books.find(EVENT))?.status).toBe('failed')
      expect(JSON.stringify(world.logger.lines)).not.toContain('secret')
    })

    it('gives the book up when a read of the album throws, keeping a domain error’s own code', async () => {
      await seedPhoto({ id: 'p1' })
      await askForBook()
      world.media.stat = async () => {
        throw DomainError.unexpected('book.unavailable')
      }

      expect(await world.build()).toMatchObject({ kind: 'failed', code: 'unavailable' })
      expect((await world.books.find(EVENT))?.status).toBe('failed')
    })

    it('leaves the row running when it was the shutdown that interrupted it', async () => {
      await seedPhoto({ id: 'p1' })
      await askForBook()
      const stop = new AbortController()
      world.media.stat = async () => {
        stop.abort()
        throw new Error('interrupted')
      }

      expect(await world.build(stop.signal)).toEqual({ kind: 'aborted', eventId: EVENT })
      expect((await world.books.find(EVENT))?.status).toBe('running')
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

  it('walks an album longer than one page of rows', async () => {
    world = makeWorld({ ...POLICY, maxBytes: 900_000_000, maxTotalBytes: 2_000_000_000 })
    world.events.seed(anEvent({ id: 'event-1' }))
    for (let index = 0; index < 205; index += 1) {
      await seedPhoto({ id: `p-${String(index).padStart(3, '0')}`, createdAt: atPlus(index) })
    }
    await askForBook()

    const outcome = await world.build()
    expect(outcome).toMatchObject({ kind: 'built', photoCount: 205 })
    expect(outcome.kind === 'built' && outcome.pageCount > 60 && outcome.pageCount % 2 === 0).toBe(
      true,
    )
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

    expect(read.length).toBeGreaterThan(0)
    expect(new Set(read)).toEqual(new Set(['display']))
  })

  describe('the plan (spec 26)', () => {
    const photosOf = async (count: number, over: Partial<PhotoInput> = {}): Promise<void> => {
      for (let index = 0; index < count; index += 1) {
        await seedPhoto({
          id: `p-${String(index).padStart(3, '0')}`,
          createdAt: atPlus(index * 120_000),
          author: { kind: 'guest', id: `guest-${index % 9}` },
          ...over,
        })
      }
    }

    it('makes a book of a selection of an event larger than the photo ceiling, and refuses "all" for it', async () => {
      world = makeWorld({ ...POLICY, maxPhotos: 60, maxBytes: 900_000_000, maxTotalBytes: 2e9 })
      world.events.seed(anEvent({ id: 'event-1' }))
      await photosOf(70)
      await askForBook({ selection: { kind: 'best', target: 60 } }, atPlus(1_000_000_000))

      const built = await world.build()

      expect(built).toMatchObject({ kind: 'built', photoCount: 60 })
      expect(await world.books.find(EVENT)).toMatchObject({ selectedCount: 60 })

      await askForBook({ selection: { kind: 'all' } }, atPlus(2_000_000_000))
      expect(await world.build()).toMatchObject({ kind: 'failed', code: 'tooLarge' })
    })

    it('reads the hearts once, at the first pass, and freezes them in the plan', async () => {
      await photosOf(3)
      world.reactions.seed(
        aReaction({ id: 'r1', photoId: 'p-001', guestId: 'guest-a' }),
        aReaction({ id: 'r2', photoId: 'p-001', guestId: 'guest-b' }),
      )
      let reads = 0
      const real = world.reactions.countsForEvent.bind(world.reactions)
      world.reactions.countsForEvent = async (eventId) => {
        reads += 1
        return real(eventId)
      }
      await askForBook()

      await world.build()

      expect(reads).toBe(1)
      const plan = (await world.books.find(EVENT))?.plan
      expect(plan?.hearts).toEqual({ 'p-001': 2 })
      expect(plan?.counts.hearts).toBe(2)
    })

    it('counts the evening on the event: photographs, photographers, videos', async () => {
      await photosOf(4)
      await seedPhoto({ id: 'clip-1', clip: {} })
      await askForBook()

      await world.build()

      expect((await world.books.find(EVENT))?.plan?.counts).toMatchObject({
        photos: 4,
        photographers: 4,
        videos: 1,
        messages: 0,
        voices: 0,
      })
    })

    describe('the guest book', () => {
      const written = (id: string, minutes: number, text = `Mot ${id}`) =>
        aGuestbookEntry({
          id,
          eventId: 'event-1',
          guestId: 'guest-1',
          text,
          createdAt: atPlus(minutes),
          moderation: 'auto',
        })

      it('puts the published messages of the snapshot in the book, and no other, when the host asks', async () => {
        await photosOf(3)
        world.guestbook.seed(
          written('m-before', 5),
          written('m-after', 5_000_000),
          aGuestbookEntry({ id: 'm-pending', eventId: 'event-1', guestId: 'guest-1' }),
        )
        await askForBook({ includeGuestbook: true }, atPlus(60_000))

        await world.build()

        const plan = (await world.books.find(EVENT))?.plan
        const ids = plan?.pages.flatMap((page) => page.messageIds ?? [])
        expect(ids).toEqual(['m-before'])
        const texts = world.renderer.books[0]?.texts.flatMap((t) => t.messages.map((m) => m.text))
        expect(texts).toEqual(['Mot m-before'])
      })

      it('reads no message when the host did not ask for the guest book', async () => {
        await photosOf(3)
        world.guestbook.seed(written('m1', 5))
        await askForBook({ includeGuestbook: false })

        await world.build()

        expect((await world.books.find(EVENT))?.plan?.counts.messages).toBe(0)
        expect(world.renderer.books[0]?.texts.every((t) => t.messages.length === 0)).toBe(true)
      })

      it('counts a voice message and says it is not in the book, and never prints it', async () => {
        await photosOf(3)
        world.guestbook.seed(
          written('m1', 5),
          aVoiceEntry({
            id: 'v1',
            state: 'ready',
            eventId: 'event-1',
            guestId: 'guest-1',
            moderation: 'auto',
            createdAt: atPlus(6),
          }),
        )
        await askForBook({ includeGuestbook: true })

        await world.build()

        const book = await world.books.find(EVENT)
        expect(book?.plan?.counts).toMatchObject({ messages: 1, voices: 1 })
        expect(book?.plan?.pages.flatMap((p) => p.messageIds ?? [])).toEqual(['m1'])
        expect(world.renderer.books[0]?.input.closing.voicesNote).toContain('vocal')
      })

      it('names the author of a message only when the host asked for names', async () => {
        world.guests.seed(aGuest({ id: 'guest-1', eventId: 'event-1', displayName: 'Zoë' }))
        await photosOf(3)
        world.guestbook.seed(written('m1', 5))
        await askForBook({ includeGuestbook: true, showAuthors: true })
        await world.build()
        const named = world.renderer.books[0]?.texts.flatMap((t) => t.messages.map((m) => m.author))

        world.renderer.books.length = 0
        await askForBook({ includeGuestbook: true, showAuthors: false }, atPlus(10_000_000))
        await world.build()
        const anonymous = world.renderer.books[0]?.texts.flatMap((t) =>
          t.messages.map((m) => m.author),
        )

        expect(named).toEqual(['Zoë'])
        expect(anonymous).toEqual([null])
      })

      it('says how many messages are left in the album export when the book holds the first 60', async () => {
        await photosOf(3)
        for (let index = 0; index < 65; index += 1) {
          world.guestbook.seed(
            aGuestbookEntry({
              id: `m-${String(index).padStart(2, '0')}`,
              eventId: 'event-1',
              guestId: `guest-${index % 9}`,
              text: `Mot ${index}`,
              createdAt: atPlus(index),
              moderation: 'auto',
            }),
          )
        }
        await askForBook({ includeGuestbook: true })

        await world.build()

        expect((await world.books.find(EVENT))?.plan).toMatchObject({
          includedMessages: 60,
          extraMessages: 5,
        })
        expect(world.renderer.books[0]?.input.closing.extraMessagesNote).toContain('5')
      })
    })

    it('keeps only the first maxMessages messages when the box lowers the ceiling', async () => {
      world = makeWorld({ ...POLICY, maxMessages: 3 })
      world.events.seed(anEvent({ id: 'event-1' }))
      await photosOf(3)
      for (let index = 0; index < 5; index += 1) {
        world.guestbook.seed(
          aGuestbookEntry({
            id: `m-${index}`,
            eventId: 'event-1',
            guestId: `guest-${index}`,
            text: `Mot ${index}`,
            createdAt: atPlus(index),
            moderation: 'auto',
          }),
        )
      }
      await askForBook({ includeGuestbook: true })

      await world.build()

      expect((await world.books.find(EVENT))?.plan).toMatchObject({
        includedMessages: 3,
        extraMessages: 2,
      })
    })

    describe('the printer version', () => {
      it('is drawn from the same plan, and its two files are measured together', async () => {
        await photosOf(3)
        world.renderer.printPaddingBytes = 10
        await askForBook({ printVersion: true })

        await world.build()

        const book = await world.books.find(EVENT)
        const interior = await world.bookFiles.stat(EVENT, 'printInterior')
        const cover = await world.bookFiles.stat(EVENT, 'printCover')
        expect(interior).not.toBeNull()
        expect(book?.printByteSize).toBe((interior?.size ?? 0) + (cover?.size ?? 0))
        expect(book?.printSkipped).toBeNull()
        const printed = world.renderer.books[0]?.input.printPages
        expect(printed).not.toBeNull()
        expect(printed?.length).toBeGreaterThanOrEqual(24)
      })

      it('is not asked of the renderer when the host did not ask for it', async () => {
        await photosOf(3)
        await askForBook({ printVersion: false })

        await world.build()

        expect(world.renderer.books[0]?.input.printPages).toBeNull()
        expect(world.bookFiles.has(EVENT, 'printInterior')).toBe(false)
        expect((await world.books.find(EVENT))?.printByteSize).toBeNull()
      })

      it('is skipped, the screen book being made, when the plan has more than 200 pages', async () => {
        world = makeWorld({ ...POLICY, maxBytes: 900_000_000, maxTotalBytes: 2e9 })
        world.events.seed(anEvent({ id: 'event-1' }))
        await photosOf(260, { width: 6000, height: 2000 })
        await askForBook({ printVersion: true }, atPlus(1_000_000_000))

        const outcome = await world.build()

        expect(outcome).toMatchObject({ kind: 'built' })
        expect(await world.books.find(EVENT)).toMatchObject({
          status: 'done',
          printSkipped: 'tooManyPages',
          printByteSize: null,
        })
        expect(world.renderer.books[0]?.input.printPages).toBeNull()
        expect(world.bookFiles.has(EVENT, 'printInterior')).toBe(false)
      })

      it('is skipped when it would weigh more than its ceiling, judged before rendering', async () => {
        world = makeWorld({ ...POLICY, maxPrintBytes: 10 })
        world.events.seed(anEvent({ id: 'event-1' }))
        await photosOf(3)
        await askForBook({ printVersion: true })

        await world.build()

        expect(await world.books.find(EVENT)).toMatchObject({
          status: 'done',
          printSkipped: 'tooLarge',
          printByteSize: null,
        })
        expect(world.renderer.books[0]?.input.printPages).toBeNull()
      })

      it('is abandoned, the screen book carrying on, when the two files outgrow the ceiling while they are written', async () => {
        world = makeWorld({ ...POLICY, maxPrintBytes: 20_000_000 })
        world.events.seed(anEvent({ id: 'event-1' }))
        await photosOf(3)
        world.renderer.printPaddingBytes = 25_000_000
        await askForBook({ printVersion: true })

        await world.build()

        expect(await world.books.find(EVENT)).toMatchObject({
          status: 'done',
          printSkipped: 'tooLarge',
          printByteSize: null,
        })
        expect(world.bookFiles.has(EVENT)).toBe(true)
        expect(world.bookFiles.has(EVENT, 'printInterior')).toBe(false)
      })
    })

    describe('a fact that arrives before the render', () => {
      it('ends the book stale and renders nothing when a fact voided it during the first pass', async () => {
        await photosOf(2)
        await askForBook()
        const real = world.reactions.countsForEvent.bind(world.reactions)
        world.reactions.countsForEvent = async (eventId) => {
          await world.books.invalidate(EVENT, 'messageRemoved', world.clock.now())
          return real(eventId)
        }

        const outcome = await world.build()

        expect(outcome).toEqual({ kind: 'stale', eventId: EVENT })
        expect(world.renderer.books).toHaveLength(0)
        expect(await world.books.find(EVENT)).toMatchObject({
          status: 'stale',
          staleReason: 'messageRemoved',
          plan: null,
        })
      })

      it('renders nothing when the host deleted the book during the first pass', async () => {
        await photosOf(2)
        await askForBook()
        const real = world.reactions.countsForEvent.bind(world.reactions)
        world.reactions.countsForEvent = async (eventId) => {
          await world.books.delete(EVENT)
          return real(eventId)
        }

        expect(await world.build()).toEqual({ kind: 'superseded', eventId: EVENT })
        expect(world.renderer.books).toHaveLength(0)
      })
    })

    it('draws the logo of the event when it has one', async () => {
      const logo = aPhoto({ id: 'logo-source', eventId: 'event-1' }).hashFor('display')
      world.events.seed(anEvent({ id: 'event-1', settings: { logo } }))
      await world.media.put(EVENT, logo, 'logo', new TextEncoder().encode('logo-bytes'))
      await photosOf(3)
      await askForBook()

      await world.build()

      expect(world.renderer.books[0]?.input.logo).toEqual(new TextEncoder().encode('logo-bytes'))
    })

    it('names the host’s mission under a photograph that answers one', async () => {
      const mission = aMission({
        id: 'mission-1',
        eventId: 'event-1',
        prompt: 'La photo avec les mariés',
      })
      world.missions.seed(mission)
      await seedPhoto({ id: 'p-000', missionId: 'mission-1' })
      await askForBook()

      await world.build()

      expect(world.renderer.books[0]?.texts.flatMap((t) => t.missions)).toContain(
        'La photo avec les mariés',
      )
    })

    it('draws no mission line for a prompt that is only emoji', async () => {
      world.missions.seed(aMission({ id: 'mission-2', eventId: 'event-1', prompt: '🎉🎉' }))
      await seedPhoto({ id: 'p-000', missionId: 'mission-2' })
      await askForBook()

      await world.build()

      expect(world.renderer.books[0]?.texts.flatMap((t) => t.missions)).toEqual([null])
    })

    it('leaves the mission line out when the mission was deleted since', async () => {
      await seedPhoto({ id: 'p-000', missionId: 'ghost-mission' })
      await askForBook()

      await world.build()

      expect(world.renderer.books[0]?.texts.flatMap((t) => t.missions)).toEqual([null])
    })

    it('draws nothing for a message that vanished between the plan and the page, the book going stale on its own', async () => {
      await photosOf(3)
      world.guestbook.seed(
        aGuestbookEntry({
          id: 'm1',
          eventId: 'event-1',
          guestId: 'guest-1',
          createdAt: atPlus(5),
          moderation: 'auto',
        }),
      )
      await askForBook({ includeGuestbook: true })
      world.guestbook.findById = async () => null

      await world.build()

      expect(world.renderer.books[0]?.texts.flatMap((t) => t.messages)).toEqual([])
    })

    it('lists on the thanks page the photographers who have a name, with their photographs, when names are on', async () => {
      world.guests.seed(aGuest({ id: 'guest-0', eventId: 'event-1', displayName: 'Léa' }))
      world.guests.seed(aGuest({ id: 'guest-1', eventId: 'event-1', displayName: null }))
      await photosOf(4)
      await askForBook({ showAuthors: true })

      await world.build()

      const thanks = world.renderer.books[0]?.texts.flatMap((t) => t.photographers)
      expect(thanks).toEqual([{ name: 'Léa', photoCount: 1 }])
    })

    it('lists nobody on the thanks page when names are off', async () => {
      world.guests.seed(aGuest({ id: 'guest-0', eventId: 'event-1', displayName: 'Léa' }))
      await photosOf(4)
      await askForBook({ showAuthors: false })

      await world.build()

      expect(world.renderer.books[0]?.texts.flatMap((t) => t.photographers)).toEqual([])
    })
  })

  describe('what is read again at render time', () => {
    const entryWith = (id: string, status: 'published' | 'hidden' | 'rejected' | 'pending') => {
      const base = aGuestbookEntry({
        id,
        eventId: 'event-1',
        guestId: 'guest-1',
        text: 'Un mot',
        createdAt: atPlus(5),
        moderation: 'auto',
      })
      return GuestbookEntry.restore({ ...base.toProps(), status })
    }
    const photosOf = async (count: number): Promise<void> => {
      for (let index = 0; index < count; index += 1) {
        await seedPhoto({
          id: `p-${index}`,
          createdAt: atPlus(index * 120_000),
          author: { kind: 'guest', id: 'guest-1' },
        })
      }
    }
    /** Runs `change` the first time a photograph's bytes are read: after the first pass, before any page. */
    const beforeFirstPage = (change: () => unknown): void => {
      const real = world.media.read.bind(world.media)
      let done = false
      world.media.read = async (eventId, hash, variant) => {
        if (!done) {
          done = true
          await change()
        }
        return real(eventId, hash, variant)
      }
    }
    const captions = (): (string | null)[] =>
      world.renderer.books[0]?.texts.flatMap((t) => t.captions) ?? []

    it('prints the caption a guest wrote since the first pass, not the one the first pass saw', async () => {
      await seedPhoto({ id: 'p-0', caption: 'Avant', author: { kind: 'guest', id: 'guest-1' } })
      await askForBook()
      beforeFirstPage(() =>
        world.photos.seed(
          aPhoto({ id: 'p-0', eventId: 'event-1', status: 'published', caption: 'Après' }),
        ),
      )

      await world.build()

      expect(captions()).toEqual(['Après'])
    })

    it('prints no caption when it was erased since the first pass', async () => {
      await seedPhoto({ id: 'p-0', caption: 'Secret' })
      await askForBook()
      beforeFirstPage(() =>
        world.photos.seed(
          aPhoto({ id: 'p-0', eventId: 'event-1', status: 'published', caption: null }),
        ),
      )

      await world.build()

      expect(captions()).toEqual([null])
    })

    it('prints no caption for a photograph that is gone when its page is drawn', async () => {
      await seedPhoto({ id: 'p-0', caption: 'Parti' })
      await askForBook()
      world.photos.findById = async () => null

      await world.build()

      expect(captions()).toEqual([null])
    })

    it.each(['hidden', 'rejected', 'pending'] as const)(
      'does not print a message that is %s now, although it was published at the first pass',
      async (status) => {
        await photosOf(3)
        world.guestbook.seed(entryWith('m1', 'published'))
        await askForBook({ includeGuestbook: true })
        beforeFirstPage(() => world.guestbook.seed(entryWith('m1', status)))

        await world.build()

        expect(world.renderer.books[0]?.texts.flatMap((t) => t.messages)).toEqual([])
      },
    )

    it('does not print a message the operator took down since the first pass', async () => {
      await photosOf(3)
      world.guestbook.seed(entryWith('m1', 'published'))
      await askForBook({ includeGuestbook: true })
      beforeFirstPage(() => world.guestbook.takeDown(EVENT, asGuestbookEntryId('m1'), atPlus(9)))

      await world.build()

      expect(world.renderer.books[0]?.texts.flatMap((t) => t.messages)).toEqual([])
    })

    it('does not print a message whose words are gone (the id now names a voice message)', async () => {
      await photosOf(3)
      world.guestbook.seed(entryWith('m1', 'published'))
      await askForBook({ includeGuestbook: true })
      beforeFirstPage(() =>
        world.guestbook.seed(
          aVoiceEntry({
            id: 'm1',
            state: 'ready',
            eventId: 'event-1',
            guestId: 'guest-1',
            moderation: 'auto',
          }),
        ),
      )

      await world.build()

      expect(world.renderer.books[0]?.texts.flatMap((t) => t.messages)).toEqual([])
    })

    it('prints the name a guest has now, not the one they had at the first pass', async () => {
      world.guests.seed(aGuest({ id: 'guest-1', eventId: 'event-1', displayName: 'Zoé' }))
      await seedPhoto({ id: 'p-0', author: { kind: 'guest', id: 'guest-1' } })
      await askForBook({ showAuthors: true })
      beforeFirstPage(() =>
        world.guests.seed(aGuest({ id: 'guest-1', eventId: 'event-1', displayName: 'Zoë-Anne' })),
      )

      await world.build()

      expect(world.renderer.books[0]?.texts.flatMap((t) => t.authors)).toEqual(['Zoë-Anne'])
    })

    it('prints a name, or no name, according to the host, whichever way he decided', async () => {
      world.guests.seed(aGuest({ id: 'guest-1', eventId: 'event-1', displayName: 'Zoé' }))
      await seedPhoto({ id: 'p-0', author: { kind: 'guest', id: 'guest-1' } })
      const authors = (): (string | null)[] =>
        world.renderer.books.at(-1)?.texts.flatMap((t) => t.authors) ?? []

      await askForBook({ showAuthors: true })
      await world.build()
      const withNames = authors()
      await askForBook({ showAuthors: false }, atPlus(10_000_000))
      await world.build()
      const withoutNames = authors()
      await askForBook({ showAuthors: true }, atPlus(20_000_000))
      await world.build()

      expect(withNames).toEqual(['Zoé'])
      expect(withoutNames).toEqual([null])
      expect(authors()).toEqual(['Zoé'])
    })
  })

  describe('a book that cannot be finished', () => {
    it('ends stale, not failed, when the photograph vanished because it was removed', async () => {
      await seedPhoto({ id: 'p-0' })
      await askForBook()
      world.media.read = async () => {
        await world.books.invalidate(EVENT, 'photoRemoved', world.clock.now())
        return null
      }

      const outcome = await world.build()

      expect(outcome).toEqual({ kind: 'stale', eventId: EVENT })
      expect(await world.books.find(EVENT)).toMatchObject({
        status: 'stale',
        staleReason: 'photoRemoved',
      })
    })

    it('stops at the next page when the shutdown arrives while words are read, not only at a photograph', async () => {
      await seedPhoto({ id: 'p-0' })
      world.guestbook.seed(
        aGuestbookEntry({
          id: 'm1',
          eventId: 'event-1',
          guestId: 'guest-1',
          createdAt: atPlus(5),
          moderation: 'auto',
        }),
      )
      await askForBook({ includeGuestbook: true })
      const stop = new AbortController()
      const real = world.photos.findById.bind(world.photos)
      world.photos.findById = async (eventId, id) => {
        stop.abort()
        return real(eventId, id)
      }

      expect(await world.build(stop.signal)).toEqual({ kind: 'aborted', eventId: EVENT })
      expect((await world.books.find(EVENT))?.status).toBe('running')
      // no page after the one being read had its words pulled
      expect(world.renderer.books[0]?.texts).toHaveLength(1)
    })

    it('writes no verdict, and leaves no file, when the shutdown arrives after the last byte', async () => {
      await seedPhoto({ id: 'p-0' })
      await askForBook()
      const stop = new AbortController()
      const real = world.bookFiles.writeSet.bind(world.bookFiles)
      world.bookFiles.writeSet = async (eventId, chunks, options) => {
        const result = await real(eventId, chunks, options)
        stop.abort()
        return result
      }

      expect(await world.build(stop.signal)).toEqual({ kind: 'aborted', eventId: EVENT })
      expect(world.bookFiles.has(EVENT)).toBe(false)
      expect((await world.books.find(EVENT))?.status).toBe('running')
    })

    it('stops feeding the printer version the moment the store drops it', async () => {
      world = makeWorld({ ...POLICY, maxPrintBytes: 20_000_000 })
      world.events.seed(anEvent({ id: 'event-1' }))
      for (let index = 0; index < 6; index += 1) {
        await seedPhoto({
          id: 'p-' + index,
          createdAt: atPlus(index * 120_000),
          width: 6000,
          height: 2000,
        })
      }
      world.renderer.printPaddingBytes = 25_000_000
      await askForBook({ printVersion: true }, atPlus(1_000_000_000))

      await world.build()

      const book = world.renderer.books[0]
      expect(book?.printMarkers).toBe(0)
      expect(book?.printMarkersSkipped).toBeGreaterThan(0)
    })

    it('keeps feeding it while it fits', async () => {
      for (let index = 0; index < 3; index += 1) {
        await seedPhoto({ id: 'p-' + index, createdAt: atPlus(index * 120_000) })
      }
      await askForBook({ printVersion: true }, atPlus(1_000_000_000))

      await world.build()

      expect(world.renderer.books[0]?.printMarkers).toBeGreaterThan(0)
      expect(world.renderer.books[0]?.printMarkersSkipped).toBe(0)
    })
  })
})

describe('the end of the job is told to the hook (spec 32, A2)', () => {
  let told: JobFinished[]

  beforeEach(() => {
    told = []
    world.build = makeBuildNextAlbumBook({
      ...depsOf(world, POLICY),
      onFinished: (finished) => told.push(finished),
    })
  })

  it('tells that the book is done, when it was asked for and when it ended, with nobody who asked', async () => {
    await seedPhoto({ id: 'p1' })
    const book = await askForBook()
    world.clock.advance(5 * 60_000)

    await world.build()

    expect(told).toEqual([
      {
        job: 'book',
        eventId: EVENT,
        requestedAt: book.requestedAt,
        requestedBy: null,
        outcome: 'done',
        finishedAt: world.clock.now(),
      },
    ])
  })

  it('tells that the book failed', async () => {
    const book = await askForBook()
    world.clock.advance(5 * 60_000)

    expect(await world.build()).toMatchObject({ kind: 'failed', code: 'empty' })

    expect(told).toEqual([
      {
        job: 'book',
        eventId: EVENT,
        requestedAt: book.requestedAt,
        requestedBy: null,
        outcome: 'failed',
        finishedAt: world.clock.now(),
      },
    ])
  })

  it('tells nothing of a book that was replaced while it ran', async () => {
    await askForBook()
    const replaced = Object.assign(Object.create(world.books) as FakeAlbumBookRepository, {
      finish: async () => 'superseded' as const,
    })
    world.build = makeBuildNextAlbumBook({
      ...depsOf(world, POLICY),
      books: replaced,
      onFinished: (finished) => told.push(finished),
    })

    await world.build()

    expect(told).toEqual([])
  })
})
