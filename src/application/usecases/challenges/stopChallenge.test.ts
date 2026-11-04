import { beforeEach, describe, expect, it } from 'vitest'
import { asEventId, asMissionId, asUserId } from '../../../domain/shared/ids'
import { AT, aMission, anEvent } from '../../testing/builders'
import { FakeChallengeRepository } from '../../testing/fakeChallengeRepository'
import { FakeClock } from '../../testing/fakeClock'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { FakeMembershipRepository } from '../../testing/fakeMembershipRepository'
import { FakeMissionRepository } from '../../testing/fakeMissionRepository'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'
import { RecordingEventBus } from '../../testing/recordingEventBus'
import { SequentialIdGenerator } from '../../testing/sequentialIdGenerator'
import { makeStartChallenge } from './startChallenge'
import { makeStopChallenge, type StopChallenge } from './stopChallenge'

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')
const OWNER = asUserId('user-host')
const MODERATOR = asUserId('user-mod')
const STRANGER = asUserId('user-stranger')

describe('stopChallenge', () => {
  let events: FakeEventRepository
  let challenges: FakeChallengeRepository
  let bus: RecordingEventBus
  let clock: FakeClock
  let stopChallenge: StopChallenge
  let launch: () => Promise<unknown>

  const ask = (overrides: Partial<Parameters<StopChallenge>[0]> = {}) =>
    stopChallenge({ eventId: WEDDING, actorId: MODERATOR, ...overrides })

  beforeEach(async () => {
    events = new FakeEventRepository()
    const photos = new FakePhotoRepository()
    const missions = new FakeMissionRepository(photos)
    challenges = new FakeChallengeRepository(photos)
    const memberships = new FakeMembershipRepository()
    bus = new RecordingEventBus()
    clock = new FakeClock(AT)
    stopChallenge = makeStopChallenge({ events, challenges, memberships, bus, clock })
    const start = makeStartChallenge({
      events,
      missions,
      challenges,
      memberships,
      ids: new SequentialIdGenerator(),
      bus,
      clock,
    })
    launch = () =>
      start({
        eventId: WEDDING,
        actorId: MODERATOR,
        missionId: asMissionId('m1'),
        durationSeconds: 120,
      })

    events.seed(
      anEvent({ id: WEDDING, ownerId: OWNER, slug: 'camille-et-sacha', joinCode: 'H7K2QM' }),
      anEvent({ id: GALA, ownerId: STRANGER, slug: 'gala-annuel', joinCode: 'Z3N9PT' }),
    )
    await memberships.grant({ eventId: WEDDING, userId: OWNER, role: 'owner', grantedAt: AT })
    await memberships.grant({
      eventId: WEDDING,
      userId: MODERATOR,
      role: 'moderator',
      grantedAt: AT,
    })
    await memberships.grant({ eventId: GALA, userId: STRANGER, role: 'owner', grantedAt: AT })
    missions.seed(aMission({ id: 'm1', eventId: 'evt-wedding', prompt: 'un selfie' }))
  })

  it('stops the running challenge now and announces it', async () => {
    await launch()
    bus.published.length = 0
    clock.advance(30_000)

    const result = await ask()

    expect(result.ok).toBe(true)
    const stored = await challenges.findLatest(WEDDING)
    expect(stored?.endedAt).toEqual(new Date(AT.getTime() + 30_000))
    expect(stored?.isRunning(clock.now())).toBe(false)
    expect(bus.published).toEqual([{ type: 'challenge.changed', eventId: WEDDING }])
  })

  it('is idempotent: a second stop keeps the first instant and announces nothing', async () => {
    await launch()
    clock.advance(30_000)
    await ask()
    bus.published.length = 0
    clock.advance(10_000)

    const again = await ask()

    expect(again.ok).toBe(true)
    expect((await challenges.findLatest(WEDDING))?.endedAt).toEqual(new Date(AT.getTime() + 30_000))
    expect(bus.published).toEqual([])
  })

  it('answers success with nothing running, and announces nothing', async () => {
    const result = await ask()

    expect(result.ok).toBe(true)
    expect(bus.published).toEqual([])
  })

  it('leaves a challenge that already ran out as it was', async () => {
    await launch()
    clock.advance(121_000)
    bus.published.length = 0

    await ask()

    expect((await challenges.findLatest(WEDDING))?.endedAt).toBeNull()
    expect(bus.published).toEqual([])
  })

  it('does not stop another event challenge', async () => {
    await launch()

    await ask({ eventId: GALA, actorId: STRANGER })

    expect((await challenges.findLatest(WEDDING))?.endedAt).toBeNull()
  })

  it('answers a stranger as it answers an event that does not exist', async () => {
    await launch()

    const result = await ask({ actorId: STRANGER })

    expect(!result.ok && result.error.code).toBe('event.notFound')
    expect((await challenges.findLatest(WEDDING))?.endedAt).toBeNull()
  })

  it('answers notFound for an event that does not exist', async () => {
    const result = await ask({ eventId: asEventId('evt-ghost') })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('still lets a host stop it once the event is closed', async () => {
    await launch()
    events.seed(
      anEvent({
        id: WEDDING,
        ownerId: OWNER,
        slug: 'camille-et-sacha',
        joinCode: 'H7K2QM',
        status: 'closed',
      }),
    )

    await ask({ actorId: OWNER })

    expect((await challenges.findLatest(WEDDING))?.endedAt).not.toBeNull()
  })
})
