import { describe, expect, it } from 'vitest'
import { FakeMissionRepository } from './fakeMissionRepository'
import { FakePhotoRepository } from './fakePhotoRepository'
import { FakeChallengeRepository } from './fakeChallengeRepository'
import { challengeRepositoryContract } from './contracts/challengeRepositoryContract'

challengeRepositoryContract('fake', async () => {
  const photos = new FakePhotoRepository()
  return {
    repo: new FakeChallengeRepository(photos),
    photos,
    missions: new FakeMissionRepository(photos),
  }
})

describe('FakeChallengeRepository seeding', () => {
  it('returns itself from seed so a test reads in one line', () => {
    const repo = new FakeChallengeRepository(new FakePhotoRepository())

    expect(repo.seed()).toBe(repo)
  })
})
