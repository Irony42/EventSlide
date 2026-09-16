import { describe, expect, it } from 'vitest'
import { asClipJobId, asEventId, type EventId } from '../../domain/shared/ids'
import { aClipJob, aPhoto } from './builders'
import { clipJobRepositoryContract } from './contracts/clipJobRepositoryContract'
import { FakeClipJobRepository } from './fakeClipJobRepository'
import { FakePhotoRepository } from './fakePhotoRepository'

clipJobRepositoryContract('fake', async () => {
  // Wired in both directions, as a use-case test wires it and as the SQLite adapter is
  // wired by having one database: staging is judged against the album, and the album's
  // total counts the queue. Leaving either half out is the drift this suite exists for.
  const repo = new FakeClipJobRepository()
  const photos = new FakePhotoRepository().chargeStagedBytesFrom(repo)
  repo.chargePhotoBytesFrom(photos)
  let saved = 0

  return {
    repo,
    // The fake seeds; `save` is update-only, as the adapter is.
    insertJob: async (job): Promise<void> => {
      repo.seed(job)
    },
    savePhotoBytes: async (eventId: EventId, byteSize: number): Promise<void> => {
      saved += 1
      await photos.save(aPhoto({ id: `photo-${saved}`, eventId, byteSize }))
    },
  }
})

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
