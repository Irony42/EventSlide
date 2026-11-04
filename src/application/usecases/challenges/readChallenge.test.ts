import { beforeEach, describe, expect, it } from 'vitest'
import { Challenge } from '../../../domain/challenges/challenge'
import { MissionPrompt } from '../../../domain/missions/missionPrompt'
import {
  asChallengeId,
  asEventId,
  asMissionId,
  asUserId,
  type EventId,
} from '../../../domain/shared/ids'
import { AT, aPhoto, atPlus } from '../../testing/builders'
import { FakeChallengeRepository } from '../../testing/fakeChallengeRepository'
import { FakePhotoRepository } from '../../testing/fakePhotoRepository'
import { readChallenge } from './readChallenge'

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')

const launched = (eventId: EventId, seconds: number): Challenge => {
  const prompt = MissionPrompt.create('un selfie')
  if (!prompt.ok) throw new Error('fixture')
  const started = Challenge.start(
    {
      eventId,
      missionId: asMissionId('m1'),
      prompt: prompt.value,
      durationSeconds: seconds,
      createdBy: asUserId('user-host'),
    },
    asChallengeId(`c-${eventId}`),
    AT,
  )
  if (!started.ok) throw new Error('fixture')
  return started.value
}

describe('readChallenge', () => {
  let photos: FakePhotoRepository
  let challenges: FakeChallengeRepository

  beforeEach(() => {
    photos = new FakePhotoRepository()
    challenges = new FakeChallengeRepository(photos)
  })

  const answer = (id: string, status: 'published' | 'pending', eventId = 'evt-wedding') =>
    photos.seed(aPhoto({ id, eventId, status, missionId: 'm1', createdAt: atPlus(10_000) }))

  it('reads nothing when no challenge was ever launched', async () => {
    expect(await readChallenge(challenges, WEDDING, AT)).toBeNull()
  })

  it('reads the running challenge with no count, however many answered', async () => {
    await challenges.tryStart(launched(WEDDING, 60), AT)
    answer('p1', 'published')

    const reading = await readChallenge(challenges, WEDDING, atPlus(30_000))

    expect(reading?.state).toBe('running')
    expect(reading?.answers).toBeNull()
  })

  it('counts the published answers once it is over, and only those', async () => {
    await challenges.tryStart(launched(WEDDING, 60), AT)
    answer('p1', 'published')
    answer('p2', 'published')
    answer('p3', 'pending')

    const reading = await readChallenge(challenges, WEDDING, atPlus(60_000))

    expect(reading?.state).toBe('ended')
    expect(reading?.answers).toBe(2)
  })

  it('says null rather than zero when nobody answered', async () => {
    await challenges.tryStart(launched(WEDDING, 60), AT)
    answer('p1', 'pending')

    const reading = await readChallenge(challenges, WEDDING, atPlus(60_000))

    expect(reading?.state).toBe('ended')
    expect(reading?.answers).toBeNull()
  })

  it('reads nothing twenty seconds after the end', async () => {
    await challenges.tryStart(launched(WEDDING, 60), AT)

    expect(await readChallenge(challenges, WEDDING, atPlus(60_000 + 20_000))).toBeNull()
  })

  it('never reads another event challenge', async () => {
    await challenges.tryStart(launched(GALA, 60), AT)

    expect(await readChallenge(challenges, WEDDING, atPlus(1_000))).toBeNull()
  })
})
