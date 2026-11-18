import { beforeEach, describe, expect, it } from 'vitest'
import type { EventSettingsPatch } from '../../../domain/events/eventSettings'
import type { DomainError } from '../../../domain/shared/errors'
import { asEventId, asGuestId, asPhotoId } from '../../../domain/shared/ids'
import type { Result } from '../../../domain/shared/result'
import type { GuestPhotoPage } from './listGuestPhotos'
import { anEvent, aMission, aPhoto, atPlus, type PhotoInput } from '../../testing/builders'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeMissionRepository } from '../../testing/fakeMissionRepository'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'
import { makeListGuestPhotos, type ListGuestPhotos } from './listGuestPhotos'

const EVENT = asEventId('event-1')
const GUEST = asGuestId('guest-1')

const pageOf = (result: Result<GuestPhotoPage, DomainError>): GuestPhotoPage => {
  if (!result.ok) throw new Error(`expected a page, got ${result.error.code}`)
  return result.value
}

const idsOf = (result: Result<GuestPhotoPage, DomainError>): readonly string[] =>
  pageOf(result).items.map((photo) => photo.id)

describe('listGuestPhotos', () => {
  let events: FakeEventRepository
  let photos: FakePhotoRepository
  let missions: FakeMissionRepository
  let listGuestPhotos: ListGuestPhotos
  let clock: FakeClock

  beforeEach(() => {
    events = new FakeEventRepository()
    photos = new FakePhotoRepository()
    missions = new FakeMissionRepository(photos)
    clock = new FakeClock()
    events.seed(
      anEvent({ id: 'event-1' }),
      anEvent({ id: 'event-2', slug: 'gala-acme', joinCode: '2AB3CD' }),
    )
    listGuestPhotos = makeListGuestPhotos({ events, photos, missions, clock })
  })

  const seedForGuest = (id: string, guestId: string, overrides: PhotoInput = {}): void => {
    photos.seed(
      aPhoto({ id, eventId: 'event-1', author: { kind: 'guest', id: guestId }, ...overrides }),
    )
  }

  it('shows the guest their own photo whatever its status, moderation included', async () => {
    photos.seed(
      aPhoto({
        id: 'waiting',
        author: { kind: 'guest', id: 'guest-1' },
        status: 'pending',
        createdAt: atPlus(0),
      }),
      aPhoto({
        id: 'declined',
        author: { kind: 'guest', id: 'guest-1' },
        status: 'rejected',
        createdAt: atPlus(1_000),
      }),
      aPhoto({
        id: 'on-the-wall',
        author: { kind: 'guest', id: 'guest-1' },
        status: 'published',
        createdAt: atPlus(2_000),
      }),
    )

    const result = await listGuestPhotos({ eventId: EVENT, guestId: GUEST })

    expect(idsOf(result)).toEqual(['on-the-wall', 'declined', 'waiting'])
  })

  it('never shows one guest another guest photo', async () => {
    seedForGuest('mine', 'guest-1')
    seedForGuest('theirs', 'guest-2')

    const result = await listGuestPhotos({ eventId: EVENT, guestId: GUEST })

    expect(idsOf(result)).toEqual(['mine'])
  })

  it('never shows a guest a photo the host uploaded', async () => {
    photos.seed(aPhoto({ id: 'venue-camera', author: { kind: 'host', id: 'user-1' } }))

    const result = await listGuestPhotos({ eventId: EVENT, guestId: GUEST })

    expect(idsOf(result)).toEqual([])
  })

  it('does not reach the same guest id photos in another event', async () => {
    photos.seed(
      aPhoto({ id: 'elsewhere', eventId: 'event-2', author: { kind: 'guest', id: 'guest-1' } }),
    )

    const result = await listGuestPhotos({ eventId: EVENT, guestId: GUEST })

    expect(idsOf(result)).toEqual([])
  })

  it('pages a guest own photos with a cursor', async () => {
    seedForGuest('p1', 'guest-1', { createdAt: atPlus(0) })
    seedForGuest('p2', 'guest-1', { createdAt: atPlus(1_000) })

    const first = await listGuestPhotos({ eventId: EVENT, guestId: GUEST, limit: 1 })
    const second = await listGuestPhotos({
      eventId: EVENT,
      guestId: GUEST,
      limit: 1,
      cursor: pageOf(first).nextCursor,
    })

    expect(idsOf(first)).toEqual(['p2'])
    expect(idsOf(second)).toEqual(['p1'])
  })

  it('treats an explicit absence of paging as no paging at all', async () => {
    seedForGuest('mine', 'guest-1')

    const result = await listGuestPhotos({
      eventId: EVENT,
      guestId: GUEST,
      limit: null,
      cursor: null,
    })

    expect(idsOf(result)).toEqual(['mine'])
  })

  it('names the mission each photo was filed under, and nothing for a mission that is gone', async () => {
    missions.seed(
      aMission({ id: 'm1', eventId: 'event-1', prompt: 'un selfie' }),
      aMission({ id: 'm2', eventId: 'event-1', prompt: 'la piste de danse' }),
    )
    seedForGuest('a', 'guest-1', { missionId: 'm1', createdAt: atPlus(0) })
    seedForGuest('b', 'guest-1', { missionId: 'm2', createdAt: atPlus(1_000) })

    const page = pageOf(await listGuestPhotos({ eventId: EVENT, guestId: GUEST }))

    expect(Object.fromEntries(page.missionPrompts)).toEqual({
      m1: 'un selfie',
      m2: 'la piste de danse',
    })
  })

  it('reads no mission at all when no photo on the page was filed under one', async () => {
    missions.seed(aMission({ id: 'm1', eventId: 'event-1' }))
    seedForGuest('plain', 'guest-1')

    const page = pageOf(await listGuestPhotos({ eventId: EVENT, guestId: GUEST }))

    expect(page.missionPrompts.size).toBe(0)
  })

  it('refuses to list an event that does not exist', async () => {
    const result = await listGuestPhotos({ eventId: asEventId('event-404'), guestId: GUEST })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  describe('the reveal and the roll (spec 23)', () => {
    const MINUTE = 60_000
    const withSettings = (settings: EventSettingsPatch): void => {
      events.seed(anEvent({ id: 'event-1', settings }))
    }
    const ask = async () => pageOf(await listGuestPhotos({ eventId: EVENT, guestId: GUEST }))

    it('keeps the guest’s own photographs in the list before the reveal, status untouched', async () => {
      withSettings({ reveal: { enabled: true, at: new Date(clock.now().getTime() + MINUTE) } })
      seedForGuest('mine', 'guest-1', { status: 'published', createdAt: atPlus(0) })
      seedForGuest('refused', 'guest-1', { status: 'rejected', createdAt: atPlus(1_000) })
      seedForGuest('waiting', 'guest-1', { status: 'pending', createdAt: atPlus(2_000) })

      const page = await ask()

      expect(page.items.map((photo) => [photo.id, photo.status])).toEqual([
        ['waiting', 'pending'],
        ['refused', 'rejected'],
        ['mine', 'published'],
      ])
      expect(page.revealed).toBe(false)
    })

    it('says the evening is revealed from the instant of the hour, and when the mode is off', async () => {
      withSettings({ reveal: { enabled: true, at: clock.now() } })
      expect((await ask()).revealed).toBe(true)

      withSettings({ reveal: { enabled: false } })
      expect((await ask()).revealed).toBe(true)
    })

    it('carries the event and the instant the page was read at, for the reveal block', async () => {
      withSettings({ reveal: { enabled: true, film: true } })

      const page = await ask()

      expect(page.now).toEqual(clock.now())
      expect(page.event.settings.reveal.film).toBe(true)
    })

    it('has no roll for an event with no cap', async () => {
      seedForGuest('a', 'guest-1')

      expect((await ask()).shots).toBeNull()
    })

    it('counts the poses the server counts for the cap: every photograph of theirs, whatever its status', async () => {
      withSettings({ maxPhotosPerGuest: 27 })
      seedForGuest('a', 'guest-1', { status: 'published' })
      seedForGuest('b', 'guest-1', { status: 'rejected' })
      seedForGuest('c', 'guest-1', { status: 'pending' })
      seedForGuest('other', 'guest-2', { status: 'published' })

      expect((await ask()).shots).toEqual({ max: 27, taken: 3 })
    })

    it('gives a pose back when a photograph is removed: the count follows the rows', async () => {
      withSettings({ maxPhotosPerGuest: 5 })
      seedForGuest('a', 'guest-1')
      seedForGuest('b', 'guest-1')
      await photos.delete(EVENT, asPhotoId('b'))

      expect((await ask()).shots).toEqual({ max: 5, taken: 1 })
    })

    it('does not count another event’s photographs of a guest with the same id', async () => {
      withSettings({ maxPhotosPerGuest: 5 })
      photos.seed(
        aPhoto({ id: 'elsewhere', eventId: 'event-2', author: { kind: 'guest', id: 'guest-1' } }),
      )

      expect((await ask()).shots).toEqual({ max: 5, taken: 0 })
    })
  })
})
