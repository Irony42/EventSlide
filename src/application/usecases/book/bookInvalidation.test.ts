import { beforeEach, describe, expect, it } from 'vitest'
import { requestBook, type BookOptions } from '../../../domain/book/albumBook'
import { asEventId, asGuestId, asPhotoId, asUserId } from '../../../domain/shared/ids'
import { AT, aGuest, aPhoto, anEvent, atPlus } from '../../testing/builders'
import { CapturingLogger } from '../../testing/capturingLogger'
import { FakeAlbumBookRepository } from '../../testing/fakeAlbumBookRepository'
import { FakeAuditLog } from '../../testing/fakeAuditLog'
import { FakeBookFileStore } from '../../testing/fakeBookFileStore'
import { FakeClipJobRepository } from '../../testing/fakeClipJobRepository'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeGuestbookRepository } from '../../testing/fakeGuestbookRepository'
import { FakeGuestRepository } from '../../testing/fakeGuestRepository'
import { FakeMembershipRepository } from '../../testing/fakeMembershipRepository'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'
import { FakeReactionRepository } from '../../testing/fakeReactionRepository'
import { InMemoryMediaStore } from '../../testing/inMemoryMediaStore'
import { RecordingEventBus } from '../../testing/recordingEventBus'
import { makeEraseGuestContribution } from '../guests/eraseGuestContribution'
import { makeModeratePhoto } from '../moderation/moderatePhoto'
import { makeModeratePhotosBulk } from '../moderation/moderatePhotosBulk'
import { makeDeletePhoto } from '../photos/deletePhoto'
import { makeSetPhotoCaption } from '../photos/setPhotoCaption'
import { makeSetPhotoTakedown } from '../site/setPhotoTakedown'
import { makeInvalidateAlbumBook } from './invalidateAlbumBook'

/**
 * Every path that takes a photograph out of the evening takes it out of the photo book too
 * (spec 04, privacy): the row goes `stale` and the file is deleted, whichever door it left by.
 * `bookInvalidation.guard.test.ts` (in `src/main`) makes a seventh door fail the build.
 */

const EVENT = asEventId('event-1')
const HOST = asUserId('user-host')
const LEA = asGuestId('guest-lea')
const hostActor = { kind: 'host', userId: HOST } as const

const OPTIONS: BookOptions = {
  title: 'Mariage',
  subtitle: '',
  language: 'fr',
  layout: 'one',
  showAuthors: true,
  showCaptions: true,
}

describe('the photo book and the ways out of the evening', () => {
  let events: FakeEventRepository
  let photos: FakePhotoRepository
  let books: FakeAlbumBookRepository
  let bookFiles: FakeBookFileStore
  let media: InMemoryMediaStore
  let bus: RecordingEventBus
  let clock: FakeClock
  let guests: FakeGuestRepository
  let memberships: FakeMembershipRepository
  let invalidateBook: ReturnType<typeof makeInvalidateAlbumBook>

  const seedBook = async (options: Partial<BookOptions> = {}): Promise<void> => {
    await books.saveRequest(requestBook(EVENT, { ...OPTIONS, ...options }, AT))
    const claimed = await books.claimNext(AT)
    if (claimed === null) throw new Error('fixture')
    await books.save({
      ...claimed,
      status: 'done',
      doneAt: AT,
      photoCount: 3,
      skippedCount: 0,
      pageCount: 5,
      byteSize: 4,
      expiresAt: new Date(AT.getTime() + 7 * 86_400_000),
    })
    bookFiles.seed(EVENT, new Uint8Array([1, 2, 3, 4]))
  }

  beforeEach(async () => {
    events = new FakeEventRepository().seed(anEvent({ id: 'event-1' }))
    photos = new FakePhotoRepository()
    books = new FakeAlbumBookRepository()
    bookFiles = new FakeBookFileStore()
    media = new InMemoryMediaStore()
    bus = new RecordingEventBus()
    clock = new FakeClock(atPlus(60_000))
    guests = new FakeGuestRepository()
    memberships = new FakeMembershipRepository()
    memberships.seed({ eventId: EVENT, userId: HOST, role: 'moderator', grantedAt: AT })
    invalidateBook = makeInvalidateAlbumBook({
      books,
      bookFiles,
      bus,
      clock,
      logger: new CapturingLogger(),
    })
    guests.seed(aGuest({ id: 'guest-lea', eventId: 'event-1', displayName: 'Léa' }))
    guests.seed(aGuest({ id: 'guest-new', eventId: 'event-1', displayName: 'Nina' }))
    const byLea = { kind: 'guest', id: LEA } as const
    photos.seed(
      aPhoto({ id: 'lea-1', eventId: 'event-1', status: 'published', author: byLea }),
      aPhoto({ id: 'lea-2', eventId: 'event-1', status: 'published', author: byLea }),
      aPhoto({ id: 'wait', eventId: 'event-1', status: 'pending' }),
    )
    await seedBook()
  })

  const expectRetired = async (): Promise<void> => {
    expect(await books.find(EVENT)).toMatchObject({ status: 'stale', staleReason: 'photoRemoved' })
    expect(await bookFiles.stat(EVENT)).toBeNull()
  }

  const expectUntouched = async (): Promise<void> => {
    expect(await books.find(EVENT)).toMatchObject({ status: 'done' })
    expect(await bookFiles.stat(EVENT)).not.toBeNull()
  }

  const remover = () =>
    makeDeletePhoto({
      events,
      photos,
      clips: new FakeClipJobRepository(),
      media,
      bus,
      clock,
      invalidateBook,
    })

  it('1. deleting a published photograph, before its bytes go', async () => {
    const result = await remover()({
      eventId: EVENT,
      photoId: asPhotoId('lea-1'),
      actor: hostActor,
    })

    expect(result.ok).toBe(true)
    await expectRetired()
  })

  it('1b. deleting a photograph that was never in the book leaves it alone', async () => {
    await remover()({ eventId: EVENT, photoId: asPhotoId('wait'), actor: hostActor })

    await expectUntouched()
  })

  it('2. hiding one published photograph', async () => {
    const moderate = makeModeratePhoto({ events, photos, memberships, bus, clock, invalidateBook })

    await moderate({
      eventId: EVENT,
      photoId: asPhotoId('lea-1'),
      decision: 'hide',
      actor: hostActor,
    })

    await expectRetired()
  })

  it('2b. refusing a pending photograph, or publishing one, leaves the book alone', async () => {
    const moderate = makeModeratePhoto({ events, photos, memberships, bus, clock, invalidateBook })

    await moderate({
      eventId: EVENT,
      photoId: asPhotoId('wait'),
      decision: 'reject',
      actor: hostActor,
    })
    await expectUntouched()

    photos.seed(aPhoto({ id: 'wait-2', eventId: 'event-1', status: 'pending' }))
    await moderate({
      eventId: EVENT,
      photoId: asPhotoId('wait-2'),
      decision: 'publish',
      actor: hostActor,
    })
    await expectUntouched()
  })

  it('3. hiding a batch that holds a published photograph', async () => {
    const bulk = makeModeratePhotosBulk({ events, photos, memberships, bus, clock, invalidateBook })

    await bulk({
      eventId: EVENT,
      photoIds: ['lea-2', 'wait'].map(asPhotoId),
      decision: 'reject',
      actor: hostActor,
    })

    await expectRetired()
  })

  it('3b. a batch of pending photographs leaves the book alone', async () => {
    photos.seed(aPhoto({ id: 'wait-2', eventId: 'event-1', status: 'pending' }))
    const bulk = makeModeratePhotosBulk({ events, photos, memberships, bus, clock, invalidateBook })

    await bulk({
      eventId: EVENT,
      photoIds: ['wait', 'wait-2'].map(asPhotoId),
      decision: 'reject',
      actor: hostActor,
    })

    await expectUntouched()
  })

  it('3c. publishing a batch leaves the book alone', async () => {
    photos.seed(aPhoto({ id: 'wait-2', eventId: 'event-1', status: 'pending' }))
    const bulk = makeModeratePhotosBulk({ events, photos, memberships, bus, clock, invalidateBook })

    await bulk({
      eventId: EVENT,
      photoIds: [asPhotoId('wait-2')],
      decision: 'publish',
      actor: hostActor,
    })

    await expectUntouched()
  })

  const eraser = () =>
    makeEraseGuestContribution({
      events,
      guests,
      photos,
      reactions: new FakeReactionRepository(),
      clips: new FakeClipJobRepository(),
      guestbook: new FakeGuestbookRepository(),
      media,
      bus,
      clock,
      invalidateBook,
    })

  it('4. a guest erasing their contribution reaches the book file', async () => {
    const result = await eraser()({ eventId: EVENT, guestId: LEA })

    expect(result.ok).toBe(true)
    await expectRetired()
  })

  it('4b. a guest with nothing published leaves the book alone', async () => {
    await eraser()({ eventId: EVENT, guestId: asGuestId('guest-new') })

    await expectUntouched()
  })

  const takedown = () => {
    const audit = new FakeAuditLog().withAccounts(asUserId('user-operator'))
    const takeDown = makeSetPhotoTakedown({ photos, audit, bus, clock, invalidateBook })
    const act = (down: boolean) =>
      takeDown({
        photoId: asPhotoId('lea-2'),
        down,
        reason: 'Signalement reçu, retrait conservatoire',
        actor: { kind: 'operator', userId: asUserId('user-operator') },
      })
    return { act, audit }
  }

  it('5. the operator taking a photograph down: no audit line about the book', async () => {
    const { act, audit } = takedown()

    const result = await act(true)

    expect(result.ok).toBe(true)
    await expectRetired()
    expect(audit.all().map((row) => row.action)).toEqual(['photo.takenDown'])
  })

  it('5b. restoring the photograph does not bring the book back', async () => {
    const { act } = takedown()

    await act(true)
    await act(false)

    await expectRetired()
  })

  describe('6. a caption changed', () => {
    const edit = (photoId = 'lea-1') =>
      makeSetPhotoCaption({ events, photos, bus, clock, invalidateBook })({
        eventId: EVENT,
        photoId: asPhotoId(photoId),
        actor: { ...hostActor, role: 'moderator' },
        caption: 'Autre légende',
      })

    it('retires a book that prints captions', async () => {
      expect((await edit()).ok).toBe(true)

      expect(await books.find(EVENT)).toMatchObject({
        status: 'stale',
        staleReason: 'captionChanged',
      })
      expect(await bookFiles.stat(EVENT)).toBeNull()
    })

    it('leaves a book without captions alone', async () => {
      await seedBook({ showCaptions: false })

      await edit()

      await expectUntouched()
    })

    it('leaves a book alone when the caption is on a photograph that is not in it', async () => {
      expect((await edit('wait')).ok).toBe(true)

      await expectUntouched()
    })
  })
})
