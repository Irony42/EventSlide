import { beforeEach, describe, expect, it } from 'vitest'
import { makeGetWallPlaylist, type GetWallPlaylist } from './getWallPlaylist'
import type { Event } from '../../../domain/events/event'
import type { EventStatus } from '../../../domain/events/eventStatus'
import type { PhotoStatus } from '../../../domain/photos/photoStatus'
import { anEvent, aPhoto, atPlus, AT } from '../../testing/builders'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'

const MINUTE = 60_000

/** The event under test. Its own `slug` is what the tests ask for, so the two cannot drift. */
const wedding = anEvent({ id: 'event-1' })

const anEventWith = (status: EventStatus): Event => anEvent({ id: 'event-1', status })

/** A refusal gets a value no revision can equal, so a failed read cannot pass as stable. */
const revisionOf = (result: Awaited<ReturnType<GetWallPlaylist>>): string =>
  result.ok ? result.value.playlist.revision : 'refused'

describe('getWallPlaylist', () => {
  let events: FakeEventRepository
  let photos: FakePhotoRepository
  let getWallPlaylist: GetWallPlaylist

  beforeEach(() => {
    events = new FakeEventRepository()
    photos = new FakePhotoRepository()
    getWallPlaylist = makeGetWallPlaylist({ events, photos })
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
})
