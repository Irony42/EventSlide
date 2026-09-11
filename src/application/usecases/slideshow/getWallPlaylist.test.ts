import { beforeEach, describe, expect, it } from 'vitest'
import { makeGetWallPlaylist, type GetWallPlaylist } from './getWallPlaylist'
import type { Event } from '../../../domain/events/event'
import type { EventStatus } from '../../../domain/events/eventStatus'
import type { PhotoStatus } from '../../../domain/photos/photoStatus'
import type { GuestRepository } from '../../ports/guestRepository'
import { aGuest, anEvent, aPhoto, atPlus, AT } from '../../testing/builders'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeGuestRepository } from '../../testing/fakeGuestRepository'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'

const MINUTE = 60_000

/** The event under test. Its own `slug` is what the tests ask for, so the two cannot drift. */
const wedding = anEvent({ id: 'event-1' })

const anEventWith = (status: EventStatus): Event => anEvent({ id: 'event-1', status })

/** A refusal gets a value no revision can equal, so a failed read cannot pass as stable. */
const revisionOf = (result: Awaited<ReturnType<GetWallPlaylist>>): string =>
  result.ok ? result.value.playlist.revision : 'refused'

interface RecordedGuests {
  readonly repo: GuestRepository
  /** One entry per batched name lookup, holding how many ids it asked for. */
  readonly batches: number[]
}

/**
 * Records the batches asked of a `GuestRepository` while forwarding every call to the
 * real fake. Not a stub — the names still come from the seeded rows. It exists so a test
 * can hold the use case to the *shape* of its access rather than only to its answer: an
 * N+1 returns exactly the same credits and passes every other test in this file.
 */
const recording = (inner: FakeGuestRepository): RecordedGuests => {
  const batches: number[] = []

  return {
    batches,
    repo: {
      findById: (eventId, guestId) => inner.findById(eventId, guestId),
      findNamesByIds: (eventId, guestIds) => {
        batches.push(guestIds.length)
        return inner.findNamesByIds(eventId, guestIds)
      },
      list: (eventId) => inner.list(eventId),
      countActive: (eventId, since) => inner.countActive(eventId, since),
      save: (guest) => inner.save(guest),
      delete: (eventId, guestId) => inner.delete(eventId, guestId),
    },
  }
}

describe('getWallPlaylist', () => {
  let events: FakeEventRepository
  let photos: FakePhotoRepository
  let guests: FakeGuestRepository
  let getWallPlaylist: GetWallPlaylist

  beforeEach(() => {
    events = new FakeEventRepository()
    photos = new FakePhotoRepository()
    guests = new FakeGuestRepository()
    getWallPlaylist = makeGetWallPlaylist({ events, photos, guests })
  })

  const ask = (
    overrides: {
      readonly layout?: 'spotlight' | 'mosaic'
      readonly slideIntervalMs?: number
      readonly windowSize?: number
    } = {},
  ) =>
    getWallPlaylist({
      slug: wedding.slug,
      layout: overrides.layout ?? null,
      slideIntervalMs: overrides.slideIntervalMs ?? null,
      windowSize: overrides.windowSize ?? null,
    })

  it('plays the published photos newest first, so a guest looks up and sees theirs', async () => {
    events.seed(wedding)
    photos.seed(
      aPhoto({ id: 'photo-1', eventId: 'event-1', status: 'published', createdAt: AT }),
      aPhoto({
        id: 'photo-2',
        eventId: 'event-1',
        status: 'published',
        createdAt: atPlus(MINUTE),
      }),
    )

    const result = await ask()

    expect(result.ok && result.value.playlist.items).toEqual(['photo-2', 'photo-1'])
  })

  it.each(['pending', 'rejected', 'hidden'] as const)(
    'never puts a %s photo on the wall',
    async (status: PhotoStatus) => {
      events.seed(wedding)
      photos.seed(
        aPhoto({ id: 'photo-1', eventId: 'event-1', status }),
        aPhoto({ id: 'photo-2', eventId: 'event-1', status: 'published' }),
      )

      const result = await ask()

      expect(result.ok && result.value.playlist.items).toEqual(['photo-2'])
    },
  )

  it('never puts a photo from another event on the wall', async () => {
    events.seed(wedding)
    photos.seed(
      aPhoto({ id: 'photo-1', eventId: 'event-1', status: 'published' }),
      aPhoto({ id: 'photo-2', eventId: 'event-2', status: 'published' }),
    )

    const result = await ask()

    expect(result.ok && result.value.playlist.items).toEqual(['photo-1'])
  })

  it.each(['draft', 'archived'] as const)(
    'refuses to serve a %s event, indistinguishably from one that does not exist',
    async (status: EventStatus) => {
      events.seed(anEventWith(status))

      const result = await ask()

      expect(!result.ok && result.error.code).toBe('event.notFound')
    },
  )

  it('keeps serving a closed event, because the projector is still on', async () => {
    events.seed(anEventWith('closed'))
    photos.seed(aPhoto({ id: 'photo-1', eventId: 'event-1', status: 'published' }))

    const result = await ask()

    expect(result.ok && result.value.playlist.items).toEqual(['photo-1'])
  })

  it('refuses a slug no event holds', async () => {
    const result = await ask()

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('changes the revision when a photo is published', async () => {
    events.seed(wedding)
    photos.seed(aPhoto({ id: 'photo-1', eventId: 'event-1', status: 'published' }))
    const before = revisionOf(await ask())

    await photos.save(
      aPhoto({
        id: 'photo-2',
        eventId: 'event-1',
        status: 'published',
        createdAt: atPlus(MINUTE),
      }),
    )

    expect(revisionOf(await ask())).not.toBe(before)
  })

  it('keeps the revision stable when nothing changed, so the wall does not jump', async () => {
    events.seed(wedding)
    photos.seed(aPhoto({ id: 'photo-1', eventId: 'event-1', status: 'published' }))
    const first = revisionOf(await ask())

    const second = revisionOf(await ask())

    expect(second).toBe(first)
  })

  it('bounds the rotation to the requested window, keeping the newest photos', async () => {
    events.seed(wedding)
    photos.seed(
      aPhoto({ id: 'photo-1', eventId: 'event-1', status: 'published', createdAt: AT }),
      aPhoto({
        id: 'photo-2',
        eventId: 'event-1',
        status: 'published',
        createdAt: atPlus(MINUTE),
      }),
      aPhoto({
        id: 'photo-3',
        eventId: 'event-1',
        status: 'published',
        createdAt: atPlus(2 * MINUTE),
      }),
    )

    const result = await ask({ windowSize: 2 })

    expect(result.ok && result.value.playlist.items).toEqual(['photo-3', 'photo-2'])
  })

  it('refuses a window that would leave the wall with no slots', async () => {
    events.seed(wedding)

    const result = await ask({ windowSize: 0 })

    expect(!result.ok && result.error.code).toBe('playlist.windowSizeTooSmall')
  })

  it('derives the Ken Burns duration from the default slide interval', async () => {
    events.seed(wedding)

    const result = await ask()

    expect(result.ok && result.value.slideIntervalMs).toBe(8_000)
    expect(result.ok && result.value.kenBurnsDurationMs).toBe(8_800)
  })

  it('derives the Ken Burns duration from a host-chosen slide interval', async () => {
    events.seed(wedding)

    const result = await ask({ slideIntervalMs: 12_000 })

    expect(result.ok && result.value.kenBurnsDurationMs).toBe(12_800)
  })

  it('refuses a slide interval the room could not follow', async () => {
    events.seed(wedding)

    const result = await ask({ slideIntervalMs: 500 })

    expect(!result.ok && result.error.code).toBe('slideInterval.tooShort')
  })

  it('defaults to the layout that never crops a guest photo', async () => {
    events.seed(wedding)

    const result = await ask()

    expect(result.ok && result.value.layout).toBe('spotlight')
    expect(result.ok && result.value.layoutSpec).toEqual({
      slotCount: 1,
      crops: false,
      showsCaption: true,
      showsAuthor: true,
    })
  })

  it('reports the slot count of a host-chosen layout', async () => {
    events.seed(wedding)

    const result = await ask({ layout: 'mosaic' })

    expect(result.ok && result.value.layoutSpec.slotCount).toBe(6)
  })

  it('hands back the published photos themselves, so the caller needs no second read', async () => {
    events.seed(wedding)
    photos.seed(aPhoto({ id: 'photo-1', eventId: 'event-1', status: 'published' }))

    const result = await ask()

    expect(result.ok && result.value.photos.map((photo) => photo.id)).toEqual(['photo-1'])
  })

  // ------------------------------------------------------------- attribution --

  /** `authorNames` as a plain object, so a test states the credits and nothing else. */
  const creditsOf = (result: Awaited<ReturnType<GetWallPlaylist>>): Record<string, string> =>
    result.ok ? Object.fromEntries(result.value.authorNames) : { refused: 'refused' }

  it('names the guest who sent each photo, so the wall can credit them', async () => {
    events.seed(wedding)
    guests.seed(
      aGuest({ id: 'guest-lea', eventId: 'event-1', displayName: 'Léa' }),
      aGuest({ id: 'guest-sacha', eventId: 'event-1', displayName: 'Sacha' }),
    )
    photos.seed(
      aPhoto({
        id: 'photo-1',
        eventId: 'event-1',
        status: 'published',
        author: { kind: 'guest', id: 'guest-lea' },
      }),
      aPhoto({
        id: 'photo-2',
        eventId: 'event-1',
        status: 'published',
        author: { kind: 'guest', id: 'guest-sacha' },
        createdAt: atPlus(MINUTE),
      }),
    )

    expect(creditsOf(await ask())).toEqual({ 'photo-1': 'Léa', 'photo-2': 'Sacha' })
  })

  it('credits an accented name exactly as the guest typed it', async () => {
    events.seed(wedding)
    guests.seed(aGuest({ id: 'guest-zoe', eventId: 'event-1', displayName: 'Zoé Müller' }))
    photos.seed(
      aPhoto({
        id: 'photo-1',
        eventId: 'event-1',
        status: 'published',
        author: { kind: 'guest', id: 'guest-zoe' },
      }),
    )

    expect(creditsOf(await ask())).toEqual({ 'photo-1': 'Zoé Müller' })
  })

  it('leaves an anonymous guest unnamed rather than labelling them on the projector', async () => {
    // Uploading without giving a name is a supported choice, not a degraded one.
    // `Guest.label()` answers `null` and this read carries that through: a stand-in
    // ("Invité") is French UI copy, it belongs in web/src/lib/i18n/, and stamping it
    // under someone's photo in front of the room names them something they declined.
    events.seed(wedding)
    guests.seed(aGuest({ id: 'guest-timide', eventId: 'event-1', displayName: null }))
    photos.seed(
      aPhoto({
        id: 'photo-1',
        eventId: 'event-1',
        status: 'published',
        author: { kind: 'guest', id: 'guest-timide' },
      }),
    )

    const result = await ask()

    expect(creditsOf(result)).toEqual({})
    expect(result.ok && result.value.playlist.items).toEqual(['photo-1'])
  })

  it('credits nobody for a photo the host uploaded from the venue camera', async () => {
    events.seed(wedding)
    photos.seed(
      aPhoto({
        id: 'photo-1',
        eventId: 'event-1',
        status: 'published',
        author: { kind: 'host', id: 'user-camille' },
      }),
    )

    expect(creditsOf(await ask())).toEqual({})
  })

  it('credits nobody when the sender row is gone, instead of dropping the slide', async () => {
    events.seed(wedding)
    photos.seed(
      aPhoto({
        id: 'photo-1',
        eventId: 'event-1',
        status: 'published',
        author: { kind: 'guest', id: 'guest-parti' },
      }),
    )

    const result = await ask()

    expect(creditsOf(result)).toEqual({})
    expect(result.ok && result.value.playlist.items).toEqual(['photo-1'])
  })

  it('never reads a name from another event, because the wall is public', async () => {
    // A guest id is opaque, but it is the only thing standing between one party's
    // projector and another party's guest list. The lookup is scoped by event id.
    events.seed(wedding)
    guests.seed(aGuest({ id: 'guest-sam', eventId: 'event-2', displayName: 'Sam' }))
    photos.seed(
      aPhoto({
        id: 'photo-1',
        eventId: 'event-1',
        status: 'published',
        author: { kind: 'guest', id: 'guest-sam' },
      }),
    )

    expect(creditsOf(await ask())).toEqual({})
  })

  it('resolves the senders in one batched read, never one per slide', async () => {
    // A playlist is many photos by few guests, and this is the surface that has to stay
    // smooth for eight hours. The assertion is on the access shape, not on the answer:
    // an N+1 here passes every other test in this file.
    events.seed(wedding)
    guests.seed(aGuest({ id: 'guest-lea', eventId: 'event-1', displayName: 'Léa' }))
    photos.seed(
      ...Array.from({ length: 10 }, (_, index) =>
        aPhoto({
          id: `photo-${index}`,
          eventId: 'event-1',
          status: 'published',
          author: { kind: 'guest', id: 'guest-lea' },
          createdAt: atPlus(index * MINUTE),
        }),
      ),
    )
    const recorded = recording(guests)
    getWallPlaylist = makeGetWallPlaylist({ events, photos, guests: recorded.repo })

    const result = await ask()

    // One read, carrying the one distinct sender behind all ten slides.
    expect(recorded.batches).toEqual([1])
    expect(Object.keys(creditsOf(result))).toHaveLength(10)
  })

  it('resolves names for the playlist window only, not for every candidate read', async () => {
    // Photos outside the window never reach the screen. Naming their senders would be a
    // read the room cannot see the result of.
    events.seed(wedding)
    guests.seed(
      aGuest({ id: 'guest-lea', eventId: 'event-1', displayName: 'Léa' }),
      aGuest({ id: 'guest-sacha', eventId: 'event-1', displayName: 'Sacha' }),
    )
    photos.seed(
      aPhoto({
        id: 'photo-1',
        eventId: 'event-1',
        status: 'published',
        author: { kind: 'guest', id: 'guest-lea' },
        createdAt: AT,
      }),
      aPhoto({
        id: 'photo-2',
        eventId: 'event-1',
        status: 'published',
        author: { kind: 'guest', id: 'guest-sacha' },
        createdAt: atPlus(MINUTE),
      }),
    )

    expect(creditsOf(await ask({ windowSize: 1 }))).toEqual({ 'photo-2': 'Sacha' })
  })

  it('asks for no names at all when the wall has nothing to play', async () => {
    events.seed(wedding)

    expect(creditsOf(await ask())).toEqual({})
  })
})
