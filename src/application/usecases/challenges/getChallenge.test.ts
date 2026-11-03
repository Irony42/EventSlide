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
import { makeGetChallenge, type GetChallenge } from './getChallenge'
import { makeStartChallenge } from './startChallenge'

const WEDDING = asEventId('evt-wedding')
const OWNER = asUserId('user-host')
const MODERATOR = asUserId('user-mod')
const STRANGER = asUserId('user-stranger')

describe('getChallenge', () => {
  let clock: FakeClock
  let getChallenge: GetChallenge
  let launch: () => Promise<unknown>

  const ask = (actorId = MODERATOR, eventId = WEDDING) => getChallenge({ eventId, actorId })

  beforeEach(async () => {
    const events = new FakeEventRepository()
    const photos = new FakePhotoRepository()
    const missions = new FakeMissionRepository(photos)
    const challenges = new FakeChallengeRepository(photos)
    const memberships = new FakeMembershipRepository()
    clock = new FakeClock(AT)
    getChallenge = makeGetChallenge({ events, challenges, memberships, clock })
    const start = makeStartChallenge({
      events,
      missions,
      challenges,
      memberships,
      ids: new SequentialIdGenerator(),
      bus: new RecordingEventBus(),
      clock,
    })
    launch = () =>
      start({
        eventId: WEDDING,
        actorId: OWNER,
        missionId: asMissionId('m1'),
        durationSeconds: 120,
      })

    events.seed(
      anEvent({ id: WEDDING, ownerId: OWNER, slug: 'camille-et-sacha', joinCode: 'H7K2QM' }),
    )
    await memberships.grant({ eventId: WEDDING, userId: OWNER, role: 'owner', grantedAt: AT })
    await memberships.grant({
      eventId: WEDDING,
      userId: MODERATOR,
      role: 'moderator',
      grantedAt: AT,
    })
    missions.seed(aMission({ id: 'm1', eventId: 'evt-wedding', prompt: 'un selfie' }))
  })

  it('reads no challenge, with the server clock, when none runs', async () => {
    const result = await ask()

    expect(result.ok && result.value).toEqual({ challenge: null, serverNowMs: AT.getTime() })
  })

  it('lets a moderator read the running challenge', async () => {
    await launch()
    clock.advance(5_000)

    const result = await ask()

    expect(result.ok && result.value.serverNowMs).toBe(AT.getTime() + 5_000)
    expect(result.ok && result.value.challenge?.state).toBe('running')
    expect(result.ok && result.value.challenge?.challenge.missionId).toBe('m1')
  })

  it('answers a stranger as it answers an event that does not exist', async () => {
    await launch()

    const result = await ask(STRANGER)

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  it('answers notFound for an event that does not exist', async () => {
    const result = await ask(MODERATOR, asEventId('evt-ghost'))

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })
})
