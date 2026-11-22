import { beforeEach, describe, expect, it } from 'vitest'
import { composeBook } from '../../../domain/book/bookPlan'
import { asEventId } from '../../../domain/shared/ids'
import {
  AT,
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
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeGuestRepository } from '../../testing/fakeGuestRepository'
import { FakeGuestbookRepository } from '../../testing/fakeGuestbookRepository'
import { FakeMissionRepository } from '../../testing/fakeMissionRepository'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'
import { FakeReactionRepository } from '../../testing/fakeReactionRepository'
import {
  makePreviewAlbumBook,
  type PreviewAlbumBook,
  type PreviewAlbumBookInput,
} from './previewAlbumBook'

const EVENT = asEventId('event-1')
const OTHER = asEventId('event-2')

const INPUT: PreviewAlbumBookInput = {
  eventId: EVENT,
  title: 'Mariage de Léa',
  subtitle: '14 juin 2026',
  language: 'fr',
  style: 'classique',
  selection: { kind: 'all' },
  showAuthors: true,
  showCaptions: true,
  includeGuestbook: false,
  timeZone: 'Europe/Paris',
}

interface World {
  events: FakeEventRepository
  guests: FakeGuestRepository
  photos: FakePhotoRepository
  reactions: FakeReactionRepository
  guestbook: FakeGuestbookRepository
  missions: FakeMissionRepository
  preview: PreviewAlbumBook
}

let world: World

const makeWorld = (maxPhotos = 300): World => {
  const photos = new FakePhotoRepository()
  const state = {
    events: new FakeEventRepository(),
    guests: new FakeGuestRepository(),
    photos,
    reactions: new FakeReactionRepository(),
    guestbook: new FakeGuestbookRepository(),
    missions: new FakeMissionRepository(photos),
  }
  return {
    ...state,
    preview: makePreviewAlbumBook({
      ...state,
      clock: new FakeClock(atPlus(24 * 3_600_000)),
      policy: { maxPhotos, maxMessages: 60 },
    }),
  }
}

const seed = (input: PhotoInput & { id: string }): void => {
  world.photos.seed(aPhoto({ eventId: 'event-1', status: 'published', ...input }))
}

const seedMany = (count: number): void => {
  for (let i = 0; i < count; i += 1) {
    seed({ id: `p-${String(i).padStart(3, '0')}`, createdAt: atPlus(i * 1000) })
  }
}

const preview = async (over: Partial<PreviewAlbumBookInput> = {}) => {
  const result = await world.preview({ ...INPUT, ...over })
  if (!result.ok) throw new Error(`refused: ${result.error.code}`)
  return result.value
}

beforeEach(() => {
  world = makeWorld()
  world.events.seed(anEvent({ id: 'event-1' }))
})

describe('previewAlbumBook', () => {
  describe('what it refuses', () => {
    it('answers event.notFound for an event that does not exist', async () => {
      const result = await world.preview({ ...INPUT, eventId: OTHER })
      expect(result).toMatchObject({ ok: false, error: { code: 'event.notFound' } })
    })

    it('answers like every read of a suspended client', async () => {
      world.events.seed(anEvent({ id: 'event-1', clientSuspendedAt: AT }))
      const result = await world.preview(INPUT)
      expect(result.ok).toBe(false)
    })

    it('refuses an album with nothing published, as the build does', async () => {
      world.photos.seed(aPhoto({ id: 'draft', eventId: 'event-1', status: 'pending' }))
      const result = await world.preview(INPUT)
      expect(result).toMatchObject({ ok: false, error: { code: 'book.empty' } })
    })

    it('refuses every photograph when the album is over the ceiling, but not a selection', async () => {
      world = makeWorld(5)
      world.events.seed(anEvent({ id: 'event-1' }))
      seedMany(8)
      expect(await world.preview(INPUT)).toMatchObject({
        ok: false,
        error: { code: 'book.tooLarge' },
      })
      const best = await preview({ selection: { kind: 'best', target: 60 } })
      expect(best.photoCount).toBe(8)
    })

    it('never reads the photographs of another event', async () => {
      world.events.seed(anEvent({ id: 'event-2', slug: 'autre', joinCode: 'ABCD23' }))
      world.photos.seed(aPhoto({ id: 'theirs', eventId: 'event-2', status: 'published' }))
      seed({ id: 'mine' })
      const book = await preview()
      expect(book.pages.flatMap((p) => p.photos.map((x) => x.id))).toEqual(['mine'])
    })
  })

  describe('the plan is the one the PDF is made from', () => {
    it('lays out the same pages as composeBook on the same photographs', async () => {
      seedMany(30)
      const book = await preview()
      const rows = (
        await world.photos.list(EVENT, { statuses: ['published'], order: 'asc', limit: 200 })
      ).items
      const plan = composeBook(
        {
          photos: rows.map((p) => ({
            id: p.id,
            createdAt: p.createdAt,
            width: p.dimensions.width,
            height: p.dimensions.height,
            guestId: p.author.kind === 'guest' ? p.author.guestId : null,
            reactions: 0,
            highlighted: false,
            missionId: null,
            challengeId: null,
            hasCaption: false,
          })),
          messages: [],
          counts: { photos: 30, photographers: 0, hearts: 0, messages: 0, voices: 0, videos: 0 },
        },
        {
          title: INPUT.title,
          subtitle: '',
          language: 'fr',
          style: 'classique',
          selection: { kind: 'all' },
          showAuthors: true,
          showCaptions: true,
          includeGuestbook: false,
          printVersion: false,
          timeZone: 'Europe/Paris',
        },
      )
      expect(book.pages.map((p) => p.template)).toEqual(plan.pages.map((p) => p.template))
      expect(book.pages.map((p) => p.photos.map((x) => x.id))).toEqual(
        plan.pages.map((p) => p.slots.map((s) => s.photoId)),
      )
      expect(book.photoCount).toBe(plan.selectedCount)
    })

    it('counts the cover and its inside in the pages, like the file', async () => {
      seedMany(3)
      const book = await preview()
      const planned = book.pages.reduce((sum, p) => sum + p.span, 0)
      expect(book.pageCount).toBe(planned + 2)
      expect(book.pageCount % 2).toBe(0)
    })

    it('reads more than one page of the album', async () => {
      world = makeWorld(1000)
      world.events.seed(anEvent({ id: 'event-1' }))
      seedMany(205)
      expect((await preview()).albumPhotos).toBe(205)
    })

    it('keeps a selection to its target and says how many the album holds', async () => {
      seedMany(80)
      const book = await preview({ selection: { kind: 'best', target: 60 } })
      expect(book.photoCount).toBeLessThanOrEqual(60)
      expect(book.albumPhotos).toBe(80)
    })

    it('leaves clips out and says so on the closing page', async () => {
      seed({ id: 'p1' })
      seed({ id: 'clip-1', clip: {} })
      const book = await preview()
      expect(book.albumPhotos).toBe(1)
      expect(book.closingNotes).toEqual(['1 vidéo de cette soirée ne figure pas dans ce livre'])
    })
  })

  describe('the words', () => {
    it('writes the cover with safe text and the date of the first photograph under an empty subtitle', async () => {
      seed({ id: 'p1', createdAt: new Date('2026-06-14T10:00:00Z') })
      const book = await preview({ title: 'Fête 🎉 de Léa', subtitle: '', timeZone: 'UTC' })
      expect(book.cover.title).toBe('Fête de Léa')
      expect(book.cover.subtitle).toBe('14 juin 2026')
      expect(book.cover.photo.id).toBe('p1')
    })

    it('keeps the subtitle the host wrote, and the language of the event when none is given', async () => {
      world.events.seed(anEvent({ id: 'event-1', settings: { wallLanguage: 'en' } }))
      seed({ id: 'p1' })
      const book = await preview({ subtitle: 'Un été', language: undefined, timeZone: undefined })
      expect(book.cover.subtitle).toBe('Un été')
      expect(book.language).toBe('en')
      expect(book.texts.guestbook).not.toBe("Le livre d'or")
    })

    it('uses the words of the language it was asked for', async () => {
      seed({ id: 'p1' })
      const book = await preview({ language: 'fr', subtitle: undefined })
      expect(book.cover.subtitle).not.toBe('')
      expect(book.texts).toMatchObject({ contents: 'Sommaire', favourites: 'Les coups de cœur' })
    })

    it('puts captions and first names under the photographs only when asked', async () => {
      world.guests.seed(aGuest({ id: 'guest-1', eventId: 'event-1', displayName: 'Zoë' }))
      seed({ id: 'p1', author: { kind: 'guest', id: 'guest-1' }, caption: 'Le gâteau' })
      seed({ id: 'p2', author: { kind: 'host', id: 'user-1' }, caption: '🎉' })
      const on = await preview()
      const photos = on.pages.flatMap((p) => p.photos)
      expect(photos.find((p) => p.id === 'p1')).toMatchObject({
        caption: 'Le gâteau',
        author: 'Zoë',
      })
      expect(photos.find((p) => p.id === 'p2')).toMatchObject({ caption: null, author: null })

      const off = await preview({ showAuthors: false, showCaptions: false })
      expect(off.pages.flatMap((p) => p.photos)).toEqual(
        expect.arrayContaining([expect.objectContaining({ caption: null, author: null })]),
      )
      expect(off.pages.flatMap((p) => p.photos).every((p) => p.author === null)).toBe(true)
      expect(off.thanks.names).toEqual([])
    })

    it('thanks the photographers by name, and anonymously when names are off', async () => {
      world.guests.seed(aGuest({ id: 'guest-1', eventId: 'event-1', displayName: 'Zoë' }))
      seed({ id: 'p1', author: { kind: 'guest', id: 'guest-1' } })
      expect((await preview()).thanks).toEqual({
        heading: 'Merci à nos 1 photographes',
        names: [{ name: 'Zoë', photoCount: 1 }],
      })
      expect((await preview({ showAuthors: false })).thanks.heading).toBe(
        'Merci aux 1 photographes de la soirée',
      )
    })

    it('writes the host mission under a photograph that answers one, and none for an emoji-only prompt', async () => {
      world.missions.seed(
        aMission({ id: 'm1', eventId: 'event-1', prompt: 'La photo avec les mariés' }),
        aMission({ id: 'm2', eventId: 'event-1', prompt: '🎉' }),
      )
      seed({ id: 'p1', missionId: 'm1' })
      seed({ id: 'p2', missionId: 'm2' })
      const photos = (await preview()).pages.flatMap((p) => p.photos)
      expect(photos.find((p) => p.id === 'p1')?.mission).toBe('La photo avec les mariés')
      expect(photos.find((p) => p.id === 'p2')?.mission).toBeNull()
    })

    it('carries the hearts of a photograph', async () => {
      seed({ id: 'p1' })
      world.reactions.seed(aReaction({ id: 'r1', photoId: 'p1', guestId: 'g-a' }))
      const book = await preview()
      expect(book.pages.flatMap((p) => p.photos).find((p) => p.id === 'p1')?.hearts).toBe(1)
      expect(book.stats.hearts).toBe(1)
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

    it('adds the message pages when asked, and none otherwise', async () => {
      world.guests.seed(aGuest({ id: 'guest-1', eventId: 'event-1', displayName: 'Zoë' }))
      seedMany(3)
      world.guestbook.seed(written('m1', 5))
      const without = await preview({ includeGuestbook: false })
      const withIt = await preview({ includeGuestbook: true })

      expect(without.pages.some((p) => p.template === 'messages')).toBe(false)
      const message = withIt.pages.find((p) => p.template === 'messages')
      expect(message).toMatchObject({
        firstMessages: true,
        messages: [{ text: 'Mot m1', author: 'Zoë' }],
      })
      expect(withIt.pageCount).toBeGreaterThanOrEqual(without.pageCount)
      expect(withIt.stats.messages).toBe(1)
      expect(withIt.contents.map((c) => c.label)).toContain("Le livre d'or")
    })

    it('marks only the first messages page as the first', async () => {
      seedMany(3)
      for (let i = 0; i < 5; i += 1) world.guestbook.seed(written(`m${i}`, 5 + i, 'x'.repeat(100)))
      const pages = (await preview({ includeGuestbook: true })).pages.filter(
        (p) => p.template === 'messages',
      )
      expect(pages.map((p) => p.firstMessages)).toEqual([true, false])
    })

    it('says a voice message cannot be in the book', async () => {
      seedMany(3)
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
      const book = await preview({ includeGuestbook: true })
      expect(book.closingNotes.join(' ')).toContain('vocal')
    })

    it('says how many messages stayed in the album export when they do not all fit', async () => {
      world = makeWorld()
      world.events.seed(anEvent({ id: 'event-1' }))
      const small = makePreviewAlbumBook({
        events: world.events,
        photos: world.photos,
        reactions: world.reactions,
        guests: world.guests,
        guestbook: world.guestbook,
        missions: world.missions,
        clock: new FakeClock(atPlus(24 * 3_600_000)),
        policy: { maxPhotos: 300, maxMessages: 1 },
      })
      seedMany(3)
      world.guestbook.seed(written('m1', 5), written('m2', 6))
      const result = await small({ ...INPUT, includeGuestbook: true })
      expect(result.ok && result.value.closingNotes.join(' ')).toContain('autre')
    })
  })

  describe('the chapters', () => {
    it('opens a chapter per evening moment and lists them in the contents with their page', async () => {
      for (let i = 0; i < 14; i += 1) seed({ id: `a-${i}`, createdAt: atPlus(i * 60_000) })
      for (let i = 0; i < 14; i += 1) {
        seed({ id: `b-${i}`, createdAt: atPlus(5 * 3_600_000 + i * 60_000) })
      }
      const book = await preview()
      expect(book.chapters.length).toBe(2)
      expect(book.chapters[0]).toMatchObject({ index: 0, numeral: 'I' })
      expect(book.contents[0]!.label.startsWith('I · ')).toBe(true)
      expect(book.pages[1]!.template).toBe('contents')
      expect(book.pages.some((p) => p.chapter === 1)).toBe(true)
    })
  })
})
