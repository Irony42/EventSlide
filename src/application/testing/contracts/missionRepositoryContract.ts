import { beforeEach, describe, expect, it } from 'vitest'
import { MissionPrompt } from '../../../domain/missions/missionPrompt'
import {
  asEventId,
  asGuestId,
  asMissionId,
  asPhotoId,
  type MissionId,
} from '../../../domain/shared/ids'
import type { MissionRepository } from '../../ports/missionRepository'
import type { PhotoRepository } from '../../ports/photoRepository'
import { aMission, aPhoto } from '../builders'

/**
 * The behaviour every `MissionRepository` must have, run against the fake **and**
 * against SQLite.
 *
 * Most of this file is about one thing: **progress is derived from the photographs**,
 * and the two implementations derive it in completely different ways — one filters an
 * array, the other groups a partial index. A fake that counted a refused photograph, or
 * that cascaded a delete where the foreign key unfiles, would make every ring-2 test
 * about missions prove the opposite of what production does. That is not hypothetical
 * in this repository: a critical bug shipped once because a fake did not enforce a
 * UNIQUE index that SQLite did, which is why the duplicate-prompt case is here rather
 * than in the adapter's own file.
 */

/**
 * The rows both implementations need to exist before the contract runs.
 *
 * The SQLite side has foreign keys to `events`, `guests` and `users`, so its harness
 * seeds exactly these; the fake needs nothing and ignores them. Naming them here rather
 * than in the adapter's test file is what keeps the two harnesses in step when a case
 * below starts using a second guest.
 */
export const MISSION_CONTRACT_FIXTURES = {
  eventIds: ['evt-wedding', 'evt-gala'],
  guestIds: ['guest-lea', 'guest-sam', 'guest-gala'],
  userIds: ['user-host'],
} as const

export interface MissionRepositorySubject {
  readonly repo: MissionRepository
  /**
   * The photographs the progress is derived from.
   *
   * A real `PhotoRepository` on both sides rather than a seeding hook, because "does a
   * refused photograph still count" is a question about the two tables *together*, and a
   * bespoke fixture path would let one implementation answer it from state the other
   * never holds.
   */
  readonly photos: PhotoRepository
  readonly dispose?: () => Promise<void>
}

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')
const LEA = asGuestId('guest-lea')
const SAM = asGuestId('guest-sam')

/**
 * A photograph of the wedding, unless a case says otherwise.
 *
 * The builder defaults to `event-1`, and a photograph filed in the wrong event would
 * make every progress case below pass by counting nothing.
 */
/** A mission of the wedding, unless a case says otherwise. Same reason as below. */
const missionAt = (input: Parameters<typeof aMission>[0] = {}) =>
  aMission({ eventId: 'evt-wedding', ...input })

const photoAt = (input: Parameters<typeof aPhoto>[0] = {}) =>
  aPhoto({ eventId: 'evt-wedding', ...input })

const promptOf = (raw: string): MissionPrompt => {
  const parsed = MissionPrompt.create(raw)
  if (!parsed.ok) throw new Error(`contract prompt refused: ${parsed.error.code}`)
  return parsed.value
}

export const missionRepositoryContract = (
  name: string,
  makeSubject: () => Promise<MissionRepositorySubject>,
): void => {
  describe(`MissionRepository contract: ${name}`, () => {
    let subject: MissionRepositorySubject
    let repo: MissionRepository
    let photos: PhotoRepository

    beforeEach(async () => {
      if (subject?.dispose !== undefined) await subject.dispose()
      subject = await makeSubject()
      repo = subject.repo
      photos = subject.photos
    })

    const missionIds = (ids: ReadonlySet<MissionId>): string[] => [...ids].sort()

    // ------------------------------------------------------------- tenant isolation --

    it('returns null for a mission that belongs to another event', async () => {
      await repo.save(missionAt({ id: 'm-gala', eventId: 'evt-gala' }))

      expect(await repo.findById(WEDDING, asMissionId('m-gala'))).toBeNull()
    })

    it('returns null for the same prompt at another event', async () => {
      await repo.save(missionAt({ id: 'm-gala', eventId: 'evt-gala', prompt: 'un selfie' }))

      expect(await repo.findByPrompt(WEDDING, promptOf('un selfie'))).toBeNull()
    })

    it('never lets another event mission reach this list', async () => {
      await repo.save(missionAt({ id: 'm-wedding', eventId: 'evt-wedding' }))
      await repo.save(missionAt({ id: 'm-gala', eventId: 'evt-gala' }))

      const listed = await repo.listWithProgress(WEDDING)

      expect(listed.map((row) => row.mission.id)).toEqual(['m-wedding'])
    })

    it('refuses to delete a mission that belongs to another event', async () => {
      await repo.save(missionAt({ id: 'm-gala', eventId: 'evt-gala' }))

      await repo.delete(WEDDING, asMissionId('m-gala'))

      expect(await repo.findById(GALA, asMissionId('m-gala'))).not.toBeNull()
    })

    // --------------------------------------------------------------------- storage --

    it('round-trips a mission', async () => {
      const mission = missionAt({ id: 'm1', prompt: 'un selfie avec les mariés', scope: 'event' })
      await repo.save(mission)

      const found = await repo.findById(WEDDING, asMissionId('m1'))

      expect(found?.toProps()).toEqual(mission.toProps())
    })

    it('finds a mission by the prompt the host typed', async () => {
      await repo.save(missionAt({ id: 'm1', prompt: 'la première danse' }))

      const found = await repo.findByPrompt(WEDDING, promptOf('la première danse'))

      expect(found?.id).toBe('m1')
    })

    it('refuses a second mission with the same prompt in one event', async () => {
      await repo.save(missionAt({ id: 'm1', prompt: 'un selfie' }))

      await expect(repo.save(missionAt({ id: 'm2', prompt: 'un selfie' }))).rejects.toThrow(
        /UNIQUE constraint/,
      )
    })

    it('updates a mission in place, keeping its place in the list', async () => {
      const first = missionAt({ id: 'm1', prompt: 'un selfi', createdAt: new Date(1_000) })
      const second = missionAt({ id: 'm2', prompt: 'la danse', createdAt: new Date(2_000) })
      await repo.save(first)
      await repo.save(second)

      await repo.save(first.edit(promptOf('un selfie'), 'event'))

      const listed = await repo.listWithProgress(WEDDING)
      expect(listed.map((row) => row.mission.id)).toEqual(['m1', 'm2'])
      expect(listed[0]?.mission.prompt.value).toBe('un selfie')
      expect(listed[0]?.mission.scope).toBe('event')
    })

    it('lists in the order the host wrote them, with ties broken by id', async () => {
      await repo.save(missionAt({ id: 'm-b', createdAt: new Date(1_000) }))
      await repo.save(missionAt({ id: 'm-a', createdAt: new Date(1_000) }))
      await repo.save(missionAt({ id: 'm-c', createdAt: new Date(500) }))

      const listed = await repo.listWithProgress(WEDDING)

      expect(listed.map((row) => row.mission.id)).toEqual(['m-c', 'm-a', 'm-b'])
    })

    it('counts the missions of one event and of no other', async () => {
      await repo.save(missionAt({ id: 'm1', eventId: 'evt-wedding' }))
      await repo.save(missionAt({ id: 'm2', eventId: 'evt-wedding' }))
      await repo.save(missionAt({ id: 'm3', eventId: 'evt-gala' }))

      expect(await repo.count(WEDDING)).toBe(2)
      expect(await repo.count(GALA)).toBe(1)
    })

    // -------------------------------------------------------------------- progress --

    it('reports no progress for a mission nothing names', async () => {
      await repo.save(missionAt({ id: 'm1' }))

      const listed = await repo.listWithProgress(WEDDING)

      expect(listed[0]?.progress).toEqual({ publishedPhotos: 0, completedByGuests: 0 })
    })

    it('counts a published photograph that names the mission', async () => {
      await repo.save(missionAt({ id: 'm1' }))
      await photos.save(photoAt({ id: 'p1', status: 'published', missionId: 'm1' }))

      const listed = await repo.listWithProgress(WEDDING)

      expect(listed[0]?.progress).toEqual({ publishedPhotos: 1, completedByGuests: 1 })
    })

    it.each(['pending', 'rejected', 'hidden'] as const)(
      'does not count a %s photograph, which is what makes a refusal take effect',
      async (status) => {
        await repo.save(missionAt({ id: 'm1' }))
        await photos.save(photoAt({ id: 'p1', status, missionId: 'm1' }))

        const listed = await repo.listWithProgress(WEDDING)

        expect(listed[0]?.progress).toEqual({ publishedPhotos: 0, completedByGuests: 0 })
      },
    )

    it('counts guests rather than photographs, so four selfies from one guest are one guest', async () => {
      await repo.save(missionAt({ id: 'm1' }))
      await photos.save(
        photoAt({
          id: 'p1',
          status: 'published',
          missionId: 'm1',
          author: { kind: 'guest', id: 'guest-lea' },
        }),
      )
      await photos.save(
        photoAt({
          id: 'p2',
          status: 'published',
          missionId: 'm1',
          author: { kind: 'guest', id: 'guest-lea' },
        }),
      )
      await photos.save(
        photoAt({
          id: 'p3',
          status: 'published',
          missionId: 'm1',
          author: { kind: 'guest', id: 'guest-sam' },
        }),
      )

      const listed = await repo.listWithProgress(WEDDING)

      expect(listed[0]?.progress).toEqual({ publishedPhotos: 3, completedByGuests: 2 })
    })

    it('counts a host upload for the room and for no guest tally', async () => {
      await repo.save(missionAt({ id: 'm1' }))
      await photos.save(
        photoAt({
          id: 'p1',
          status: 'published',
          missionId: 'm1',
          author: { kind: 'host', id: 'user-host' },
        }),
      )

      const listed = await repo.listWithProgress(WEDDING)

      expect(listed[0]?.progress).toEqual({ publishedPhotos: 1, completedByGuests: 0 })
    })

    it('ignores a published photograph that names no mission', async () => {
      await repo.save(missionAt({ id: 'm1' }))
      await photos.save(photoAt({ id: 'p1', status: 'published' }))

      const listed = await repo.listWithProgress(WEDDING)

      expect(listed[0]?.progress).toEqual({ publishedPhotos: 0, completedByGuests: 0 })
    })

    // ------------------------------------------------------- one guest answers --

    it('tells a guest which missions their own published photographs answered', async () => {
      await repo.save(missionAt({ id: 'm1' }))
      await repo.save(missionAt({ id: 'm2' }))
      await photos.save(
        photoAt({
          id: 'p1',
          status: 'published',
          missionId: 'm1',
          author: { kind: 'guest', id: 'guest-lea' },
        }),
      )
      await photos.save(
        photoAt({
          id: 'p2',
          status: 'published',
          missionId: 'm2',
          author: { kind: 'guest', id: 'guest-sam' },
        }),
      )

      expect(missionIds(await repo.completedByGuest(WEDDING, LEA))).toEqual(['m1'])
      expect(missionIds(await repo.completedByGuest(WEDDING, SAM))).toEqual(['m2'])
    })

    it('leaves a refused photograph out of the answers of the guest who sent it', async () => {
      await repo.save(missionAt({ id: 'm1' }))
      await photos.save(
        photoAt({
          id: 'p1',
          status: 'rejected',
          missionId: 'm1',
          author: { kind: 'guest', id: 'guest-lea' },
        }),
      )

      expect(missionIds(await repo.completedByGuest(WEDDING, LEA))).toEqual([])
    })

    it('answers nothing for a guest asked about an event they are not at', async () => {
      await repo.save(missionAt({ id: 'm1', eventId: 'evt-gala' }))
      await photos.save(
        photoAt({
          id: 'p1',
          eventId: 'evt-gala',
          status: 'published',
          missionId: 'm1',
          author: { kind: 'guest', id: 'guest-gala' },
        }),
      )

      expect(missionIds(await repo.completedByGuest(WEDDING, asGuestId('guest-gala')))).toEqual([])
    })

    // ---------------------------------------------------------------------- delete --

    it('removes the mission', async () => {
      await repo.save(missionAt({ id: 'm1' }))

      await repo.delete(WEDDING, asMissionId('m1'))

      expect(await repo.findById(WEDDING, asMissionId('m1'))).toBeNull()
    })

    it('unfiles the photographs it held and deletes none of them', async () => {
      // `ON DELETE SET NULL`. A host removing a mistyped prompt has not asked for the
      // photographs filed under it to leave the album.
      await repo.save(missionAt({ id: 'm1' }))
      await photos.save(photoAt({ id: 'p1', status: 'published', missionId: 'm1' }))

      await repo.delete(WEDDING, asMissionId('m1'))

      const photo = await photos.findById(WEDDING, asPhotoId('p1'))
      expect(photo).not.toBeNull()
      expect(photo?.missionId).toBeNull()
    })

    it('is idempotent: deleting a mission that is already gone is not an error', async () => {
      await repo.save(missionAt({ id: 'm1' }))
      await repo.delete(WEDDING, asMissionId('m1'))

      await expect(repo.delete(WEDDING, asMissionId('m1'))).resolves.toBeUndefined()
    })
  })
}
