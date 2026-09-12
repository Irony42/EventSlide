import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asEventId, asUserId } from '../../../domain/shared/ids'
import { JoinCode } from '../../../domain/shared/joinCode'
import { Slug } from '../../../domain/shared/slug'
import type { EventRepository } from '../../ports/eventRepository'
import { AT, anEvent, atPlus } from '../builders'

/**
 * The shared `EventRepository` contract.
 *
 * Run by the SQLite adapter and by `FakeEventRepository`, so a double that stopped
 * enforcing uniqueness could not quietly make a use-case test pass.
 *
 * The two unique indexes carry real weight. A duplicate slug points two QR codes at
 * one album; a duplicate join code sends a guest to the wrong party, which is the
 * shape of 1.0's worst defect. Both are asserted here rather than left to the schema,
 * because the retry a use case needs depends on the repository actually refusing.
 *
 * `listForUser` is asserted only on what this port alone can establish: ownership,
 * order, and the mapped columns. Its photo, pending, guest and byte counts are a join
 * in SQLite, so each implementation asserts them in its own test with the neighbouring
 * repositories in place.
 */

/** `events.owner_id` references `users`, so a subject must hold these accounts. */
export const EVENT_CONTRACT_FIXTURES = {
  userIds: ['user-host', 'user-other'],
} as const

const HOST = asUserId('user-host')
const OTHER = asUserId('user-other')
const DAY = 86_400_000

const slug = (value: string): Slug => {
  const parsed = Slug.create(value)
  if (!parsed.ok) throw new Error(`invalid fixture slug: ${value}`)
  return parsed.value
}

const joinCode = (value: string): JoinCode => {
  const parsed = JoinCode.create(value)
  if (!parsed.ok) throw new Error(`invalid fixture join code: ${value}`)
  return parsed.value
}

export const eventRepositoryContract = (
  name: string,
  makeSubject: () => Promise<{ repo: EventRepository; dispose?: () => Promise<void> }>,
): void => {
  describe(`EventRepository contract: ${name}`, () => {
    let repo: EventRepository
    let dispose: (() => Promise<void>) | undefined

    beforeEach(async () => {
      const subject = await makeSubject()
      repo = subject.repo
      dispose = subject.dispose
    })

    afterEach(async () => {
      await dispose?.()
    })

    // ------------------------------------------------------------ round trip --

    it('round-trips every field of a saved event', async () => {
      await repo.save(
        anEvent({
          id: 'evt-1',
          ownerId: HOST,
          name: 'Camille & Sacha',
          slug: 'camille-et-sacha',
          joinCode: 'H7K2QM',
          status: 'closed',
          quotaBytes: 12_345,
          createdAt: atPlus(1_000),
          startsAt: atPlus(2_000),
          closedAt: atPlus(3_000),
        }),
      )

      const stored = await repo.findById(asEventId('evt-1'))

      expect(stored?.ownerId).toBe(HOST)
      expect(stored?.name.value).toBe('Camille & Sacha')
      expect(stored?.slug.value).toBe('camille-et-sacha')
      expect(stored?.joinCode.value).toBe('H7K2QM')
      expect(stored?.status).toBe('closed')
      expect(stored?.quotaBytes).toBe(12_345)
      expect(stored?.createdAt.toISOString()).toBe(atPlus(1_000).toISOString())
      expect(stored?.startsAt?.toISOString()).toBe(atPlus(2_000).toISOString())
      expect(stored?.closedAt?.toISOString()).toBe(atPlus(3_000).toISOString())
    })

    it('round-trips every setting, so a host policy survives a restart', async () => {
      await repo.save(
        anEvent({
          id: 'evt-1',
          settings: {
            moderation: 'auto',
            allowCaptions: false,
            allowReactions: false,
            allowGuestSelfDelete: false,
            guestSelfDeleteGraceSeconds: 60,
            retentionDays: 30,
            maxPhotosPerGuest: 5,
          },
        }),
      )

      const stored = await repo.findById(asEventId('evt-1'))

      expect(stored?.settings.toProps()).toEqual({
        moderation: 'auto',
        allowCaptions: false,
        allowReactions: false,
        allowGuestSelfDelete: false,
        guestSelfDeleteGraceSeconds: 60,
        retentionDays: 30,
        maxPhotosPerGuest: 5,
      })
    })

    it('round-trips an unscheduled, never-closed event as two nulls', async () => {
      await repo.save(anEvent({ id: 'evt-1', status: 'draft' }))

      const stored = await repo.findById(asEventId('evt-1'))

      expect(stored?.startsAt).toBeNull()
      expect(stored?.closedAt).toBeNull()
    })

    it('replaces the stored row when the same event is saved again', async () => {
      await repo.save(anEvent({ id: 'evt-1', status: 'draft' }))

      await repo.save(anEvent({ id: 'evt-1', status: 'live', name: 'Camille et Sacha' }))

      const stored = await repo.findById(asEventId('evt-1'))
      expect(stored?.status).toBe('live')
      expect(stored?.name.value).toBe('Camille et Sacha')
    })

    // --------------------------------------------------------------- lookups --

    it('returns null for an event id that does not exist', async () => {
      expect(await repo.findById(asEventId('nope'))).toBeNull()
    })

    it('resolves an event by its slug', async () => {
      await repo.save(anEvent({ id: 'evt-1', slug: 'camille-et-sacha' }))

      expect((await repo.findBySlug(slug('camille-et-sacha')))?.id).toBe('evt-1')
    })

    it('returns null for a slug no event holds', async () => {
      expect(await repo.findBySlug(slug('personne-ici'))).toBeNull()
    })

    it('resolves an event by its join code', async () => {
      await repo.save(anEvent({ id: 'evt-1', joinCode: 'H7K2QM' }))

      expect((await repo.findByJoinCode(joinCode('H7K2QM')))?.id).toBe('evt-1')
    })

    it('returns null for a join code no event holds', async () => {
      expect(await repo.findByJoinCode(joinCode('ZZZZZZ'))).toBeNull()
    })

    it('resolves a join code a guest typed with confusable characters', async () => {
      // `JoinCode` folds I/L to 1 and O to 0 on the way in, so the stored code and a
      // mistyped one are the same value by the time they reach the repository.
      await repo.save(anEvent({ id: 'evt-1', joinCode: 'H7K20M' }))

      expect((await repo.findByJoinCode(joinCode('h7k2-Om')))?.id).toBe('evt-1')
    })

    // ------------------------------------------------------------ uniqueness --

    it('refuses a second event with a slug another event holds', async () => {
      await repo.save(anEvent({ id: 'evt-1', slug: 'camille-et-sacha', joinCode: 'H7K2QM' }))

      await expect(
        repo.save(anEvent({ id: 'evt-2', slug: 'camille-et-sacha', joinCode: 'ZZZZZZ' })),
      ).rejects.toThrow()
    })

    it('refuses a second event with a join code another event holds', async () => {
      await repo.save(anEvent({ id: 'evt-1', slug: 'camille-et-sacha', joinCode: 'H7K2QM' }))

      await expect(
        repo.save(anEvent({ id: 'evt-2', slug: 'gala-annuel', joinCode: 'H7K2QM' })),
      ).rejects.toThrow()
    })

    it('lets an event keep its own slug and join code across a save', async () => {
      const event = anEvent({ id: 'evt-1', slug: 'camille-et-sacha', joinCode: 'H7K2QM' })
      await repo.save(event)

      await expect(repo.save(event)).resolves.toBeUndefined()
    })

    it('frees the old join code once an event has rotated it', async () => {
      await repo.save(anEvent({ id: 'evt-1', joinCode: 'H7K2QM' }))

      await repo.save(anEvent({ id: 'evt-1', joinCode: 'ZZZZZZ' }))

      expect(await repo.joinCodeTaken(joinCode('H7K2QM'))).toBe(false)
    })

    it('reports a slug as taken', async () => {
      await repo.save(anEvent({ id: 'evt-1', slug: 'camille-et-sacha' }))

      expect(await repo.slugTaken(slug('camille-et-sacha'))).toBe(true)
    })

    it('reports an unused slug as free', async () => {
      expect(await repo.slugTaken(slug('camille-et-sacha'))).toBe(false)
    })

    it('reports a join code as taken', async () => {
      await repo.save(anEvent({ id: 'evt-1', joinCode: 'H7K2QM' }))

      expect(await repo.joinCodeTaken(joinCode('H7K2QM'))).toBe(true)
    })

    it('reports an unused join code as free', async () => {
      expect(await repo.joinCodeTaken(joinCode('H7K2QM'))).toBe(false)
    })

    // ------------------------------------------------------------- dashboard --

    it('lists the events a user owns, newest first', async () => {
      await repo.save(
        anEvent({
          id: 'evt-old',
          ownerId: HOST,
          slug: 'evt-old',
          joinCode: 'AAAAAA',
          createdAt: atPlus(0),
        }),
      )
      await repo.save(
        anEvent({
          id: 'evt-new',
          ownerId: HOST,
          slug: 'evt-new',
          joinCode: 'BBBBBB',
          createdAt: atPlus(1_000),
        }),
      )

      const summaries = await repo.listForUser(HOST)

      expect(summaries.map((summary) => summary.id)).toEqual(['evt-new', 'evt-old'])
    })

    it('breaks a dashboard tie by ascending id', async () => {
      await repo.save(
        anEvent({ id: 'evt-b', ownerId: HOST, slug: 'evt-b', joinCode: 'AAAAAA', createdAt: AT }),
      )
      await repo.save(
        anEvent({ id: 'evt-a', ownerId: HOST, slug: 'evt-a', joinCode: 'BBBBBB', createdAt: AT }),
      )

      const summaries = await repo.listForUser(HOST)

      expect(summaries.map((summary) => summary.id)).toEqual(['evt-a', 'evt-b'])
    })

    it('never lists an event belonging to another host', async () => {
      await repo.save(anEvent({ id: 'evt-1', ownerId: OTHER }))

      expect(await repo.listForUser(HOST)).toEqual([])
    })

    it('maps the dashboard row and reports zero counts for an event with no activity', async () => {
      await repo.save(
        anEvent({
          id: 'evt-1',
          ownerId: HOST,
          name: 'Gala annuel',
          slug: 'gala-annuel',
          status: 'live',
          createdAt: atPlus(1_000),
        }),
      )

      const summaries = await repo.listForUser(HOST)

      expect(summaries).toEqual([
        {
          id: 'evt-1',
          slug: 'gala-annuel',
          name: 'Gala annuel',
          status: 'live',
          photoCount: 0,
          pendingCount: 0,
          guestCount: 0,
          usedBytes: 0,
          createdAt: atPlus(1_000),
        },
      ])
    })

    // ---------------------------------------------------------------- delete --

    it('deletes an event', async () => {
      await repo.save(anEvent({ id: 'evt-1' }))

      await repo.delete(asEventId('evt-1'))

      expect(await repo.findById(asEventId('evt-1'))).toBeNull()
    })

    it('is idempotent on delete', async () => {
      await repo.save(anEvent({ id: 'evt-1' }))
      await repo.delete(asEventId('evt-1'))

      await expect(repo.delete(asEventId('evt-1'))).resolves.toBeUndefined()
    })

    it('frees the slug of a deleted event', async () => {
      await repo.save(anEvent({ id: 'evt-1', slug: 'camille-et-sacha' }))

      await repo.delete(asEventId('evt-1'))

      expect(await repo.slugTaken(slug('camille-et-sacha'))).toBe(false)
    })

    // ------------------------------------------------------------- retention --

    /** Closed one day after {@link AT}, keeping its album for the given number of days. */
    const closedEvent = (retentionDays: number | null) =>
      anEvent({
        id: 'evt-1',
        status: 'closed',
        createdAt: AT,
        closedAt: atPlus(DAY),
        settings: { retentionDays },
      })

    it('lists a closed event whose retention deadline has passed', async () => {
      await repo.save(closedEvent(1))

      const due = await repo.listDueForPurge(atPlus(DAY * 3))

      expect(due.map((event) => event.id)).toEqual(['evt-1'])
    })

    it('excludes a closed event whose deadline is still ahead', async () => {
      await repo.save(closedEvent(30))

      expect(await repo.listDueForPurge(atPlus(DAY * 3))).toEqual([])
    })

    it('excludes an event the host asked to keep forever', async () => {
      await repo.save(closedEvent(null))

      expect(await repo.listDueForPurge(atPlus(DAY * 3_650))).toEqual([])
    })

    it('excludes a live event, however old, because the clock starts at closing', async () => {
      await repo.save(anEvent({ id: 'evt-1', status: 'live', settings: { retentionDays: 1 } }))

      expect(await repo.listDueForPurge(atPlus(DAY * 3_650))).toEqual([])
    })
  })
}
