import { beforeEach, describe, expect, it } from 'vitest'
import { asEventId, asUserId } from '../../../domain/shared/ids'
import { AT, anEvent, atPlus } from '../../testing/builders'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeMembershipRepository } from '../../testing/fakeMembershipRepository'
import { RecordingEventBus } from '../../testing/recordingEventBus'
import { makeScheduleEvent, type ScheduleEvent } from './scheduleEvent'

/** Ring 2: the host arms the automatic opening and closing from the settings screen. */

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')

const OWNER = asUserId('usr-owner')
const MODERATOR = asUserId('usr-moderator')
const STRANGER = asUserId('usr-stranger')

const HOUR = 3_600_000
const OPEN_AT = atPlus(HOUR)
const CLOSE_AT = atPlus(9 * HOUR)

describe('scheduleEvent', () => {
  let events: FakeEventRepository
  let memberships: FakeMembershipRepository
  let bus: RecordingEventBus
  let clock: FakeClock
  let scheduleEvent: ScheduleEvent

  beforeEach(() => {
    events = new FakeEventRepository()
    memberships = new FakeMembershipRepository()
    bus = new RecordingEventBus()
    // The host is at the settings form at {@link AT}; both instants above are ahead.
    clock = new FakeClock(AT)
    scheduleEvent = makeScheduleEvent({ events, memberships, bus, clock })

    events.seed(
      anEvent({ id: WEDDING, slug: 'camille-et-sacha', joinCode: 'H7K2QM', status: 'draft' }),
      anEvent({ id: GALA, slug: 'gala-annuel', joinCode: 'Z3N9PT', status: 'draft' }),
    )
    memberships.seed(
      { eventId: WEDDING, userId: OWNER, role: 'owner', grantedAt: AT },
      { eventId: WEDDING, userId: MODERATOR, role: 'moderator', grantedAt: AT },
    )
  })

  const asOwner = (
    scheduledOpenAt: Date | null,
    scheduledCloseAt: Date | null,
  ): ReturnType<ScheduleEvent> =>
    scheduleEvent({ eventId: WEDDING, actorId: OWNER, scheduledOpenAt, scheduledCloseAt })

  it('stores the two instants the host chose', async () => {
    const result = await asOwner(OPEN_AT, CLOSE_AT)

    expect(result.ok).toBe(true)
    const stored = await events.findById(WEDDING)
    expect(stored?.scheduledOpenAt).toEqual(OPEN_AT)
    expect(stored?.scheduledCloseAt).toEqual(CLOSE_AT)
  })

  it('clears the schedule when both halves are null, so a host can turn it off', async () => {
    await asOwner(OPEN_AT, CLOSE_AT)

    await asOwner(null, null)

    const stored = await events.findById(WEDDING)
    expect(stored?.scheduledOpenAt).toBeNull()
    expect(stored?.scheduledCloseAt).toBeNull()
  })

  it('announces the change, so a second open console does not show a stale schedule', async () => {
    await asOwner(OPEN_AT, CLOSE_AT)

    expect(bus.published).toEqual([{ type: 'event.settingsChanged', eventId: WEDDING }])
  })

  it('refuses an instant that has already gone by, against the injected clock', async () => {
    // The 21:30 case: the host arms the closing and leaves the date on today. Every
    // layer below this one would have said yes, and the sweep would end the party.
    const result = await asOwner(null, atPlus(-HOUR))

    expect(!result.ok && result.error.code).toBe('event.scheduleInPast')
    expect((await events.findById(WEDDING))?.scheduledCloseAt).toBeNull()
    expect(bus.published).toEqual([])
  })

  it('accepts the same instant once the clock is behind it again', async () => {
    // Proves the refusal is the clock's answer and not a constant: nothing about the
    // instant changed, only what time it is.
    clock.set(atPlus(-2 * HOUR))

    const result = await asOwner(null, atPlus(-HOUR))

    expect(result.ok).toBe(true)
  })

  it('clears the notice that a previous schedule was thrown away', async () => {
    events.seed(
      anEvent({
        id: WEDDING,
        slug: 'camille-et-sacha',
        joinCode: 'H7K2QM',
        status: 'live',
        scheduleDiscardedAt: AT,
      }),
    )

    await asOwner(OPEN_AT, CLOSE_AT)

    expect((await events.findById(WEDDING))?.scheduleDiscardedAt).toBeNull()
  })

  it('refuses a closing that comes before the opening, and announces nothing', async () => {
    const result = await asOwner(CLOSE_AT, OPEN_AT)

    expect(!result.ok && result.error.code).toBe('event.scheduleOutOfOrder')
    expect(bus.published).toEqual([])
  })

  it('refuses to arm a timer on an archived event', async () => {
    events.seed(
      anEvent({
        id: WEDDING,
        slug: 'camille-et-sacha',
        joinCode: 'H7K2QM',
        status: 'archived',
      }),
    )

    const result = await asOwner(OPEN_AT, CLOSE_AT)

    expect(!result.ok && result.error.code).toBe('event.immutable')
  })

  it('refuses a moderator, because a schedule decides when guests may upload', async () => {
    const result = await scheduleEvent({
      eventId: WEDDING,
      actorId: MODERATOR,
      scheduledOpenAt: OPEN_AT,
      scheduledCloseAt: null,
    })

    expect(!result.ok && result.error.code).toBe('auth.forbidden')
    expect((await events.findById(WEDDING))?.scheduledOpenAt).toBeNull()
  })

  it('answers notFound to someone with no part in the event, not forbidden', async () => {
    const result = await scheduleEvent({
      eventId: WEDDING,
      actorId: STRANGER,
      scheduledOpenAt: OPEN_AT,
      scheduledCloseAt: null,
    })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('cannot schedule an event the actor owns nothing of, even a real one', async () => {
    const result = await scheduleEvent({
      eventId: GALA,
      actorId: OWNER,
      scheduledOpenAt: OPEN_AT,
      scheduledCloseAt: null,
    })

    expect(!result.ok && result.error.code).toBe('event.notFound')
    expect((await events.findById(GALA))?.scheduledOpenAt).toBeNull()
  })

  it('answers notFound for an event that does not exist', async () => {
    const result = await scheduleEvent({
      eventId: asEventId('evt-nowhere'),
      actorId: OWNER,
      scheduledOpenAt: OPEN_AT,
      scheduledCloseAt: null,
    })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })
})
