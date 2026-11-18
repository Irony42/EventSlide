import { beforeEach, describe, expect, it } from 'vitest'
import { makeGetWallPlaylist, type GetWallPlaylist } from './getWallPlaylist'
import type { EventSettingsPatch } from '../../../domain/events/eventSettings'
import { AT, anEvent, aPhoto, atPlus } from '../../testing/builders'
import { FakeAnnouncementRepository } from '../../testing/fakeAnnouncementRepository'
import { FakeChallengeRepository } from '../../testing/fakeChallengeRepository'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeGuestbookRepository } from '../../testing/fakeGuestbookRepository'
import { FakeGuestRepository } from '../../testing/fakeGuestRepository'
import { FakeMissionRepository } from '../../testing/fakeMissionRepository'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'

/**
 * The wall of a disposable-camera evening (spec 23): no photograph and no count of what was
 * taken before the reveal, the usual wall from the instant of it, and moderation untouched.
 */
describe('getWallPlaylist: the reveal gate', () => {
  let events: FakeEventRepository
  let photos: FakePhotoRepository
  let clock: FakeClock
  let getWallPlaylist: GetWallPlaylist

  const MINUTE = 60_000
  const at = (offsetMs: number): Date => new Date(AT.getTime() + offsetMs)

  beforeEach(() => {
    events = new FakeEventRepository()
    photos = new FakePhotoRepository()
    clock = new FakeClock(AT)
    getWallPlaylist = makeGetWallPlaylist({
      events,
      photos,
      guests: new FakeGuestRepository(),
      missions: new FakeMissionRepository(photos),
      guestbook: new FakeGuestbookRepository(),
      challenges: new FakeChallengeRepository(photos),
      announcements: new FakeAnnouncementRepository(),
      clock,
    })
    photos.seed(
      aPhoto({ id: 'p-shown', eventId: 'event-1', status: 'published', createdAt: atPlus(1) }),
      aPhoto({ id: 'p-shown-2', eventId: 'event-1', status: 'published', createdAt: atPlus(2) }),
      aPhoto({ id: 'p-pending', eventId: 'event-1', status: 'pending', createdAt: atPlus(3) }),
      aPhoto({ id: 'p-hidden', eventId: 'event-1', status: 'hidden', createdAt: atPlus(4) }),
      aPhoto({ id: 'p-gala', eventId: 'event-2', status: 'published', createdAt: atPlus(5) }),
    )
  })

  const open = (reveal: { enabled?: boolean; at?: Date | null }, extra: EventSettingsPatch = {}) =>
    events.seed(
      anEvent({ id: 'event-1', slug: 'camille-et-sacha', settings: { reveal, ...extra } }),
    )

  const wall = async () => {
    const result = await getWallPlaylist({
      slug: anEvent({ slug: 'camille-et-sacha' }).slug,
      layout: null,
      slideIntervalMs: null,
      windowSize: null,
    })
    if (!result.ok) throw new Error(`wall refused: ${result.error.code}`)
    return result.value
  }

  it('serves no photograph, no identifier and no credit before the reveal', async () => {
    open({ enabled: true, at: at(60 * MINUTE) })

    const view = await wall()

    expect(view.playlist.items).toEqual([])
    expect(view.photos).toEqual([])
    expect(view.firstFromGuest.size).toBe(0)
  })

  it('serves no photograph for an evening that waits for the button', async () => {
    open({ enabled: true, at: null })

    expect((await wall()).playlist.items).toEqual([])
  })

  it('says how many are ready, an aggregate with no author, and only before the reveal', async () => {
    open({ enabled: true, at: at(MINUTE) })

    const view = await wall()

    expect(view.readyCount).toBe(2)
  })

  it('carries no souvenir count before the reveal, so the counter and the new-photo signal stay silent', async () => {
    open(
      { enabled: true, at: at(MINUTE) },
      { wall: { souvenirCounter: true, newPhotoSignal: true, soundEnabled: true } },
    )

    expect((await wall()).souvenirCount).toBeNull()
  })

  it('serves the published photographs at the exact instant of the reveal', async () => {
    open({ enabled: true, at: at(0) })

    const view = await wall()

    expect(view.playlist.items).toEqual(['p-shown-2', 'p-shown'])
    expect(view.readyCount).toBeNull()
  })

  it('flips with the server clock and nothing else: one minute earlier it was empty', async () => {
    open({ enabled: true, at: at(MINUTE) })
    expect((await wall()).playlist.items).toEqual([])

    clock.advance(MINUTE)

    expect((await wall()).playlist.items).toEqual(['p-shown-2', 'p-shown'])
  })

  it('shows what the host kept back as it always did: pending and hidden stay off after the reveal', async () => {
    open({ enabled: true, at: at(-MINUTE) })

    const view = await wall()

    expect(view.playlist.items).not.toContain('p-pending')
    expect(view.playlist.items).not.toContain('p-hidden')
    expect(view.playlist.items).not.toContain('p-gala')
  })

  it('is the wall it always was when the mode is off, with the count its switches ask for', async () => {
    open({ enabled: false }, { wall: { souvenirCounter: true } })

    const view = await wall()

    expect(view.playlist.items).toEqual(['p-shown-2', 'p-shown'])
    expect(view.souvenirCount).toBe(2)
    expect(view.readyCount).toBeNull()
  })

  it('counts what is ready from this event only, never another’s', async () => {
    open({ enabled: true, at: at(MINUTE) })
    photos.seed(aPhoto({ id: 'p-gala-2', eventId: 'event-2', status: 'published' }))

    expect((await wall()).readyCount).toBe(2)
  })
})
