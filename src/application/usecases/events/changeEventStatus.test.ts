import { beforeEach, describe, expect, it } from 'vitest'
import type { EventStatus } from '../../../domain/events/eventStatus'
import { asEventId, asUserId } from '../../../domain/shared/ids'
import { AT, anEvent, atPlus } from '../../testing/builders'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeMembershipRepository } from '../../testing/fakeMembershipRepository'
import { RecordingEventBus } from '../../testing/recordingEventBus'
import { makeChangeEventStatus, type ChangeEventStatus } from './changeEventStatus'

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')
const OWNER = asUserId('user-host')
const MODERATOR = asUserId('user-mod')
const STRANGER = asUserId('user-stranger')

/** The speeches ran late: the host closes the party two hours after it was created. */
const CLOSED_AT = atPlus(2 * 60 * 60 * 1_000)

describe('changeEventStatus', () => {
  let events: FakeEventRepository
  let memberships: FakeMembershipRepository
  let bus: RecordingEventBus
  let clock: FakeClock
  let changeEventStatus: ChangeEventStatus

  const seedWedding = (status: EventStatus): void => {
    events.seed(
      anEvent({
        id: WEDDING,
        ownerId: OWNER,
        slug: 'camille-et-sacha',
        joinCode: 'H7K2QM',
        status,
      }),
    )
  }

  beforeEach(async () => {
    events = new FakeEventRepository()
    memberships = new FakeMembershipRepository()
    bus = new RecordingEventBus()
    clock = new FakeClock(CLOSED_AT)
    changeEventStatus = makeChangeEventStatus({ events, memberships, bus, clock })

    seedWedding('draft')
    events.seed(anEvent({ id: GALA, ownerId: STRANGER, slug: 'gala-annuel', joinCode: 'Z3N9PT' }))
    await memberships.grant({ eventId: WEDDING, userId: OWNER, role: 'owner', grantedAt: AT })
    await memberships.grant({
      eventId: WEDDING,
      userId: MODERATOR,
      role: 'moderator',
      grantedAt: AT,
    })
    await memberships.grant({ eventId: GALA, userId: STRANGER, role: 'owner', grantedAt: AT })
  })

  it('opens the doors on a draft event', async () => {
    const result = await changeEventStatus({ eventId: WEDDING, actorId: OWNER, status: 'live' })

    expect(result.ok && result.value.status).toBe('live')
  })

  it('persists the new status, so an upload arriving next is judged by it', async () => {
    await changeEventStatus({ eventId: WEDDING, actorId: OWNER, status: 'live' })

    const stored = await events.findById(WEDDING)

    expect(stored?.status).toBe('live')
  })

  /**
   * A projector left running unattended has to notice on its own that the event it is
   * playing was closed or archived, which is why the status travels with the fact.
   */
  it('announces the status the event now has', async () => {
    await changeEventStatus({ eventId: WEDDING, actorId: OWNER, status: 'live' })

    expect(bus.published).toEqual([
      { type: 'event.statusChanged', eventId: WEDDING, status: 'live' },
    ])
  })

  /** `closedAt` starts the retention clock, and it comes from the injected clock. */
  it('stamps the end of the party from the injected clock', async () => {
    seedWedding('live')

    const result = await changeEventStatus({ eventId: WEDDING, actorId: OWNER, status: 'closed' })

    expect(result.ok && result.value.closedAt).toEqual(CLOSED_AT)
  })

  it('succeeds on a status the event already has, so a double-clicked button is not an error', async () => {
    seedWedding('live')

    const result = await changeEventStatus({ eventId: WEDDING, actorId: OWNER, status: 'live' })

    expect(result.ok).toBe(true)
  })

  // ------------------------------------------------------- illegal transitions --

  it('refuses a transition the lifecycle does not allow', async () => {
    seedWedding('archived')

    const result = await changeEventStatus({ eventId: WEDDING, actorId: OWNER, status: 'live' })

    expect(!result.ok && result.error.code).toBe('event.illegalTransition')
  })

  it('reports an illegal transition as a conflict', async () => {
    seedWedding('archived')

    const result = await changeEventStatus({ eventId: WEDDING, actorId: OWNER, status: 'live' })

    expect(!result.ok && result.error.kind).toBe('conflict')
  })

  it('announces nothing when the transition is refused', async () => {
    seedWedding('archived')

    await changeEventStatus({ eventId: WEDDING, actorId: OWNER, status: 'live' })

    expect(bus.published).toEqual([])
  })

  it('leaves the event archived when the transition is refused', async () => {
    seedWedding('archived')

    await changeEventStatus({ eventId: WEDDING, actorId: OWNER, status: 'live' })

    const stored = await events.findById(WEDDING)

    expect(stored?.status).toBe('archived')
  })

  // ------------------------------------------------------------ authorization --

  /**
   * `closed` stops every guest upload and `archived` is terminal. A moderator was
   * handed a laptop to approve photos, not to end the party.
   */
  it('refuses a moderator of the event', async () => {
    const result = await changeEventStatus({ eventId: WEDDING, actorId: MODERATOR, status: 'live' })

    expect(!result.ok && result.error.kind).toBe('forbidden')
  })

  it('announces nothing when a moderator tries', async () => {
    await changeEventStatus({ eventId: WEDDING, actorId: MODERATOR, status: 'live' })

    expect(bus.published).toEqual([])
  })

  /**
   * `notFound`, not `forbidden`: confirming that an event exists to someone with no
   * part in it turns this into an enumeration oracle for other people's events.
   */
  it('answers notFound to a caller with no membership in the event', async () => {
    const result = await changeEventStatus({
      eventId: WEDDING,
      actorId: asUserId('user-nobody'),
      status: 'live',
    })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('cannot close another event with the role the caller holds on their own', async () => {
    const result = await changeEventStatus({ eventId: GALA, actorId: OWNER, status: 'closed' })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('leaves the other event running', async () => {
    await changeEventStatus({ eventId: GALA, actorId: OWNER, status: 'closed' })

    const stored = await events.findById(GALA)

    expect(stored?.status).toBe('live')
  })

  it('answers notFound for an event id that does not exist', async () => {
    const result = await changeEventStatus({
      eventId: asEventId('evt-nothing'),
      actorId: OWNER,
      status: 'live',
    })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })
})
