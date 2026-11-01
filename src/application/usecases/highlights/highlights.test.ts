import { beforeEach, describe, expect, it } from 'vitest'
import type { DomainError } from '../../../domain/shared/errors'
import { asEventId, asPhotoId } from '../../../domain/shared/ids'
import type { Result } from '../../../domain/shared/result'
import { AT, aPhoto, aReaction, anEvent, atPlus } from '../../testing/builders'
import { CapturingLogger } from '../../testing/capturingLogger'
import { FakeArchiveWriter } from '../../testing/fakeArchiveWriter'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'
import { FakeReactionRepository } from '../../testing/fakeReactionRepository'
import { InMemoryMediaStore } from '../../testing/inMemoryMediaStore'
import { MEDIA_VARIANTS } from '../../ports/mediaStore'
import { makeExportHighlights } from './exportHighlights'
import { makeGetHighlights } from './getHighlights'
import { makePreselectHighlights } from './preselectHighlights'
import { makeSetPhotoHighlight } from './setPhotoHighlight'

const EVENT = asEventId('event-1')
const OTHER = asEventId('event-2')

const code = (result: Result<unknown, DomainError>): string | null =>
  result.ok ? null : result.error.code

describe('the host favourites use cases', () => {
  let events: FakeEventRepository
  let photos: FakePhotoRepository
  let reactions: FakeReactionRepository
  let media: InMemoryMediaStore
  let archive: FakeArchiveWriter
  let logger: CapturingLogger
  const clock = new FakeClock(AT)

  const star = (photoId: string, highlighted = true, eventId = EVENT) =>
    makeSetPhotoHighlight({ events, photos, clock })({
      eventId,
      photoId: asPhotoId(photoId),
      highlighted,
    })

  const suspendedEvents = (): FakeEventRepository =>
    new FakeEventRepository().seed(anEvent({ id: 'event-1', clientSuspendedAt: AT }))

  beforeEach(() => {
    events = new FakeEventRepository().seed(
      anEvent({ id: 'event-1', slug: 'camille-et-sacha' }),
      anEvent({ id: 'event-2', slug: 'gala', joinCode: '2AB3CD' }),
    )
    photos = new FakePhotoRepository()
    reactions = new FakeReactionRepository()
    media = new InMemoryMediaStore()
    archive = new FakeArchiveWriter()
    logger = new CapturingLogger()
  })

  const seed = (
    id: string,
    status: 'published' | 'hidden' | 'pending',
    at = 0,
    eventId = 'event-1',
  ): void => {
    photos.seed(aPhoto({ id, status, eventId, createdAt: atPlus(at) }))
  }

  const hide = (id: string) =>
    photos.updateStatuses(EVENT, [asPhotoId(id)], 'hidden', { kind: 'automatic', at: AT })

  describe('setPhotoHighlight', () => {
    it('stars a published photograph, and unstars it, idempotently', async () => {
      seed('p1', 'published')

      expect((await star('p1')).ok).toBe(true)
      expect((await star('p1')).ok).toBe(true)
      expect((await photos.findById(EVENT, asPhotoId('p1')))?.highlightedAt).toEqual(AT)

      expect((await star('p1', false)).ok).toBe(true)
      expect((await photos.findById(EVENT, asPhotoId('p1')))?.isHighlighted).toBe(false)
    })

    it.each(['hidden', 'pending'] as const)('refuses to star a %s photograph', async (status) => {
      seed('p1', status)

      expect(code(await star('p1'))).toBe('highlight.notPublished')
      expect(await photos.countHighlighted(EVENT)).toBe(0)
    })

    it('does not find a photograph of another event, and stars nothing there', async () => {
      seed('p1', 'published', 0, 'event-2')

      expect(code(await star('p1'))).toBe('photo.notFound')
      expect(await photos.countHighlighted(OTHER)).toBe(0)
    })

    it('answers an unknown event, a taken-down event and a suspended client', async () => {
      seed('p1', 'published')
      expect(code(await star('p1', true, asEventId('ghost')))).toBe('event.notFound')

      await events.setTakenDown(EVENT, AT)
      expect(code(await star('p1'))).toBe('event.notFound')
      await events.setTakenDown(EVENT, null)

      const result = await makeSetPhotoHighlight({ events: suspendedEvents(), photos, clock })({
        eventId: EVENT,
        photoId: asPhotoId('p1'),
        highlighted: true,
      })
      expect(code(result)).toBe('client.suspended')
    })

    it('refuses on an archived event, which nobody moderates', async () => {
      seed('p1', 'published')
      events.seed(anEvent({ id: 'event-1', status: 'archived' }))

      expect(code(await star('p1'))).toBe('event.notModeratable')
    })

    it('answers highlight.notPublished when the write refuses a photograph hidden since the read', async () => {
      seed('p1', 'published')
      const racing = Object.create(photos, {
        setHighlighted: { value: async () => false },
      }) as FakePhotoRepository

      const result = await makeSetPhotoHighlight({ events, photos: racing, clock })({
        eventId: EVENT,
        photoId: asPhotoId('p1'),
        highlighted: true,
      })

      expect(code(result)).toBe('highlight.notPublished')
    })
  })

  describe('preselectHighlights', () => {
    const preselect = (limit: number, eventId = EVENT, source = events) =>
      makePreselectHighlights({ events: source, photos, reactions, clock })({ eventId, limit })

    const react = (photoId: string, guests: number): void => {
      for (let guest = 0; guest < guests; guest += 1) {
        reactions.seed(aReaction({ id: `${photoId}-${guest}`, photoId, guestId: `g${guest}` }))
      }
    }

    it('stars the most reacted-to published photographs up to the limit, and removes nothing', async () => {
      seed('p1', 'published')
      seed('p2', 'published', 1)
      seed('p3', 'published', 2)
      seed('old', 'published', 3)
      await star('old')
      react('p1', 1)
      react('p2', 3)
      react('p3', 2)

      const result = await preselect(2)

      expect(result.ok && result.value.added).toBe(2)
      expect((await photos.findById(EVENT, asPhotoId('p2')))?.isHighlighted).toBe(true)
      expect((await photos.findById(EVENT, asPhotoId('p3')))?.isHighlighted).toBe(true)
      expect((await photos.findById(EVENT, asPhotoId('p1')))?.isHighlighted).toBe(false)
      expect((await photos.findById(EVENT, asPhotoId('old')))?.isHighlighted).toBe(true)
    })

    it('counts an already starred photograph against the limit without starring it twice', async () => {
      seed('p1', 'published')
      seed('p2', 'published', 1)
      await star('p2')
      react('p1', 1)
      react('p2', 2)

      const result = await preselect(1)

      expect(result.ok && result.value.added).toBe(0)
      expect((await photos.findById(EVENT, asPhotoId('p1')))?.isHighlighted).toBe(false)
    })

    it('skips a hidden photograph and a vanished one, which hold no slot', async () => {
      seed('hid', 'hidden')
      seed('p1', 'published', 1)
      react('hid', 5)
      react('ghost', 4)
      react('p1', 1)

      const result = await preselect(1)

      expect(result.ok && result.value.added).toBe(1)
      expect((await photos.findById(EVENT, asPhotoId('p1')))?.isHighlighted).toBe(true)
    })

    it('does not count a star the write refused because the photograph was hidden since the read', async () => {
      seed('p1', 'published')
      react('p1', 1)
      const racing = Object.create(photos, {
        setHighlighted: { value: async () => false },
      }) as FakePhotoRepository

      const result = await makePreselectHighlights({ events, photos: racing, reactions, clock })({
        eventId: EVENT,
        limit: 5,
      })

      expect(result.ok && result.value.added).toBe(0)
    })

    it('stars nothing in another event', async () => {
      seed('p1', 'published', 0, 'event-2')
      react('p1', 1)

      const result = await preselect(5)

      expect(result.ok && result.value.added).toBe(0)
      expect(await photos.countHighlighted(OTHER)).toBe(0)
    })

    it('answers an unknown event, refuses a suspended client and an archived event', async () => {
      expect(code(await preselect(1, asEventId('ghost')))).toBe('event.notFound')
      expect(code(await preselect(1, EVENT, suspendedEvents()))).toBe('client.suspended')

      events.seed(anEvent({ id: 'event-1', status: 'archived' }))
      expect(code(await preselect(1))).toBe('event.notModeratable')
    })
  })

  describe('getHighlights', () => {
    const get = (eventId = EVENT, source = events) =>
      makeGetHighlights({ events: source, photos })({ eventId })

    it('counts only the favourites that can still be exported', async () => {
      seed('p1', 'published')
      seed('p2', 'published', 1)
      seed('p3', 'published', 2)
      await star('p1')
      await star('p2')
      await hide('p2')

      const result = await get()

      expect(result.ok && result.value.count).toBe(1)
    })

    it('reads an archived event, and refuses unknown, taken-down and suspended ones', async () => {
      expect(code(await get(asEventId('ghost')))).toBe('event.notFound')

      await events.setTakenDown(EVENT, AT)
      expect(code(await get())).toBe('event.notFound')
      await events.setTakenDown(EVENT, null)

      expect(code(await get(EVENT, suspendedEvents()))).toBe('client.suspended')

      events.seed(anEvent({ id: 'event-1', status: 'archived' }))
      expect((await get()).ok).toBe(true)
    })
  })

  describe('exportHighlights', () => {
    const exportIt = (eventId = EVENT, source = events) =>
      makeExportHighlights({ events: source, photos, media, archive, logger })({ eventId })

    const put = async (id: string): Promise<void> => {
      const photo = await photos.findById(EVENT, asPhotoId(id))
      if (photo === null) throw new Error('fixture')
      for (const variant of MEDIA_VARIANTS) {
        await media.put(EVENT, photo.contentHash, variant, new Uint8Array(3))
      }
    }

    const drain = async (result: Awaited<ReturnType<typeof exportIt>>): Promise<void> => {
      if (!result.ok) throw new Error(result.error.code)
      for await (const chunk of result.value) void chunk
    }

    it('archives only the favourites, oldest first, under <slug>-best-of', async () => {
      seed('late', 'published', 2_000)
      seed('early', 'published', 0)
      seed('plain', 'published', 1_000)
      await star('late')
      await star('early')
      await put('late')
      await put('early')

      await drain(await exportIt())

      expect(archive.entries).toHaveLength(2)
      expect(
        archive.entries.every((entry) => entry.name.startsWith('camille-et-sacha-best-of/')),
      ).toBe(true)
      expect(archive.entries.map((entry) => entry.modifiedAt)).toEqual([atPlus(0), atPlus(2_000)])
    })

    it('leaves a favourite that was since hidden out of the archive', async () => {
      seed('a', 'published')
      seed('b', 'published', 1)
      await star('a')
      await star('b')
      await put('a')
      await put('b')
      await hide('b')

      await drain(await exportIt())

      expect(archive.entries).toHaveLength(1)
    })

    it('says highlight.empty before anything is written when nothing is starred', async () => {
      seed('a', 'published')

      expect(code(await exportIt())).toBe('highlight.empty')
    })

    it('does not archive a favourite of another event', async () => {
      seed('a', 'published', 0, 'event-2')

      expect(code(await exportIt())).toBe('highlight.empty')
    })

    it('skips a favourite whose file is gone, and says so', async () => {
      seed('a', 'published')
      await star('a')

      await drain(await exportIt())

      expect(archive.entries).toEqual([])
      expect(logger.lines.some((entry) => entry.level === 'warn')).toBe(true)
    })

    it('refuses unknown, taken-down and suspended events, and serves an archived one', async () => {
      seed('a', 'published')
      await star('a')
      await put('a')
      expect(code(await exportIt(asEventId('ghost')))).toBe('event.notFound')

      await events.setTakenDown(EVENT, AT)
      expect(code(await exportIt())).toBe('event.notFound')
      await events.setTakenDown(EVENT, null)

      expect(code(await exportIt(EVENT, suspendedEvents()))).toBe('client.suspended')

      events.seed(anEvent({ id: 'event-1', status: 'archived' }))
      expect((await exportIt()).ok).toBe(true)
    })
  })
})
