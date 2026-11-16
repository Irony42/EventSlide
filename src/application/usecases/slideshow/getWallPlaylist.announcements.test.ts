import { beforeEach, describe, expect, it } from 'vitest'
import { makeGetWallPlaylist, type GetWallPlaylist } from './getWallPlaylist'
import type { EventStatus } from '../../../domain/events/eventStatus'
import { AT, anAnnouncement, anEvent } from '../../testing/builders'
import { FakeAnnouncementRepository } from '../../testing/fakeAnnouncementRepository'
import { FakeChallengeRepository } from '../../testing/fakeChallengeRepository'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeGuestbookRepository } from '../../testing/fakeGuestbookRepository'
import { FakeGuestRepository } from '../../testing/fakeGuestRepository'
import { FakeMissionRepository } from '../../testing/fakeMissionRepository'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'

const SECOND = 1000
const MINUTE = 60 * SECOND
const at = (ms: number): Date => new Date(AT.getTime() + ms)

/** The announcements half of the wall's read (spec 21): what a stranger on the wall's URL may learn. */
describe('getWallPlaylist: the announcements', () => {
  let events: FakeEventRepository
  let announcements: FakeAnnouncementRepository
  let clock: FakeClock
  let getWallPlaylist: GetWallPlaylist

  beforeEach(() => {
    events = new FakeEventRepository()
    announcements = new FakeAnnouncementRepository()
    clock = new FakeClock(AT)
    const photos = new FakePhotoRepository()
    getWallPlaylist = makeGetWallPlaylist({
      events,
      photos,
      guests: new FakeGuestRepository(),
      missions: new FakeMissionRepository(photos),
      guestbook: new FakeGuestbookRepository(),
      challenges: new FakeChallengeRepository(photos),
      announcements,
      clock,
    })
  })

  const open = (status: EventStatus = 'live') =>
    events.seed(anEvent({ id: 'event-1', slug: 'camille-et-sacha', status }))

  const wall = async () => {
    const result = await getWallPlaylist({
      slug: anEvent({ slug: 'camille-et-sacha' }).slug,
      layout: null,
      slideIntervalMs: null,
      windowSize: null,
    })
    if (!result.ok) throw new Error(`wall refused: ${result.error.code}`)
    return result.value.announcements
  }

  const card = (over: Parameters<typeof anAnnouncement>[0] = {}) =>
    anAnnouncement({ eventId: 'event-1', ...over })

  it('is absent for an event with no announcement', async () => {
    open()

    expect(await wall()).toBeNull()
  })

  it('is absent when every announcement is over', async () => {
    open()
    announcements.seed(card({ id: 'past', at: at(-10 * MINUTE) }))

    expect(await wall()).toBeNull()
  })

  it('is absent on a closed wall, which is a keepsake, even with an announcement on screen', async () => {
    open('closed')
    announcements.seed(card({ id: 'now', at: at(-5 * SECOND) }))

    expect(await wall()).toBeNull()
  })

  it('never reaches a draft event, whose wall is not served at all', async () => {
    open('draft')
    announcements.seed(card({ id: 'now', at: at(-5 * SECOND) }))

    const result = await getWallPlaylist({
      slug: anEvent({ slug: 'camille-et-sacha' }).slug,
      layout: null,
      slideIntervalMs: null,
      windowSize: null,
    })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('carries a card that is on screen, with its kind, and the next read', async () => {
    open()
    announcements.seed(card({ id: 'now', text: 'Gâteau', at: at(-5 * SECOND) }))

    const read = await wall()

    expect(read?.items.map((row) => [row.id, row.text.value, row.kind])).toEqual([
      ['now', 'Gâteau', 'fullscreen'],
    ])
    expect(read?.nextReadAtMs).toBe(AT.getTime() + 15 * MINUTE)
  })

  it('carries the kind of a discreet announcement', async () => {
    open()
    announcements.seed(card({ id: 'buffet', kind: 'discreet', at: at(-10 * MINUTE) }))

    expect((await wall())?.items.map((row) => row.kind)).toEqual(['discreet'])
  })

  it('keeps a discreet announcement launched 29 minutes ago on the wall', async () => {
    open()
    announcements.seed(
      card({ id: 'buffet', kind: 'discreet', at: at(-29 * MINUTE), durationSeconds: 1800 }),
    )

    expect((await wall())?.items.map((row) => row.id)).toEqual(['buffet'])
  })

  it('says nothing of a surprise two hours ahead, but that something is pending', async () => {
    open()
    announcements.seed(card({ id: 'secret', text: 'Demande en mariage', at: at(2 * 60 * MINUTE) }))

    const read = await wall()

    expect(read?.items).toEqual([])
    // Capped at fifteen minutes: the wall is not told when.
    expect(read?.nextReadAtMs).toBe(AT.getTime() + 15 * MINUTE)
  })

  it('serves the text 60 seconds before its countdown starts, not 61', async () => {
    open()
    announcements.seed(card({ id: 'cake', at: at(3600 * SECOND), countdownSeconds: 300 }))

    clock.advance(3600 * SECOND - 300 * SECOND - 61 * SECOND)
    expect((await wall())?.items).toEqual([])

    clock.advance(SECOND)
    expect((await wall())?.items.map((row) => row.id)).toEqual(['cake'])
  })

  it('tells the wall to read again half a minute before the countdown starts', async () => {
    open()
    announcements.seed(card({ id: 'cake', at: at(3600 * SECOND), countdownSeconds: 300 }))
    clock.advance(3600 * SECOND - 300 * SECOND - 10 * MINUTE)

    expect((await wall())?.nextReadAtMs).toBe(
      AT.getTime() + 3600 * SECOND - 300 * SECOND - 30 * SECOND,
    )
  })

  it('never reads another event announcements', async () => {
    open()
    announcements.seed(anAnnouncement({ id: 'a-gala', eventId: 'evt-gala', at: at(-5 * SECOND) }))

    expect(await wall()).toBeNull()
  })

  it('bounds its read to twenty rows, whatever the event holds', async () => {
    open()
    for (let i = 0; i < 30; i += 1) {
      announcements.seed(
        card({ id: `a${String(i).padStart(2, '0')}`, at: at(i * 3 * MINUTE - 5 * SECOND) }),
      )
    }

    const read = await wall()

    // At most the rows whose window is open: here the first, which started 5 s ago, and the second is 3 min away.
    expect(read?.items.length).toBeLessThanOrEqual(20)
    expect(read?.items[0]?.id).toBe('a00')
  })
})
