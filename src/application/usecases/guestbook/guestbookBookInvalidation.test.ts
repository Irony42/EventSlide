import { beforeEach, describe, expect, it } from 'vitest'
import { requestBook, type BookOptions } from '../../../domain/book/albumBook'
import {
  asEventId,
  asGuestId,
  asGuestbookEntryId,
  asUserId,
  type GuestbookEntryId,
} from '../../../domain/shared/ids'
import { aGuest, aGuestbookEntry, aVoiceEntry, AT } from '../../testing/builders'
import { CapturingLogger } from '../../testing/capturingLogger'
import { ExportScene } from '../../testing/exportScene'
import { FakeAlbumBookRepository } from '../../testing/fakeAlbumBookRepository'
import { FakeAuditLog } from '../../testing/fakeAuditLog'
import { FakeBookFileStore } from '../../testing/fakeBookFileStore'
import { FakeClipJobRepository } from '../../testing/fakeClipJobRepository'
import { FakeMembershipRepository } from '../../testing/fakeMembershipRepository'
import { FakeReactionRepository } from '../../testing/fakeReactionRepository'
import { makeInvalidateAlbumBook, type InvalidateBook } from '../book/invalidateAlbumBook'
import { makeEraseGuestContribution } from '../guests/eraseGuestContribution'
import { makeSetGuestbookTakedown } from '../site/setGuestbookTakedown'
import { makeDeleteGuestbookEntry } from './deleteGuestbookEntry'
import { makeModerateGuestbookEntry } from './moderateGuestbookEntry'

/**
 * The photo book prints guest-book messages (spec 26), so every way a message leaves the evening
 * retires a book that prints them, **before** the message goes, and leaves a book that does not
 * print them (or a message that was never in one) alone. `bookInvalidation.guard.test.ts` makes a
 * new way out fail the build.
 */

const EVENT = asEventId('event-1')
const HOST = asUserId('user-host')
const hostActor = { kind: 'host', userId: HOST } as const
const OPERATOR = { kind: 'operator', userId: asUserId('user-operator') } as const
const REASON = 'Signalement reçu, retrait conservatoire'
const LEA = asGuestId('guest-lea')

const OPTIONS: BookOptions = {
  title: 'Mariage',
  subtitle: '',
  language: 'fr',
  style: 'classique',
  selection: { kind: 'all' },
  showAuthors: true,
  showCaptions: true,
  includeGuestbook: true,
  printVersion: false,
  timeZone: 'Europe/Paris',
}

describe('the photo book and the ways a guest-book message leaves the evening', () => {
  let scene: ExportScene
  let memberships: FakeMembershipRepository
  let books: FakeAlbumBookRepository
  let bookFiles: FakeBookFileStore
  let invalidateBook: InvalidateBook
  /** How many messages were still published at the instant the book was retired. */
  let statusWhenRemoved: string[]

  /** A finished book, with its file, that prints the guest book or not. */
  const seedDoneBook = async (includeGuestbook: boolean): Promise<void> => {
    await books.saveRequest(requestBook(EVENT, { ...OPTIONS, includeGuestbook }, AT))
    const claimed = await books.claimNext(AT)
    if (claimed === null) throw new Error('no book')
    await books.save({
      ...claimed,
      status: 'done',
      doneAt: AT,
      photoCount: 1,
      skippedCount: 0,
      pageCount: 4,
      byteSize: 4,
      expiresAt: new Date(AT.getTime() + 7 * 86_400_000),
    })
    bookFiles.seed(EVENT, new Uint8Array([1, 2, 3, 4]))
  }

  beforeEach(() => {
    scene = new ExportScene()
    memberships = new FakeMembershipRepository()
    memberships.seed({ eventId: EVENT, userId: HOST, role: 'owner', grantedAt: AT })
    books = new FakeAlbumBookRepository()
    bookFiles = new FakeBookFileStore()
    const real = makeInvalidateAlbumBook({
      books,
      bookFiles,
      bus: scene.bus,
      clock: scene.clock,
      logger: new CapturingLogger(),
    })
    invalidateBook = async (eventId, reason) => {
      const published = await scene.guestbook.listWrittenByStatuses(eventId, ['published'], 100)
      statusWhenRemoved.push(`${reason}:${published.length}`)
      await real(eventId, reason)
    }
    statusWhenRemoved = []
    scene.guests.seed(aGuest({ id: 'guest-lea', eventId: 'event-1', displayName: 'Léa' }))
  })

  const expectRetired = async (): Promise<void> => {
    expect(await books.find(EVENT)).toMatchObject({
      status: 'stale',
      staleReason: 'messageRemoved',
    })
    expect(await bookFiles.stat(EVENT)).toBeNull()
  }

  const expectUntouched = async (): Promise<void> => {
    expect(await books.find(EVENT)).toMatchObject({ status: 'done' })
    expect(await bookFiles.stat(EVENT)).not.toBeNull()
  }

  const moderator = () =>
    makeModerateGuestbookEntry({
      events: scene.events,
      guestbook: scene.guestbook,
      memberships,
      bus: scene.bus,
      clock: scene.clock,
      invalidateBook,
    })

  const moderate = (id: string, decision: 'publish' | 'hide' | 'reject') =>
    moderator()({
      eventId: EVENT,
      entryId: asGuestbookEntryId(id),
      decision,
      actor: hostActor,
    })

  describe('the host moderating a message', () => {
    it('retires the book when a published message is hidden or refused, before it moves', async () => {
      scene.guestbook.seed(aGuestbookEntry({ id: 'm1', eventId: 'event-1', moderation: 'auto' }))
      await seedDoneBook(true)

      await moderate('m1', 'hide')

      await expectRetired()
      expect(statusWhenRemoved).toEqual(['messageRemoved:1'])
    })

    it('leaves the book alone when a hidden message is refused: it was already out of the book', async () => {
      scene.guestbook.seed(aGuestbookEntry({ id: 'm1', eventId: 'event-1', moderation: 'auto' }))
      await moderate('m1', 'hide')
      await seedDoneBook(true)

      await moderate('m1', 'reject')

      await expectUntouched()
    })

    it('leaves the book alone when a waiting message is refused or published', async () => {
      scene.guestbook.seed(aGuestbookEntry({ id: 'm1', eventId: 'event-1', moderation: 'manual' }))
      scene.guestbook.seed(aGuestbookEntry({ id: 'm2', eventId: 'event-1', moderation: 'manual' }))
      await seedDoneBook(true)

      await moderate('m1', 'reject')
      await moderate('m2', 'publish')

      await expectUntouched()
    })

    it('leaves a book that prints no guest book alone', async () => {
      scene.guestbook.seed(aGuestbookEntry({ id: 'm1', eventId: 'event-1', moderation: 'auto' }))
      await seedDoneBook(false)

      await moderate('m1', 'reject')

      await expectUntouched()
    })

    it('does not touch the book when the move is refused', async () => {
      scene.guestbook.seed(aGuestbookEntry({ id: 'm1', eventId: 'event-1', moderation: 'manual' }))
      await seedDoneBook(true)

      const result = await moderate('m1', 'hide')

      expect(result.ok).toBe(false)
      await expectUntouched()
    })
  })

  describe('the operator taking a message down', () => {
    const takeDown = (id: string, down: boolean) =>
      makeSetGuestbookTakedown({
        guestbook: scene.guestbook,
        audit: new FakeAuditLog().withAccounts(OPERATOR.userId),
        bus: scene.bus,
        clock: scene.clock,
        invalidateBook,
      })({ entryId: asGuestbookEntryId(id), down, reason: REASON, actor: OPERATOR })

    it('retires the book, before the message is taken down', async () => {
      scene.guestbook.seed(aGuestbookEntry({ id: 'm1', eventId: 'event-1', moderation: 'auto' }))
      await seedDoneBook(true)

      await takeDown('m1', true)

      await expectRetired()
    })

    it('does not bring the book back when the message is restored, and does not retire on a restore', async () => {
      scene.guestbook.seed(aGuestbookEntry({ id: 'm1', eventId: 'event-1', moderation: 'auto' }))
      await takeDown('m1', true)
      await seedDoneBook(true)

      await takeDown('m1', false)

      await expectUntouched()
    })

    it('leaves a book that prints no guest book alone', async () => {
      scene.guestbook.seed(aGuestbookEntry({ id: 'm1', eventId: 'event-1', moderation: 'auto' }))
      await seedDoneBook(false)

      await takeDown('m1', true)

      await expectUntouched()
    })
  })

  describe('a guest taking a message back', () => {
    const deleter = () =>
      makeDeleteGuestbookEntry({
        events: scene.events,
        guestbook: scene.guestbook,
        voices: scene.voices,
        media: scene.media,
        bus: scene.bus,
        clock: scene.clock,
        invalidateBook,
      })

    const takeBack = (id: GuestbookEntryId) =>
      deleter()({ eventId: EVENT, entryId: id, guestId: LEA })

    it('retires the book for a published recording, before it goes', async () => {
      const entry = aVoiceEntry({
        id: 'v1',
        guestId: 'guest-lea',
        eventId: 'event-1',
        state: 'ready',
        moderation: 'auto',
        createdAt: scene.clock.now(),
      })
      scene.guestbook.seed(entry)
      await seedDoneBook(true)

      const result = await takeBack(asGuestbookEntryId('v1'))

      expect(result.ok).toBe(true)
      await expectRetired()
    })

    it('leaves the book alone for a message that was still waiting', async () => {
      scene.guestbook.seed(
        aGuestbookEntry({
          id: 'm1',
          eventId: 'event-1',
          guestId: 'guest-lea',
          moderation: 'manual',
          createdAt: scene.clock.now(),
        }),
      )
      await seedDoneBook(true)

      const result = await takeBack(asGuestbookEntryId('m1'))

      expect(result.ok).toBe(true)
      await expectUntouched()
    })
  })

  describe('a guest erasing everything they sent', () => {
    const eraser = () =>
      makeEraseGuestContribution({
        events: scene.events,
        guests: scene.guests,
        photos: scene.photos,
        reactions: new FakeReactionRepository(),
        clips: new FakeClipJobRepository(),
        guestbook: scene.guestbook,
        voices: scene.voices,
        media: scene.media,
        bus: scene.bus,
        clock: scene.clock,
        invalidateBook,
      })

    it('retires the book for the messages, in a call of their own, before they go', async () => {
      scene.guestbook.seed(
        aGuestbookEntry({ id: 'm1', eventId: 'event-1', guestId: 'guest-lea', moderation: 'auto' }),
      )
      await seedDoneBook(true)

      const result = await eraser()({ eventId: EVENT, guestId: LEA })

      expect(result.ok).toBe(true)
      await expectRetired()
      expect(statusWhenRemoved).toEqual(['messageRemoved:1'])
    })

    it('leaves the book alone for a guest who wrote nothing', async () => {
      scene.guestbook.seed(
        aGuestbookEntry({
          id: 'm1',
          eventId: 'event-1',
          guestId: 'guest-other',
          moderation: 'auto',
        }),
      )
      await seedDoneBook(true)

      await eraser()({ eventId: EVENT, guestId: LEA })

      await expectUntouched()
    })

    it('leaves a book that prints no guest book alone', async () => {
      scene.guestbook.seed(
        aGuestbookEntry({ id: 'm1', eventId: 'event-1', guestId: 'guest-lea', moderation: 'auto' }),
      )
      await seedDoneBook(false)

      await eraser()({ eventId: EVENT, guestId: LEA })

      await expectUntouched()
    })
  })
})
