import { beforeEach, describe, expect, it } from 'vitest'
import { asEventId, asUserId } from '../../../domain/shared/ids'
import { AT, anEvent, aGuest, aPhoto, atPlus } from '../../testing/builders'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeEventStatsRepository } from '../../testing/fakeEventStatsRepository'
import { FakeGuestRepository } from '../../testing/fakeGuestRepository'
import { FakeMembershipRepository } from '../../testing/fakeMembershipRepository'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'
import { FakeReactionRepository } from '../../testing/fakeReactionRepository'
import { PRESENCE_WINDOW_MS } from '../guests/listGuests'
import { makeGetEventStats } from './getEventStats'

const EVENT = asEventId('event-1')
const HOST = asUserId('user-1')
const STRANGER = asUserId('user-9')

describe('getEventStats', () => {
  let events: FakeEventRepository
  let photos: FakePhotoRepository
  let guests: FakeGuestRepository
  let memberships: FakeMembershipRepository
  let clock: FakeClock

  const read = (actorId = HOST) =>
    makeGetEventStats({
      events,
      memberships,
      guests,
      stats: new FakeEventStatsRepository(photos, guests, new FakeReactionRepository()),
      clock,
    })({ eventId: EVENT, actorId })

  beforeEach(() => {
    events = new FakeEventRepository().seed(anEvent({ id: 'event-1', slug: 'event-1' }))
    photos = new FakePhotoRepository()
    guests = new FakeGuestRepository(photos)
    memberships = new FakeMembershipRepository().seed({
      eventId: EVENT,
      userId: HOST,
      role: 'owner',
      grantedAt: AT,
    })
    clock = new FakeClock(atPlus(PRESENCE_WINDOW_MS * 2))
  })

  it('answers zeroes for a draft nobody has joined', async () => {
    const result = await read()

    expect(result.ok && result.value.uploadsTotal).toBe(0)
    expect(result.ok && result.value.activeNow).toBe(0)
    expect(result.ok && result.value.contributors).toEqual({
      top: [],
      anonymous: { guests: 0, photos: 0 },
    })
  })

  it('refuses a stranger with the same 404 an unknown event gets', async () => {
    const result = await read(STRANGER)

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('reads a member of a moderator role too', async () => {
    memberships.seed({ eventId: EVENT, userId: STRANGER, role: 'moderator', grantedAt: AT })

    expect((await read(STRANGER)).ok).toBe(true)
  })

  it('refuses an event the operator took down, to a member too', async () => {
    await events.setTakenDown(EVENT, AT)

    const result = await read()

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it("refuses a suspended client's member: the page shows first names", async () => {
    events = new FakeEventRepository().seed(
      anEvent({ id: 'event-1', slug: 'event-1', clientSuspendedAt: AT }),
    )

    const result = await read()

    expect(!result.ok && result.error.code).toBe('client.suspended')
  })

  it('refuses a member whose event is missing from the repository', async () => {
    events = new FakeEventRepository()

    const result = await read()

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('says nothing was measured while no counter exists, then sums the days with the first one', async () => {
    const stats = new FakeEventStatsRepository(photos, guests, new FakeReactionRepository())
    const read = () =>
      makeGetEventStats({ events, memberships, guests, stats, clock })({
        eventId: EVENT,
        actorId: HOST,
      })
    const before = await read()
    expect(before.ok && before.value.engagement).toBeNull()

    await stats.bump(EVENT, 'galleryViews', '2026-11-15', 4)
    await stats.bump(EVENT, 'galleryViews', '2026-11-14', 1)
    await stats.bump(EVENT, 'galleryArchiveDownloads', '2026-11-16', 2)

    const after = await read()
    expect(after.ok && after.value.engagement).toEqual({
      since: '2026-11-14',
      galleryViews: 5,
      galleryArchiveDownloads: 2,
    })
  })

  it('sums the four statuses into the sends, ranks the sharers, and counts who is here now', async () => {
    guests.seed(
      aGuest({ id: 'g-lea', eventId: 'event-1', displayName: 'Léa', lastSeenAt: clock.now() }),
      aGuest({ id: 'g-old', eventId: 'event-1', displayName: 'Old', lastSeenAt: AT }),
    )
    photos.seed(
      aPhoto({
        id: 'p1',
        eventId: 'event-1',
        author: { kind: 'guest', id: 'g-lea' },
        status: 'published',
      }),
      aPhoto({
        id: 'p2',
        eventId: 'event-1',
        author: { kind: 'guest', id: 'g-lea' },
        status: 'rejected',
      }),
      aPhoto({
        id: 'p3',
        eventId: 'event-1',
        author: { kind: 'guest', id: 'g-old' },
        status: 'pending',
      }),
    )

    const result = await read()

    expect(result.ok && result.value.uploadsTotal).toBe(3)
    expect(result.ok && result.value.activeNow).toBe(1)
    expect(result.ok && result.value.contributors.top).toEqual([
      { displayName: 'Léa', photos: 1, reactions: 0 },
    ])
  })
})
