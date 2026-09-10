import { beforeEach, describe, expect, it } from 'vitest'
import type { EventRole } from '../../../domain/events/eventRole'
import { asEventId, asUserId } from '../../../domain/shared/ids'
import { AT, aGuest, atPlus } from '../../testing/builders'
import { FakeClock } from '../../testing/fakeClock'
import { FakeGuestRepository } from '../../testing/fakeGuestRepository'
import { FakeMembershipRepository } from '../../testing/fakeMembershipRepository'
import { makeListGuests, PRESENCE_WINDOW_MS } from './listGuests'

const WEDDING = asEventId('event-1')
const GALA = asEventId('event-2')
const HOST = asUserId('user-1')
const GALA_HOST = asUserId('user-2')

describe('listGuests', () => {
  let guests: FakeGuestRepository
  let memberships: FakeMembershipRepository
  let clock: FakeClock

  const list = (actorId = HOST, eventId = WEDDING) =>
    makeListGuests({ guests, memberships, clock })({ eventId, actorId })

  beforeEach(() => {
    guests = new FakeGuestRepository()
    memberships = new FakeMembershipRepository().seed(
      { eventId: WEDDING, userId: HOST, role: 'owner', grantedAt: AT },
      { eventId: GALA, userId: GALA_HOST, role: 'owner', grantedAt: AT },
    )
    // Far enough into the party that a guest can be seen before the window opens.
    clock = new FakeClock(atPlus(PRESENCE_WINDOW_MS * 2))
  })

  // -------------------------------------------------------------------- listing --

  it('lists the guests most recently seen first, as the host list is ordered', async () => {
    guests.seed(
      aGuest({ id: 'guest-early', eventId: WEDDING, lastSeenAt: AT }),
      aGuest({ id: 'guest-late', eventId: WEDDING, lastSeenAt: atPlus(60_000) }),
    )

    const result = await list()

    expect(result.ok && result.value.guests.map((guest) => guest.id)).toEqual([
      'guest-late',
      'guest-early',
    ])
  })

  it('lists nobody at an event nobody has joined', async () => {
    const result = await list()

    expect(result.ok && result.value.guests).toEqual([])
  })

  // ------------------------------------------------------------------- presence --

  it('counts a guest seen inside the presence window as being in the room', async () => {
    guests.seed(aGuest({ id: 'guest-here', eventId: WEDDING, lastSeenAt: clock.now() }))

    const result = await list()

    expect(result.ok && result.value.activeCount).toBe(1)
  })

  it('does not count a guest last seen before the window opened as still here', async () => {
    guests.seed(aGuest({ id: 'guest-gone', eventId: WEDDING, lastSeenAt: AT }))

    const result = await list()

    expect(result.ok && result.value.activeCount).toBe(0)
  })

  it('counts a guest seen exactly when the window opened, so the count cannot flicker', async () => {
    const windowOpened = new Date(clock.now().getTime() - PRESENCE_WINDOW_MS)
    guests.seed(aGuest({ id: 'guest-edge', eventId: WEDDING, lastSeenAt: windowOpened }))

    const result = await list()

    expect(result.ok && result.value.activeCount).toBe(1)
  })

  /**
   * Both halves of the same rule: the host must still see whom they removed, or the
   * button looks like it did nothing — and must not see them counted as present, or it
   * looks like it failed.
   */
  it('lists a revoked guest without counting them as being in the room', async () => {
    guests.seed(
      aGuest({ id: 'guest-here', eventId: WEDDING, lastSeenAt: clock.now() }),
      aGuest({
        id: 'guest-revoked',
        eventId: WEDDING,
        lastSeenAt: clock.now(),
        revokedAt: clock.now(),
      }),
    )

    const result = await list()

    const summary = result.ok && {
      listed: result.value.guests.length,
      active: result.value.activeCount,
    }
    expect(summary).toEqual({ listed: 2, active: 1 })
  })

  // -------------------------------------------------------------- authorization --

  it.each<EventRole>(['owner', 'moderator'])(
    'lets %s read the guest list, because that is the console they were handed',
    async (role) => {
      memberships.seed({ eventId: WEDDING, userId: HOST, role, grantedAt: AT })

      const result = await list()

      expect(result.ok).toBe(true)
    },
  )

  /** 403 would confirm the event exists; `requireRole` answers 404 for the same reason. */
  it('refuses a host of another event, and says nothing about this one', async () => {
    const result = await list(GALA_HOST)

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('refuses a caller with no membership at all', async () => {
    const result = await list(asUserId('user-inconnu'))

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  // ----------------------------------------------------------------- one event --

  it('lists the guests of one event only', async () => {
    guests.seed(
      aGuest({ id: 'guest-lea', eventId: WEDDING, lastSeenAt: clock.now() }),
      aGuest({ id: 'guest-sam', eventId: GALA, lastSeenAt: clock.now() }),
    )

    const result = await list()

    expect(result.ok && result.value.guests.map((guest) => guest.id)).toEqual(['guest-lea'])
  })

  it('counts the guests of one event only', async () => {
    guests.seed(aGuest({ id: 'guest-sam', eventId: GALA, lastSeenAt: clock.now() }))

    const result = await list()

    expect(result.ok && result.value.activeCount).toBe(0)
  })
})
