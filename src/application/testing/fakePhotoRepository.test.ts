import { describe, expect, it } from 'vitest'
import { asEventId, asPhotoId } from '../../domain/shared/ids'
import { photoRepositoryContract } from './contracts/photoRepositoryContract'
import { aPhoto, atPlus } from './builders'
import { FakePhotoRepository } from './fakePhotoRepository'

photoRepositoryContract('fake', async () => ({ repo: new FakePhotoRepository() }))

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
