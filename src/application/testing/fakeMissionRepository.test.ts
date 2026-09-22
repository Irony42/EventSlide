import { describe, expect, it } from 'vitest'
import { asEventId, asGuestId, asMissionId } from '../../domain/shared/ids'
import { aMission, aPhoto } from './builders'
import { FakeMissionRepository } from './fakeMissionRepository'
import { FakePhotoRepository } from './fakePhotoRepository'
import { missionRepositoryContract } from './contracts/missionRepositoryContract'

missionRepositoryContract('fake', async () => {
  const photos = new FakePhotoRepository()
  return { repo: new FakeMissionRepository(photos), photos }
})

const WEDDING = asEventId('evt-wedding')

/**
 * What the fake does that the contract cannot ask of SQLite, because SQLite gets it from
 * the schema instead: the seeding helpers, and the uniqueness a fixture must not be able
 * to walk past.
 */
describe('FakeMissionRepository seeding', () => {
  const subject = () => {
    const photos = new FakePhotoRepository()
    return { photos, missions: new FakeMissionRepository(photos) }
  }

  it('seeds a list and returns itself, so a fixture reads as one expression', () => {
    const { missions } = subject()

    const seeded = missions.seed(aMission({ id: 'm1', eventId: 'evt-wedding' }))

    expect(seeded).toBeInstanceOf(FakeMissionRepository)
  })

  it('refuses a fixture that duplicates a prompt, as the unique index would', () => {
    // A fixture the real database would reject makes the test after it prove nothing.
    const { missions } = subject()
    missions.seed(aMission({ id: 'm1', eventId: 'evt-wedding', prompt: 'un selfie' }))

    expect(() =>
      missions.seed(aMission({ id: 'm2', eventId: 'evt-wedding', prompt: 'un selfie' })),
    ).toThrow(/UNIQUE constraint/)
  })

  it('reads the photographs it is given rather than a copy of them', async () => {
    // The seam between the two fakes. A photograph published *after* the missions fake
    // was built still counts, because nothing here is cached.
    const { photos, missions } = subject()
    missions.seed(aMission({ id: 'm1', eventId: 'evt-wedding' }))

    photos.seed(aPhoto({ id: 'p1', eventId: 'evt-wedding', status: 'published', missionId: 'm1' }))

    const listed = await missions.listWithProgress(WEDDING)
    expect(listed[0]?.progress.publishedPhotos).toBe(1)
  })
})

describe('FakePhotoRepository.unfileMission', () => {
  it('clears the tag on this event only, and touches no other photograph', () => {
    const photos = new FakePhotoRepository()
    photos.seed(
      aPhoto({ id: 'p1', eventId: 'evt-wedding', missionId: 'm1' }),
      aPhoto({ id: 'p2', eventId: 'evt-wedding', missionId: 'm2' }),
      aPhoto({ id: 'p3', eventId: 'evt-gala', missionId: 'm1' }),
    )

    photos.unfileMission(WEDDING, asMissionId('m1'))

    expect(photos.ofEvent(WEDDING).map((photo) => [photo.id, photo.missionId])).toEqual([
      ['p1', null],
      ['p2', 'm2'],
    ])
    expect(photos.ofEvent(asEventId('evt-gala')).map((photo) => photo.missionId)).toEqual(['m1'])
  })

  it('keeps everything else about the photograph', () => {
    const photos = new FakePhotoRepository()
    const before = aPhoto({
      id: 'p1',
      eventId: 'evt-wedding',
      missionId: 'm1',
      status: 'published',
      author: { kind: 'guest', id: 'guest-lea' },
    })
    photos.seed(before)

    photos.unfileMission(WEDDING, asMissionId('m1'))

    const after = photos.ofEvent(WEDDING)[0]
    expect(after?.toProps()).toEqual({ ...before.toProps(), missionId: null })
    expect(after?.author).toEqual({ kind: 'guest', guestId: asGuestId('guest-lea') })
  })
})
