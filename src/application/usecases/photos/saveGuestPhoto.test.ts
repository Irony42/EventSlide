import { beforeEach, describe, expect, it } from 'vitest'
import { MEDIA_VARIANTS } from '../../../domain/photos/mediaVariant'
import { PHOTO_STATUSES, isVisibleOnWall } from '../../../domain/photos/photoStatus'
import { asEventId, asPhotoId } from '../../../domain/shared/ids'
import { AT, aClip, aPhoto, anEvent, type PhotoInput } from '../../testing/builders'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'
import { CapturingLogger } from '../../testing/capturingLogger'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventStatsRepository } from '../../testing/fakeEventStatsRepository'
import { FakeGuestRepository } from '../../testing/fakeGuestRepository'
import { FakeReactionRepository } from '../../testing/fakeReactionRepository'
import { InMemoryMediaStore } from '../../testing/inMemoryMediaStore'
import { makeRecordEngagement } from '../stats/recordEngagement'
import { makeSaveGuestPhoto, type SaveGuestPhoto } from './saveGuestPhoto'

const EVENT = asEventId('event-1')
const PHOTO = asPhotoId('photo-1')
const SLUG = 'camille-et-sacha'

/** The three renditions get different sizes, so a test can tell which one it was handed. */
const SIZES = { original: 9, display: 5, thumb: 2 } as const

describe('saveGuestPhoto', () => {
  let events: FakeEventRepository
  let photos: FakePhotoRepository
  let media: InMemoryMediaStore
  let stats: FakeEventStatsRepository
  let save: SaveGuestPhoto
  let clock: FakeClock

  beforeEach(() => {
    events = new FakeEventRepository().seed(
      anEvent({ id: 'event-1', slug: SLUG, settings: { allowGuestSave: true } }),
    )
    photos = new FakePhotoRepository()
    media = new InMemoryMediaStore().forbidEnumeration('a guest save')
    stats = new FakeEventStatsRepository(
      photos,
      new FakeGuestRepository(photos),
      new FakeReactionRepository(),
    )
    clock = new FakeClock(AT)
    save = makeSaveGuestPhoto({
      events,
      photos,
      media,
      clock,
      engagement: makeRecordEngagement({
        stats,
        clock: new FakeClock(AT),
        logger: new CapturingLogger(),
      }),
    })
  })

  const seed = async (input: PhotoInput = {}) => {
    const photo = aPhoto({ id: 'photo-1', eventId: 'event-1', status: 'published', ...input })
    photos.seed(photo)
    for (const variant of MEDIA_VARIANTS) {
      await media.put(
        photo.eventId,
        photo.contentHash,
        variant,
        new Uint8Array(SIZES[variant as keyof typeof SIZES]),
      )
    }
    return photo
  }

  const refusal = async (eventId = EVENT, photoId = PHOTO): Promise<string | null> => {
    const result = await save({ eventId, photoId })
    return result.ok ? null : result.error.code
  }

  it('hands out the display rendition of a published photograph, never the original', async () => {
    await seed()

    const result = await save({ eventId: EVENT, photoId: PHOTO })

    if (!result.ok) throw new Error(`expected a save, got ${result.error.code}`)
    expect(result.value.variant).toBe('display')
    expect(result.value.byteSize).toBe(SIZES.display)
  })

  it('names the file after the event and a short digest, and nothing a guest typed', async () => {
    const photo = await seed({ caption: 'Julie danse', author: { kind: 'guest', id: 'guest-1' } })

    const result = await save({ eventId: EVENT, photoId: PHOTO })

    if (!result.ok) throw new Error(`expected a save, got ${result.error.code}`)
    expect(result.value.fileName).toBe(`${SLUG}-${photo.contentHash.short}.jpg`)
    expect(result.value.fileName).not.toMatch(/Julie|danse/i)
  })

  it('refuses with save.disabled when the host switched the setting off, and says nothing else', async () => {
    events.seed(anEvent({ id: 'event-1', slug: SLUG, settings: { allowGuestSave: false } }))
    await seed()

    const result = await save({ eventId: EVENT, photoId: PHOTO })

    expect(result.ok).toBe(false)
    expect(!result.ok && result.error.kind).toBe('forbidden')
    expect(!result.ok && result.error.code).toBe('save.disabled')
  })

  it('reads the switch on every request, so turning it off takes effect on the next one', async () => {
    await seed()
    expect(await refusal()).toBeNull()

    events.seed(anEvent({ id: 'event-1', slug: SLUG, settings: { allowGuestSave: false } }))

    expect(await refusal()).toBe('save.disabled')
  })

  it.each(['draft', 'archived'] as const)(
    'answers event.notFound for an event that is %s, switch on',
    async (status) => {
      events.seed(
        anEvent({ id: 'event-1', slug: SLUG, status, settings: { allowGuestSave: true } }),
      )
      await seed()

      expect(await refusal()).toBe('event.notFound')
    },
  )

  it('still serves a closed event: the evening is over, the album is still shown', async () => {
    events.seed(
      anEvent({ id: 'event-1', slug: SLUG, status: 'closed', settings: { allowGuestSave: true } }),
    )
    await seed()

    expect(await refusal()).toBeNull()
  })

  it('answers event.notFound for an event the operator took down', async () => {
    await seed()
    await events.setTakenDown(EVENT, AT)

    expect(await refusal()).toBe('event.notFound')
  })

  it('answers event.notFound for an event whose client is suspended', async () => {
    events.seed(
      anEvent({
        id: 'event-1',
        slug: SLUG,
        clientId: 'client-1',
        clientSuspendedAt: AT,
        settings: { allowGuestSave: true },
      }),
    )
    await seed()

    expect(await refusal()).toBe('event.notFound')
  })

  it('answers event.notFound for an event that does not exist', async () => {
    expect(await refusal(asEventId('nobody'))).toBe('event.notFound')
  })

  it.each(PHOTO_STATUSES.filter((status) => !isVisibleOnWall(status)))(
    'answers photo.notFound for a %s photograph, identical to an unknown id',
    async (status) => {
      await seed({ status })

      expect(await refusal()).toBe('photo.notFound')
      expect(await refusal(EVENT, asPhotoId('unknown'))).toBe('photo.notFound')
    },
  )

  it('does not save its author a photograph the wall does not show either', async () => {
    await seed({ status: 'pending', author: { kind: 'guest', id: 'guest-1' } })

    expect(await refusal()).toBe('photo.notFound')
  })

  it('saves a photograph its own author sent: the route accepts it, the button just does not offer it', async () => {
    await seed({ author: { kind: 'guest', id: 'guest-1' } })

    expect(await refusal()).toBeNull()
  })

  describe('on a disposable-camera evening (spec 23, spec 24 section 5.7)', () => {
    const HOUR = 3_600_000
    const heldUntil = (at: Date | null) =>
      events.seed(
        anEvent({
          id: 'event-1',
          slug: SLUG,
          settings: { allowGuestSave: true, reveal: { enabled: true, at } },
        }),
      )

    it('answers photo.notFound before the reveal, identical to an unknown id', async () => {
      heldUntil(new Date(AT.getTime() + HOUR))
      await seed({ author: { kind: 'guest', id: 'guest-2' } })

      expect(await refusal()).toBe('photo.notFound')
      expect(await refusal(EVENT, asPhotoId('unknown'))).toBe('photo.notFound')
    })

    it('answers photo.notFound for a reveal the host has not scheduled (the button)', async () => {
      heldUntil(null)
      await seed({ author: { kind: 'guest', id: 'guest-2' } })

      expect(await refusal()).toBe('photo.notFound')
    })

    it('does not give an author their own photograph before the reveal either', async () => {
      // getPhotoMedia lets the author see their own unrevealed photograph; the save route has no
      // viewer and must not widen that into a copy they could hand on.
      heldUntil(new Date(AT.getTime() + HOUR))
      await seed({ author: { kind: 'guest', id: 'guest-1' } })

      expect(await refusal()).toBe('photo.notFound')
    })

    it('serves the file once the hour has come, read from the clock at each request', async () => {
      heldUntil(new Date(AT.getTime() + HOUR))
      await seed({ author: { kind: 'guest', id: 'guest-2' } })
      expect(await refusal()).toBe('photo.notFound')

      clock.advance(HOUR)

      expect(await refusal()).toBeNull()
    })

    it('still refuses a photograph that is not published after the reveal', async () => {
      heldUntil(new Date(AT.getTime() - HOUR))
      await seed({ status: 'pending' })

      expect(await refusal()).toBe('photo.notFound')
    })

    it('keeps an event whose mode is off exactly as it was', async () => {
      events.seed(
        anEvent({
          id: 'event-1',
          slug: SLUG,
          settings: { allowGuestSave: true, reveal: { enabled: false, at: new Date(AT.getTime() + HOUR) } },
        }),
      )
      await seed()

      expect(await refusal()).toBeNull()
    })

    it('counts nothing for a refusal before the reveal', async () => {
      heldUntil(new Date(AT.getTime() + HOUR))
      await seed()

      await refusal()

      expect(await stats.readCounters(EVENT)).toEqual([])
    })
  })

  it('saves a photograph the host sent, whose author is no guest', async () => {
    await seed({ author: { kind: 'host', id: 'user-1' } })

    expect(await refusal()).toBeNull()
  })

  it('answers photo.notFound for another event photograph', async () => {
    photos.seed(aPhoto({ id: 'photo-1', eventId: 'event-2', status: 'published' }))

    expect(await refusal(EVENT, PHOTO)).toBe('photo.notFound')
  })

  it('answers photo.notFound for a clip, which has no rendition to save', async () => {
    const clip = aClip({ id: 'photo-1', eventId: 'event-1', status: 'published' })
    photos.seed(clip)

    expect(await refusal()).toBe('photo.notFound')
  })

  it('answers photo.notFound for a photograph the operator took down', async () => {
    await seed()
    await photos.setTakenDown(EVENT, PHOTO, AT)

    expect(await refusal()).toBe('photo.notFound')
  })

  it('answers photo.notFound for a photograph deleted between two requests', async () => {
    await seed()
    expect(await refusal()).toBeNull()

    await photos.delete(EVENT, PHOTO)

    expect(await refusal()).toBe('photo.notFound')
  })

  it('answers photo.mediaMissing when the row points at bytes that are gone', async () => {
    photos.seed(aPhoto({ id: 'photo-1', eventId: 'event-1', status: 'published' }))

    expect(await refusal()).toBe('photo.mediaMissing')
  })

  it('opens no file on a refusal', async () => {
    await seed({ status: 'hidden' })
    await refusal()

    events.seed(anEvent({ id: 'event-1', slug: SLUG, settings: { allowGuestSave: false } }))
    await refusal()

    expect(media.opened).toBe(0)
  })

  it('opens the file only when the caller asks for the bytes, once', async () => {
    await seed()

    const result = await save({ eventId: EVENT, photoId: PHOTO })
    expect(media.opened).toBe(0)

    if (!result.ok) throw new Error('expected a save')
    const bytes = await result.value.open()
    expect(bytes).not.toBeNull()
    expect(media.opened).toBe(1)
  })

  describe('the guestSaves counter', () => {
    it('counts one save per granted request, an integer for the event and the UTC day', async () => {
      await seed()

      await save({ eventId: EVENT, photoId: PHOTO })
      await save({ eventId: EVENT, photoId: PHOTO })

      expect(await stats.readCounters(EVENT)).toEqual([
        { metric: 'guestSaves', day: '2026-06-20', value: 2 },
      ])
    })

    it('counts a granted request without any byte being read: a request, not a finished download', async () => {
      await seed()

      const result = await save({ eventId: EVENT, photoId: PHOTO })

      expect(result.ok).toBe(true)
      expect(media.opened).toBe(0)
      expect((await stats.readCounters(EVENT)).map(({ value }) => value)).toEqual([1])
    })

    it('counts nothing for a refusal: hidden, missing bytes, unknown, other event, switch off', async () => {
      await seed({ id: 'hidden', status: 'hidden' })
      photos.seed(aPhoto({ id: 'gone', eventId: 'event-1', status: 'published' }))

      await refusal(EVENT, asPhotoId('hidden'))
      await refusal(EVENT, asPhotoId('gone'))
      await refusal(EVENT, asPhotoId('nobody'))
      await refusal(asEventId('other'), PHOTO)
      events.seed(anEvent({ id: 'event-1', slug: SLUG, settings: { allowGuestSave: false } }))
      await refusal(EVENT, asPhotoId('hidden'))

      expect(await stats.readCounters(EVENT)).toEqual([])
    })

    it('does not fail the save when the counter cannot be written', async () => {
      await seed()
      const failing = makeSaveGuestPhoto({
        events,
        photos,
        media,
        clock: new FakeClock(AT),
        engagement: makeRecordEngagement({
          stats: {
            bump: async () => {
              throw new Error('database is locked')
            },
          },
          clock: new FakeClock(AT),
          logger: new CapturingLogger(),
        }),
      })

      expect((await failing({ eventId: EVENT, photoId: PHOTO })).ok).toBe(true)
    })
  })
})
