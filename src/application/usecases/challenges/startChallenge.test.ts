import { beforeEach, describe, expect, it } from 'vitest'
import { MAX_CHALLENGES_PER_EVENT } from '../../../domain/challenges/challenge'
import { MissionPrompt } from '../../../domain/missions/missionPrompt'
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
import { makeStartChallenge, type StartChallenge } from './startChallenge'

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')
const OWNER = asUserId('user-host')
const MODERATOR = asUserId('user-mod')
const STRANGER = asUserId('user-stranger')

describe('startChallenge', () => {
  let events: FakeEventRepository
  let missions: FakeMissionRepository
  let challenges: FakeChallengeRepository
  let memberships: FakeMembershipRepository
  let bus: RecordingEventBus
  let clock: FakeClock
  let startChallenge: StartChallenge

  const ask = (overrides: Partial<Parameters<StartChallenge>[0]> = {}) =>
    startChallenge({
      eventId: WEDDING,
      actorId: MODERATOR,
      missionId: asMissionId('m1'),
      durationSeconds: 120,
      ...overrides,
    })

  beforeEach(async () => {
    events = new FakeEventRepository()
    const photos = new FakePhotoRepository()
    missions = new FakeMissionRepository(photos)
    challenges = new FakeChallengeRepository(photos)
    memberships = new FakeMembershipRepository()
    bus = new RecordingEventBus()
    clock = new FakeClock(AT)
    startChallenge = makeStartChallenge({
      events,
      missions,
      challenges,
      memberships,
      ids: new SequentialIdGenerator(),
      bus,
      clock,
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

    missions.seed(
      aMission({ id: 'm1', eventId: 'evt-wedding', prompt: 'un selfie avec votre voisin' }),
      aMission({ id: 'm-gala', eventId: 'evt-gala', prompt: 'un selfie' }),
    )
  })

  it('lets a moderator launch a mission as a challenge, with the prompt frozen into it', async () => {
    const result = await ask()

    expect(result.ok).toBe(true)
    const stored = await challenges.findLatest(WEDDING)
    expect(stored?.prompt.value).toBe('un selfie avec votre voisin')
    expect(stored?.missionId).toBe('m1')
    expect(stored?.startedAt).toEqual(AT)
    expect(stored?.endsAt).toEqual(new Date(AT.getTime() + 120_000))
    expect(stored?.toProps().createdBy).toBe(MODERATOR)
  })

  it('launches a challenge from the text the host typed, with no mission at all', async () => {
    const result = await startChallenge({
      eventId: WEDDING,
      actorId: MODERATOR,
      prompt: 'Un selfie avec votre voisin de table',
      durationSeconds: 120,
    })

    expect(result.ok).toBe(true)
    const stored = await challenges.findLatest(WEDDING)
    expect(stored?.prompt.value).toBe('Un selfie avec votre voisin de table')
    expect(stored?.missionId).toBeNull()
  })

  it('lets the typed text win over the mission and keeps the link', async () => {
    await ask({ prompt: 'Autre texte' })

    const stored = await challenges.findLatest(WEDDING)
    expect(stored?.prompt.value).toBe('Autre texte')
    expect(stored?.missionId).toBe('m1')
  })

  it('refuses a challenge with neither a text nor a mission', async () => {
    const result = await startChallenge({
      eventId: WEDDING,
      actorId: MODERATOR,
      durationSeconds: 120,
    })

    expect(!result.ok && result.error.code).toBe('mission.promptEmpty')
    expect(await challenges.findLatest(WEDDING)).toBeNull()
  })

  it.each(['   ', 'x'.repeat(61), 42])('refuses the text %j', async (prompt) => {
    const result = await ask({ prompt })

    expect(result.ok).toBe(false)
    expect(await challenges.findLatest(WEDDING)).toBeNull()
  })

  it('keeps the frozen prompt when the mission is corrected afterwards', async () => {
    await ask()

    const mission = await missions.findById(WEDDING, asMissionId('m1'))
    const parsed = MissionPrompt.create('tout autre chose')
    if (mission === null || !parsed.ok) throw new Error('fixture')
    await missions.save(mission.edit(parsed.value, 'guest'))

    expect((await challenges.findLatest(WEDDING))?.prompt.value).toBe('un selfie avec votre voisin')
  })

  it('announces the challenge once, with no data', async () => {
    await ask()

    expect(bus.published).toEqual([{ type: 'challenge.changed', eventId: WEDDING }])
  })

  it('refuses a second challenge while one is running, and announces nothing', async () => {
    await ask()
    bus.published.length = 0
    clock.advance(30_000)

    const second = await ask()

    expect(!second.ok && second.error.code).toBe('challenge.alreadyRunning')
    expect(!second.ok && second.error.kind).toBe('conflict')
    expect(bus.published).toEqual([])
  })

  it('accepts a new challenge once the last one ran out', async () => {
    await ask({ durationSeconds: 60 })
    clock.advance(60_000)

    expect((await ask()).ok).toBe(true)
  })

  it('refuses the fifty-first challenge of an event', async () => {
    for (let i = 0; i < MAX_CHALLENGES_PER_EVENT; i += 1) {
      expect((await ask({ durationSeconds: 15 })).ok).toBe(true)
      clock.advance(15_000)
    }

    const result = await ask()

    expect(!result.ok && result.error.code).toBe('challenge.limit')
  })

  it('refuses a mission of another event, as a mission that does not exist', async () => {
    const result = await ask({ missionId: asMissionId('m-gala') })

    expect(!result.ok && result.error.code).toBe('mission.notFound')
    expect(await challenges.findLatest(WEDDING)).toBeNull()
    expect(bus.published).toEqual([])
  })

  it.each([14, 1801, 90.5, '120', null])('refuses a duration of %s', async (durationSeconds) => {
    const result = await ask({ durationSeconds })

    expect(!result.ok && result.error.code).toBe('challenge.durationInvalid')
    expect(await challenges.findLatest(WEDDING)).toBeNull()
  })

  it.each(['closed', 'draft', 'archived'] as const)(
    'refuses to launch on a %s event',
    async (status) => {
      events.seed(
        anEvent({
          id: WEDDING,
          ownerId: OWNER,
          slug: 'camille-et-sacha',
          joinCode: 'H7K2QM',
          status,
        }),
      )

      const result = await ask()

      expect(!result.ok && result.error.code).toBe('challenge.eventNotOpen')
      expect(await challenges.findLatest(WEDDING)).toBeNull()
    },
  )

  it('lets the owner launch too', async () => {
    expect((await ask({ actorId: OWNER })).ok).toBe(true)
  })

  it('answers a stranger as it answers an event that does not exist', async () => {
    const result = await ask({ actorId: STRANGER })

    expect(!result.ok && result.error.code).toBe('event.notFound')
    expect(await challenges.findLatest(WEDDING)).toBeNull()
  })

  it('answers notFound for an event that does not exist', async () => {
    const result = await ask({ eventId: asEventId('evt-ghost') })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })
})
