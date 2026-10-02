import { describe, expect, it } from 'vitest'
import { asEventId, asPhotoId, type ClipJobId, type EventId } from '../../domain/shared/ids'
import { photoRepositoryContract } from './contracts/photoRepositoryContract'
import { aClipJob, aPhoto, atPlus } from './builders'
import { FakeClientRepository } from './fakeClientRepository'
import { FakeClipJobRepository } from './fakeClipJobRepository'
import { FakePhotoRepository } from './fakePhotoRepository'

photoRepositoryContract('fake', async () => {
  // Wired exactly as a use-case test wires it, because that is the arrangement under
  // test: the fake cannot reach a second table on its own, so the queue is handed to it
  // and the two must then answer the same number the SQLite adapter's single statement
  // does.
  const clips = new FakeClipJobRepository()
  // The client link is `events.client_id`, which the fake photo repository cannot see on
  // its own either: it is handed the clients fake, as it is handed the queue.
  const clients = new FakeClientRepository()
  const repo = new FakePhotoRepository().chargeStagedBytesFrom(clips).chargeClientBytesFrom(clients)
  let staged = 0

  return {
    repo,
    stageClipBytes: async (eventId: EventId, byteSize: number): Promise<ClipJobId> => {
      staged += 1
      const job = aClipJob({
        id: `clip-${staged}`,
        eventId,
        sourceByteSize: byteSize,
        status: 'queued',
      })
      clips.seed(job)
      return job.id
    },
    placeEventsInClient: async (clientId, eventIds): Promise<void> => {
      for (const eventId of eventIds) clients.linkEvent(eventId, clientId)
    },
  }
})

const WEDDING = asEventId('evt-wedding')

describe('FakePhotoRepository seeding', () => {
  it('returns itself, so a test arranges its world in one expression', async () => {
    const repo = new FakePhotoRepository()

    expect(repo.seed(aPhoto({ id: 'p1', eventId: WEDDING }))).toBe(repo)
  })

  it('seeds rows the repository can then read', async () => {
    const repo = new FakePhotoRepository().seed(aPhoto({ id: 'p1', eventId: WEDDING }))

    expect((await repo.findById(WEDDING, asPhotoId('p1')))?.id).toBe('p1')
  })

  it('refuses a fixture that duplicates a content hash inside one event', async () => {
    const first = aPhoto({ id: 'p1', eventId: WEDDING })

    expect(() =>
      new FakePhotoRepository().seed(
        first,
        aPhoto({ id: 'p2', eventId: WEDDING, contentHash: first.contentHash.value }),
      ),
    ).toThrow(/UNIQUE constraint failed/)
  })
})

describe('FakePhotoRepository isolation', () => {
  it('hands out a fresh array, so a caller cannot edit the stored listing', async () => {
    const repo = new FakePhotoRepository().seed(aPhoto({ id: 'p1', eventId: WEDDING }))

    const page = await repo.list(WEDDING)
    const again = await repo.list(WEDDING)

    expect(page.items).not.toBe(again.items)
  })

  it('streams a snapshot, so a photo saved mid-export does not join the archive', async () => {
    const repo = new FakePhotoRepository().seed(
      aPhoto({ id: 'p1', eventId: WEDDING, status: 'published' }),
    )

    const stream = repo.streamForExport(WEDDING, ['published'])
    const ids: string[] = []
    for await (const photo of stream) {
      await repo.save(
        aPhoto({ id: 'p2', eventId: WEDDING, status: 'published', createdAt: atPlus(1_000) }),
      )
      ids.push(photo.id)
    }

    expect(ids).toEqual(['p1'])
  })
})
