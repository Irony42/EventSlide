import { describe, expect, it } from 'vitest'
import { asEventId, asGuestId } from '../../domain/shared/ids'
import { guestRepositoryContract } from './contracts/guestRepositoryContract'
import { aClip, aGuest, aPhoto } from './builders'
import { FakeGuestRepository } from './fakeGuestRepository'
import { FakePhotoRepository } from './fakePhotoRepository'

guestRepositoryContract('fake', async () => {
  const photos = new FakePhotoRepository()
  let taken = 0

  return {
    repo: new FakeGuestRepository(photos),
    authorPhoto: async (eventId, guestId, what = {}) => {
      taken += 1
      const photo = {
        id: `photo-${taken}`,
        eventId,
        author: { kind: 'guest', id: guestId },
        ...(what.status === undefined ? {} : { status: what.status }),
      } as const
      await photos.save(what.clip === true ? aClip(photo) : aPhoto(photo))
    },
  }
})

const WEDDING = asEventId('evt-wedding')

describe('FakeGuestRepository without a photo fake', () => {
  it('knows of no photo, so a guest it is handed has taken none, whatever the save carried', async () => {
    const repo = new FakeGuestRepository()
    await repo.save(aGuest({ id: 'guest-lea', eventId: WEDDING, photoCount: 7 }))

    expect((await repo.findById(WEDDING, asGuestId('guest-lea')))?.photoCount).toBe(0)
    expect((await repo.list(WEDDING))[0]?.photoCount).toBe(0)
  })

  it('refuses to seed a guest that carries a count, which it would never return', () => {
    expect(() =>
      new FakeGuestRepository().seed(aGuest({ id: 'guest-lea', eventId: WEDDING, photoCount: 7 })),
    ).toThrow(/photoCount is derived/)
  })

  it('refuses it with a photo fake too: a fixture states photos, not a number', () => {
    expect(() =>
      new FakeGuestRepository(new FakePhotoRepository()).seed(
        aGuest({ id: 'guest-lea', eventId: WEDDING, photoCount: 1 }),
      ),
    ).toThrow(/photoCount is derived/)
  })
})

describe('FakeGuestRepository seeding', () => {
  it('returns itself, so a test arranges its world in one expression', async () => {
    const repo = new FakeGuestRepository()

    expect(repo.seed(aGuest({ id: 'guest-lea', eventId: WEDDING }))).toBe(repo)
  })

  it('seeds rows the repository can then read', async () => {
    const repo = new FakeGuestRepository().seed(aGuest({ id: 'guest-lea', eventId: WEDDING }))

    expect((await repo.findById(WEDDING, asGuestId('guest-lea')))?.id).toBe('guest-lea')
  })

  it('hands out a fresh array, so a caller cannot edit the stored guest list', async () => {
    const repo = new FakeGuestRepository().seed(aGuest({ id: 'guest-lea', eventId: WEDDING }))

    expect(await repo.list(WEDDING)).not.toBe(await repo.list(WEDDING))
  })
})
