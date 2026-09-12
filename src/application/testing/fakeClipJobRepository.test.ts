import { describe, expect, it } from 'vitest'
import { asClipJobId, asEventId } from '../../domain/shared/ids'
import { aClipJob } from './builders'
import { clipJobRepositoryContract } from './contracts/clipJobRepositoryContract'
import { FakeClipJobRepository } from './fakeClipJobRepository'

clipJobRepositoryContract('fake', async () => ({ repo: new FakeClipJobRepository() }))

const WEDDING = asEventId('evt-wedding')

describe('FakeClipJobRepository seeding', () => {
  it('returns itself, so a test arranges its world in one expression', () => {
    const repo = new FakeClipJobRepository()

    expect(repo.seed(aClipJob({ id: 'job-1', eventId: WEDDING }))).toBe(repo)
  })

  it('seeds rows the repository can then read', async () => {
    const repo = new FakeClipJobRepository().seed(aClipJob({ id: 'job-1', eventId: WEDDING }))

    expect((await repo.findById(WEDDING, asClipJobId('job-1')))?.id).toBe('job-1')
  })

  it('exposes everything it holds, for a test asserting on the queue as a whole', () => {
    const repo = new FakeClipJobRepository().seed(
      aClipJob({ id: 'job-1', eventId: WEDDING }),
      aClipJob({ id: 'job-2', eventId: WEDDING }),
    )

    expect(repo.all.map((job) => job.id)).toEqual(['job-1', 'job-2'])
  })
})
