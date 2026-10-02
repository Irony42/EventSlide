import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ClientCeilings, type ClientCeilingsProps } from '../../../domain/clients/clientCeilings'
import { purgeDeadline } from '../../../domain/clients/purgeDeadline'
import type { Event } from '../../../domain/events/event'
import { asClientId, asEventId, asUserId } from '../../../domain/shared/ids'
import { JoinCode } from '../../../domain/shared/joinCode'
import { Slug } from '../../../domain/shared/slug'
import type { ClientRepository } from '../../ports/clientRepository'
import type { EventRepository, PurgePolicy } from '../../ports/eventRepository'
import type { MembershipRepository } from '../../ports/userRepository'
import { EVENT_STATUSES } from '../../../domain/events/eventStatus'
import { AT, aClient, aClientCeilings, anEvent, atPlus } from '../builders'

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

/**
 * The notice a lowered retention ceiling is owed, as the policy the purge is given. Thirty
 * days is the configured default (`RETENTION_CAP_NOTICE_DAYS`), and the cases below are
 * written in those days.
 */
export const PURGE_POLICY: PurgePolicy = { capNoticeDays: 30 }

const HOST = asUserId('user-host')
const OTHER = asUserId('user-other')
const DAY = 86_400_000

const CLIENT = asClientId('client-1')
const OTHER_CLIENT = asClientId('client-2')

/**
 * Join codes that are valid and distinct, for the cases that create several events in one
 * test. A slug is derived from the same index, so the pair is always unique.
 */
const JOIN_CODES = ['AAAAAA', 'BBBBBB', 'CCCCCC', 'DDDDDD'] as const

/** The nth event of a test, optionally attached to a client. */
const nthEvent = (n: number, clientId: string | null = null): Event =>
  anEvent({
    id: `evt-${n}`,
    slug: `evt-${n}`,
    joinCode: JOIN_CODES[n - 1] ?? 'ZZZZZZ',
    ownerId: HOST,
    clientId,
  })

/**
 * What a subject is built from: the repository under test, plus the two neighbours its
 * `createWithOwner` writes to in the same step. They are the **same storage** the
 * repository uses (one database, or one linked world of fakes) — that is the whole point
 * of the method — so the contract can read back what it did to them.
 */
export interface EventRepositorySubject {
  readonly repo: EventRepository
  readonly memberships: MembershipRepository
  readonly clients: ClientRepository
  readonly dispose?: () => Promise<void>
}

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
  makeSubject: () => Promise<EventRepositorySubject>,
): void => {
  describe(`EventRepository contract: ${name}`, () => {
    let repo: EventRepository
    let memberships: MembershipRepository
    let clients: ClientRepository
    let dispose: (() => Promise<void>) | undefined

    beforeEach(async () => {
      const subject = await makeSubject()
      repo = subject.repo
      memberships = subject.memberships
      clients = subject.clients
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
          openedAt: atPlus(2_500),
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
      expect(stored?.openedAt?.toISOString()).toBe(atPlus(2_500).toISOString())
    })

    it('round-trips every setting, so a host policy survives a restart', async () => {
      await repo.save(
        anEvent({
          id: 'evt-1',
          settings: {
            moderation: 'auto',
            allowCaptions: false,
            allowReactions: false,
            allowClips: false,
            allowGuestSelfDelete: false,
            guestSelfDeleteGraceSeconds: 60,
            retentionDays: 30,
            maxPhotosPerGuest: 5,
            // A theme in which **every** field is off its default, so a store that dropped
            // one would fail here rather than quietly agreeing with it. `material: 'plain'`
            // is load-bearing for exactly that reason: `glass` is both the default and what
            // the SQLite adapter fills in for an absent key, so a store that never wrote
            // the field would have round-tripped clean.
            theme: { accentHue: 345, fonts: 'serif', frame: 'round', material: 'plain' },
            // Off the default for the same reason `material: 'plain'` is: `fr` is both the
            // domain's default and what the SQLite adapter fills in for an absent key, so
            // a store that never wrote this field would have round-tripped clean.
            wallLanguage: 'de',
          },
        }),
      )

      const stored = await repo.findById(asEventId('evt-1'))

      expect(stored?.settings.toProps()).toEqual({
        moderation: 'auto',
        allowCaptions: false,
        allowReactions: false,
        allowClips: false,
        allowGuestSelfDelete: false,
        guestSelfDeleteGraceSeconds: 60,
        retentionDays: 30,
        maxPhotosPerGuest: 5,
        theme: { accentHue: 345, fonts: 'serif', frame: 'round', material: 'plain' },
        wallLanguage: 'de',
      })
    })

    it('round-trips an unscheduled, never-closed event as two nulls', async () => {
      await repo.save(anEvent({ id: 'evt-1', status: 'draft' }))

      const stored = await repo.findById(asEventId('evt-1'))

      expect(stored?.startsAt).toBeNull()
      expect(stored?.closedAt).toBeNull()
      expect(stored?.openedAt).toBeNull()
    })

    it('stores opened_at when a saved event goes live and keeps it through a close and a reopening', async () => {
      await repo.save(anEvent({ id: 'evt-1', status: 'draft' }))
      const draft = await repo.findById(asEventId('evt-1'))
      if (draft === null) throw new Error('the event was just saved')

      const live = draft.goLive(atPlus(DAY))
      if (!live.ok) throw new Error(live.error.code)
      await repo.save(live.value)
      const closed = live.value.close(atPlus(2 * DAY))
      if (!closed.ok) throw new Error(closed.error.code)
      await repo.save(closed.value)
      const reopened = closed.value.goLive(atPlus(3 * DAY))
      if (!reopened.ok) throw new Error(reopened.error.code)
      await repo.save(reopened.value)

      const stored = await repo.findById(asEventId('evt-1'))
      expect(stored?.openedAt?.toISOString()).toBe(atPlus(DAY).toISOString())
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

    // ----------------------------------------------------------------- client --

    it('round-trips the client an event belongs to', async () => {
      await clients.save(aClient({ id: CLIENT }))
      await repo.save(nthEvent(1, CLIENT))

      const stored = await repo.findById(asEventId('evt-1'))

      expect(stored?.clientId).toBe(CLIENT)
    })

    it('round-trips an event with no client as null, which is every event on a solo box', async () => {
      await repo.save(nthEvent(1))

      expect((await repo.findById(asEventId('evt-1')))?.clientId).toBeNull()
    })

    it('refuses to save an event that names a client that does not exist', async () => {
      await expect(repo.save(nthEvent(1, 'client-that-never-was'))).rejects.toThrow()

      expect(await repo.findById(asEventId('evt-1'))).toBeNull()
    })

    it('never moves an event to another client by saving it, because a handover is not a save', async () => {
      await clients.save(aClient({ id: CLIENT }))
      await clients.save(aClient({ id: OTHER_CLIENT, name: 'Un autre client' }))
      await repo.save(nthEvent(1, CLIENT))

      // A stale copy of the entity, written back after the event changed hands elsewhere,
      // must not undo the handover: `save` is last-write-wins over the whole row and this
      // is the one column that has an owner of its own.
      await repo.save(nthEvent(1, OTHER_CLIENT))

      expect((await repo.findById(asEventId('evt-1')))?.clientId).toBe(CLIENT)
    })

    // ------------------------------------------------------- createWithOwner --

    describe('createWithOwner', () => {
      const owner = { userId: HOST, grantedAt: atPlus(5_000) }

      const create = (event: Event, ceilings: ClientCeilings = ClientCeilings.unlimited()) =>
        repo.createWithOwner(event, owner, ceilings)

      const periodCount = async (): Promise<number | undefined> =>
        (await clients.findById(CLIENT))?.eventsCreatedInPeriod

      it('stores the event and makes its creator the owner, in one call', async () => {
        const result = await create(nthEvent(1))

        expect(result.ok).toBe(true)
        expect((await repo.findById(asEventId('evt-1')))?.slug.value).toBe('evt-1')
        expect(await memberships.roleFor(asEventId('evt-1'), HOST)).toBe('owner')
      })

      it('records when the creator was made owner', async () => {
        await create(nthEvent(1))

        const membership = await memberships.membershipFor(asEventId('evt-1'), HOST)

        expect(membership?.grantedAt).toEqual(atPlus(5_000))
      })

      it('stores the client the event belongs to', async () => {
        await clients.save(aClient({ id: CLIENT }))

        await create(nthEvent(1, CLIENT))

        expect((await repo.findById(asEventId('evt-1')))?.clientId).toBe(CLIENT)
      })

      it('counts the event against its client’s period', async () => {
        await clients.save(aClient({ id: CLIENT }))

        await create(nthEvent(1, CLIENT))
        await create(nthEvent(2, CLIENT))

        expect(await periodCount()).toBe(2)
      })

      it('counts nothing for an event with no client, and touches no client’s counter', async () => {
        await clients.save(aClient({ id: CLIENT }))

        const result = await create(nthEvent(1))

        expect(result.ok).toBe(true)
        expect(await periodCount()).toBe(0)
      })

      it('refuses an event past the client’s total ceiling, naming what was reached', async () => {
        const ceilings = aClientCeilings({ maxEvents: 1 })
        await clients.save(aClient({ id: CLIENT, ceilings }))
        await create(nthEvent(1, CLIENT), ceilings)

        const result = await create(nthEvent(2, CLIENT), ceilings)

        expect(!result.ok && result.error.code).toBe('client.ceilingReached')
        expect(!result.ok && result.error.kind).toBe('conflict')
        expect(!result.ok && result.error.details).toEqual({
          ceiling: 'events',
          used: 1,
          max: 1,
        })
      })

      it('leaves nothing behind when a ceiling refuses: no event, no owner, no count', async () => {
        const ceilings = aClientCeilings({ maxEvents: 1 })
        await clients.save(aClient({ id: CLIENT, ceilings }))
        await create(nthEvent(1, CLIENT), ceilings)

        await create(nthEvent(2, CLIENT), ceilings)

        expect(await repo.findById(asEventId('evt-2'))).toBeNull()
        expect(await memberships.roleFor(asEventId('evt-2'), HOST)).toBeNull()
        expect(await periodCount()).toBe(1)
      })

      it.each(EVENT_STATUSES)(
        'counts an event that is %s toward the total ceiling',
        async (status) => {
          // Every status, because a finished or archived wedding still holds its
          // photographs, and a draft is the status every event is created in: filtering any
          // of them out lets a client keep more than it was given.
          const ceilings = aClientCeilings({ maxEvents: 1 })
          await clients.save(aClient({ id: CLIENT, ceilings }))
          await repo.save(
            anEvent({
              id: 'evt-1',
              slug: 'evt-1',
              joinCode: 'AAAAAA',
              ownerId: HOST,
              clientId: CLIENT,
              status,
            }),
          )

          const result = await create(nthEvent(2, CLIENT), ceilings)

          expect(!result.ok && result.error.details).toMatchObject({ ceiling: 'events' })
        },
      )

      it('does not count another client’s events toward this client’s total ceiling', async () => {
        const ceilings = aClientCeilings({ maxEvents: 1 })
        await clients.save(aClient({ id: CLIENT, ceilings }))
        await clients.save(aClient({ id: OTHER_CLIENT, name: 'Un autre client' }))
        await repo.save(nthEvent(1, OTHER_CLIENT))

        const result = await create(nthEvent(2, CLIENT), ceilings)

        expect(result.ok).toBe(true)
      })

      it('does not count a client-less event toward any client’s total ceiling', async () => {
        const ceilings = aClientCeilings({ maxEvents: 1 })
        await clients.save(aClient({ id: CLIENT, ceilings }))
        await repo.save(nthEvent(1))

        const result = await create(nthEvent(2, CLIENT), ceilings)

        expect(result.ok).toBe(true)
      })

      it('refuses an event past the per-period ceiling, naming it', async () => {
        const ceilings = aClientCeilings({ maxEventsPerPeriod: 2 })
        await clients.save(aClient({ id: CLIENT, ceilings, eventsCreatedInPeriod: 2 }))

        const result = await create(nthEvent(1, CLIENT), ceilings)

        expect(!result.ok && result.error.details).toEqual({
          ceiling: 'eventsPerPeriod',
          used: 2,
          max: 2,
        })
      })

      it('admits the event that reaches the ceiling and refuses the one after it', async () => {
        const ceilings = aClientCeilings({ maxEventsPerPeriod: 2 })
        await clients.save(aClient({ id: CLIENT, ceilings, eventsCreatedInPeriod: 1 }))

        const atTheLimit = await create(nthEvent(1, CLIENT), ceilings)
        const pastIt = await create(nthEvent(2, CLIENT), ceilings)

        expect(atTheLimit.ok).toBe(true)
        expect(pastIt.ok).toBe(false)
      })

      it('refuses create, delete, recreate under max_events_per_period=1', async () => {
        // The point of a counter that is not a count of rows. Counting the client's
        // events would let it create one, delete it and create the next, forever, and a
        // permanent public wall is exactly what that ceiling exists to stop.
        const ceilings = aClientCeilings({ maxEventsPerPeriod: 1 })
        await clients.save(aClient({ id: CLIENT, ceilings }))

        const first = await create(nthEvent(1, CLIENT), ceilings)
        await repo.delete(asEventId('evt-1'))
        const again = await create(nthEvent(2, CLIENT), ceilings)

        expect(first.ok).toBe(true)
        expect(!again.ok && again.error.code).toBe('client.ceilingReached')
        expect(!again.ok && again.error.details).toMatchObject({ ceiling: 'eventsPerPeriod' })
      })

      it('never decrements the period counter when an event is deleted', async () => {
        await clients.save(aClient({ id: CLIENT }))
        await create(nthEvent(1, CLIENT))
        await create(nthEvent(2, CLIENT))

        await repo.delete(asEventId('evt-1'))

        expect(await periodCount()).toBe(2)
      })

      it('frees a slot of the total ceiling when an event is deleted, unlike the per-period one', async () => {
        // The two ceilings answer different questions — events the client has now, events
        // it has created this period — and conflating them in either direction is a bug.
        const ceilings = aClientCeilings({ maxEvents: 1 })
        await clients.save(aClient({ id: CLIENT, ceilings }))
        await create(nthEvent(1, CLIENT), ceilings)
        await repo.delete(asEventId('evt-1'))

        const again = await create(nthEvent(2, CLIENT), ceilings)

        expect(again.ok).toBe(true)
      })

      it('ignores every ceiling for an event with no client', async () => {
        const result = await create(nthEvent(1), aClientCeilings({ maxEvents: 1 }))
        const second = await create(nthEvent(2), aClientCeilings({ maxEvents: 1 }))

        expect(result.ok && second.ok).toBe(true)
      })

      it('refuses a slug another event holds, and leaves no owner and no count behind', async () => {
        await clients.save(aClient({ id: CLIENT }))
        await create(nthEvent(1, CLIENT))
        const clash = anEvent({
          id: 'evt-2',
          slug: 'evt-1',
          joinCode: 'BBBBBB',
          ownerId: HOST,
          clientId: CLIENT,
        })

        await expect(create(clash)).rejects.toThrow()

        expect(await repo.findById(asEventId('evt-2'))).toBeNull()
        expect(await memberships.roleFor(asEventId('evt-2'), HOST)).toBeNull()
        expect(await periodCount()).toBe(1)
      })

      it('refuses a join code another event holds, and leaves no owner and no count behind', async () => {
        await clients.save(aClient({ id: CLIENT }))
        await create(nthEvent(1, CLIENT))
        const clash = anEvent({
          id: 'evt-2',
          slug: 'evt-2',
          joinCode: 'AAAAAA',
          ownerId: HOST,
          clientId: CLIENT,
        })

        await expect(create(clash)).rejects.toThrow()

        expect(await memberships.roleFor(asEventId('evt-2'), HOST)).toBeNull()
        expect(await periodCount()).toBe(1)
      })

      it('refuses an id that is already taken rather than overwriting the event', async () => {
        await create(nthEvent(1))

        await expect(
          create(anEvent({ id: 'evt-1', slug: 'another', joinCode: 'BBBBBB', ownerId: HOST })),
        ).rejects.toThrow()

        expect((await repo.findById(asEventId('evt-1')))?.slug.value).toBe('evt-1')
      })

      it('lets only one of two creations at the same moment pass a total ceiling of one', async () => {
        // The race the transaction exists to remove: two requests that both read a count
        // under the ceiling and both write. Started together, not one after the other.
        const ceilings = aClientCeilings({ maxEvents: 1 })
        await clients.save(aClient({ id: CLIENT, ceilings }))

        const outcomes = await Promise.all([
          create(nthEvent(1, CLIENT), ceilings),
          create(nthEvent(2, CLIENT), ceilings),
        ])

        expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1)
        expect(await periodCount()).toBe(1)
      })

      it('lets only one of two creations at the same moment pass a per-period ceiling of one', async () => {
        const ceilings = aClientCeilings({ maxEventsPerPeriod: 1 })
        await clients.save(aClient({ id: CLIENT, ceilings }))

        const outcomes = await Promise.all([
          create(nthEvent(1, CLIENT), ceilings),
          create(nthEvent(2, CLIENT), ceilings),
        ])

        expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1)
        expect(await periodCount()).toBe(1)
      })

      it('refuses an owner who is not an account, and leaves nothing behind', async () => {
        await clients.save(aClient({ id: CLIENT }))

        await expect(
          repo.createWithOwner(
            nthEvent(1, CLIENT),
            { userId: asUserId('ghost'), grantedAt: AT },
            ClientCeilings.unlimited(),
          ),
        ).rejects.toThrow()

        expect(await repo.findById(asEventId('evt-1'))).toBeNull()
        expect(await periodCount()).toBe(0)
      })

      it('keeps the counter a creation wrote when a stale copy of the client is saved', async () => {
        // A Client read before two creations and saved after them (rename it, change a
        // ceiling) carries the old count. The counter is moved by createWithOwner and by
        // nothing else, so writing it back would hand both slots over.
        await clients.save(aClient({ id: CLIENT }))
        const stale = await clients.findById(CLIENT)
        await create(nthEvent(1, CLIENT))
        await create(nthEvent(2, CLIENT))

        if (stale === null) throw new Error('the client was just saved')
        await clients.save(stale)

        expect(await periodCount()).toBe(2)
      })

      it('does reset the counter when the client is renewed, which is what a new period is', async () => {
        await clients.save(aClient({ id: CLIENT }))
        await create(nthEvent(1, CLIENT))
        const before = await clients.findById(CLIENT)
        if (before === null) throw new Error('the client was just saved')

        // `withCeilings` pairs a changed period start with a zeroed counter.
        await clients.save(
          before.withCeilings(
            aClientCeilings({ maxEventsPerPeriod: 1, periodStartedAt: atPlus(DAY) }),
            atPlus(DAY),
          ),
        )

        expect(await periodCount()).toBe(0)
      })

      it('refuses a client that does not exist, and leaves no owner behind', async () => {
        await expect(create(nthEvent(1, 'client-that-never-was'))).rejects.toThrow()

        expect(await repo.findById(asEventId('evt-1'))).toBeNull()
        expect(await memberships.roleFor(asEventId('evt-1'), HOST)).toBeNull()
      })
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

      const due = await repo.listDueForPurge(atPlus(DAY * 3), PURGE_POLICY)

      expect(due.map((event) => event.id)).toEqual(['evt-1'])
    })

    it('excludes a closed event whose deadline is still ahead', async () => {
      await repo.save(closedEvent(30))

      expect(await repo.listDueForPurge(atPlus(DAY * 3), PURGE_POLICY)).toEqual([])
    })

    it('excludes an event the host asked to keep forever', async () => {
      await repo.save(closedEvent(null))

      expect(await repo.listDueForPurge(atPlus(DAY * 3_650), PURGE_POLICY)).toEqual([])
    })

    it('excludes a live event, however old, because the clock starts at closing', async () => {
      await repo.save(anEvent({ id: 'evt-1', status: 'live', settings: { retentionDays: 1 } }))

      expect(await repo.listDueForPurge(atPlus(DAY * 3_650), PURGE_POLICY)).toEqual([])
    })

    // ------------------------------------------ retention under a client ceiling --

    /**
     * What `listDueForPurge` does for an event that belongs to a client (roadmap §10.5 /
     * P3-06's "contrat purge").
     *
     * The rule is `purgeDeadline` in the domain; the adapter computes it again in SQL, so
     * the table at the bottom of this block runs every scenario through **both** and
     * requires the repository to list the event exactly from the instant the function names.
     * That equality, not any single case above it, is what keeps two spellings one rule.
     */
    describe('listDueForPurge under a client ceiling', () => {
      const NOON = new Date('2026-09-01T12:00:00.000Z')
      const at = (days: number, ms = 0): Date => new Date(NOON.getTime() + days * DAY + ms)

      interface Scenario {
        readonly name: string
        readonly event: {
          readonly status?: 'closed' | 'archived'
          readonly closedAt: Date
          readonly openedAt?: Date | null
          readonly retentionDays: number | null
        }
        readonly client: {
          readonly ceilings?: Partial<ClientCeilingsProps>
          readonly retentionCapSince?: Date | null
          readonly purgeAfter?: Date | null
        } | null
      }

      const seed = async (scenario: Scenario): Promise<Event> => {
        if (scenario.client !== null) {
          await clients.save(
            aClient({
              id: CLIENT,
              ceilings: scenario.client.ceilings ?? {},
              retentionCapSince: scenario.client.retentionCapSince ?? null,
              purgeAfter: scenario.client.purgeAfter ?? null,
            }),
          )
        }
        const event = anEvent({
          id: 'evt-1',
          slug: 'evt-1',
          joinCode: 'AAAAAA',
          ownerId: HOST,
          status: scenario.event.status ?? 'closed',
          createdAt: at(-400),
          openedAt: scenario.event.openedAt ?? null,
          closedAt: scenario.event.closedAt,
          settings: { retentionDays: scenario.event.retentionDays },
          clientId: scenario.client === null ? null : CLIENT,
        })
        await repo.save(event)
        return event
      }

      const dueIds = async (now: Date): Promise<readonly string[]> =>
        (await repo.listDueForPurge(now, PURGE_POLICY)).map((event) => event.id)

      it('purges an event kept for ever once closed_at + max_retention_days has passed, which is the NULL trap closed', async () => {
        await seed({
          name: 'forever under a ceiling',
          event: { closedAt: at(-10), retentionDays: null },
          client: { ceilings: { maxRetentionDays: 30 } },
        })

        expect(await dueIds(at(20, -1))).toEqual([])
        expect(await dueIds(at(20))).toEqual(['evt-1'])
      })

      it('still never purges an event kept for ever under a client with no retention ceiling', async () => {
        await seed({
          name: 'forever, no ceiling',
          event: { closedAt: at(-10), retentionDays: null },
          client: { ceilings: { maxLiveDays: 3 } },
        })

        expect(await dueIds(at(36_500))).toEqual([])
      })

      it('purges at the earlier of the host’s retention and the ceiling', async () => {
        await seed({
          name: 'host shorter',
          event: { closedAt: at(-10), retentionDays: 7 },
          client: { ceilings: { maxRetentionDays: 30 } },
        })

        expect(await dueIds(at(-3, -1))).toEqual([])
        expect(await dueIds(at(-3))).toEqual(['evt-1'])
      })

      it('purges an event closed 60 days ago only in 30 days, under a ceiling set today to 30', async () => {
        await seed({
          name: 'lowered to 30',
          event: { closedAt: at(-60), retentionDays: null },
          client: { ceilings: { maxRetentionDays: 30 }, retentionCapSince: NOON },
        })

        expect(await dueIds(NOON)).toEqual([])
        expect(await dueIds(at(30, -1))).toEqual([])
        expect(await dueIds(at(30))).toEqual(['evt-1'])
      })

      it('purges it in 30 days under a ceiling set today to 14 as well, because the notice is not the ceiling', async () => {
        await seed({
          name: 'lowered to 14',
          event: { closedAt: at(-60), retentionDays: null },
          client: { ceilings: { maxRetentionDays: 14 }, retentionCapSince: NOON },
        })

        expect(await dueIds(at(14))).toEqual([])
        expect(await dueIds(at(30, -1))).toEqual([])
        expect(await dueIds(at(30))).toEqual(['evt-1'])
      })

      it('does not push the purge back when an event was reopened: it is due at opened_at + max_live_days + max_retention_days', async () => {
        // Opened on day -40, closed for good on day -20 — past its window, as an event
        // reopened and closed again late would be. closed_at + 30 would only say day 10.
        await seed({
          name: 'reopened',
          event: { openedAt: at(-40), closedAt: at(-20), retentionDays: null },
          client: { ceilings: { maxRetentionDays: 30, maxLiveDays: 3 } },
        })

        expect(await dueIds(at(-7, -1))).toEqual([])
        expect(await dueIds(at(-7))).toEqual(['evt-1'])
      })

      it('purges at purge_after when an offboarded client has set one earlier than the retention', async () => {
        await seed({
          name: 'offboarded',
          event: { closedAt: at(-1), retentionDays: null },
          client: { purgeAfter: at(5) },
        })

        expect(await dueIds(at(5, -1))).toEqual([])
        expect(await dueIds(at(5))).toEqual(['evt-1'])
      })

      it('lets another client’s ceiling bring nothing forward', async () => {
        await clients.save(aClient({ id: OTHER_CLIENT, ceilings: { maxRetentionDays: 1 } }))
        await seed({
          name: 'neighbour',
          event: { closedAt: at(-10), retentionDays: null },
          client: { ceilings: { maxRetentionDays: 3_650 } },
        })

        expect(await dueIds(at(30))).toEqual([])
      })

      it('lists a client’s archived event as well as its closed one', async () => {
        await seed({
          name: 'archived',
          event: { status: 'archived', closedAt: at(-10), retentionDays: null },
          client: { ceilings: { maxRetentionDays: 30 } },
        })

        expect(await dueIds(at(20))).toEqual(['evt-1'])
      })

      it('never lists a live event of a client, however old it is, because the clock starts at closing', async () => {
        await clients.save(aClient({ id: CLIENT, ceilings: { maxRetentionDays: 1 } }))
        await repo.save(
          anEvent({
            id: 'evt-1',
            slug: 'evt-1',
            joinCode: 'AAAAAA',
            status: 'live',
            openedAt: at(-400),
            clientId: CLIENT,
            settings: { retentionDays: null },
          }),
        )

        expect(await dueIds(at(36_500))).toEqual([])
      })

      it('counts the notice in the days the policy gives, not a constant', async () => {
        await seed({
          name: 'notice',
          event: { closedAt: at(-60), retentionDays: null },
          client: { ceilings: { maxRetentionDays: 14 }, retentionCapSince: NOON },
        })

        expect((await repo.listDueForPurge(at(44), { capNoticeDays: 45 })).length).toBe(0)
        expect((await repo.listDueForPurge(at(45), { capNoticeDays: 45 })).length).toBe(1)
      })

      /**
       * The same rule, twice: every scenario is listed from exactly the instant
       * `purgeDeadline` names, and not a millisecond before; and one the function says is
       * never due is not listed at the end of the century.
       */
      describe('agrees with purgeDeadline, to the millisecond', () => {
        const SCENARIOS: readonly Scenario[] = [
          {
            name: 'no client, host retention 30',
            event: { closedAt: at(-10), retentionDays: 30 },
            client: null,
          },
          {
            name: 'no client, kept for ever',
            event: { closedAt: at(-10), retentionDays: null },
            client: null,
          },
          {
            name: 'client without ceilings, host retention 30',
            event: { closedAt: at(-10), retentionDays: 30 },
            client: {},
          },
          {
            name: 'ceiling 30, kept for ever',
            event: { closedAt: at(-10), retentionDays: null },
            client: { ceilings: { maxRetentionDays: 30 } },
          },
          {
            name: 'ceiling 30, host retention 90',
            event: { closedAt: at(-10), retentionDays: 90 },
            client: { ceilings: { maxRetentionDays: 30 } },
          },
          {
            name: 'ceiling 30, host retention 7',
            event: { closedAt: at(-10), retentionDays: 7 },
            client: { ceilings: { maxRetentionDays: 30 } },
          },
          {
            name: 'ceiling lowered to 14 today, closed 60 days ago',
            event: { closedAt: at(-60), retentionDays: null },
            client: { ceilings: { maxRetentionDays: 14 }, retentionCapSince: NOON },
          },
          {
            name: 'ceiling lowered to 30 ten days ago, closed today',
            event: { closedAt: NOON, retentionDays: null },
            client: { ceilings: { maxRetentionDays: 60 }, retentionCapSince: at(-10) },
          },
          {
            name: 'host retention shorter than the notice',
            event: { closedAt: at(-5), retentionDays: 7 },
            client: { ceilings: { maxRetentionDays: 14 }, retentionCapSince: NOON },
          },
          {
            name: 'live window bound binds',
            event: { openedAt: at(-40), closedAt: at(-20), retentionDays: null },
            client: { ceilings: { maxRetentionDays: 30, maxLiveDays: 3 } },
          },
          {
            name: 'live window bound does not bind',
            event: { openedAt: at(-5), closedAt: at(-4), retentionDays: null },
            client: { ceilings: { maxRetentionDays: 30, maxLiveDays: 3 } },
          },
          {
            name: 'live window bound behind a notice',
            event: { openedAt: at(-40), closedAt: at(-20), retentionDays: null },
            client: {
              ceilings: { maxRetentionDays: 30, maxLiveDays: 3 },
              retentionCapSince: NOON,
            },
          },
          {
            name: 'archived without ever opening, live window set',
            event: { status: 'archived', closedAt: at(-20), retentionDays: null },
            client: { ceilings: { maxRetentionDays: 30, maxLiveDays: 3 } },
          },
          {
            name: 'live window without a retention ceiling',
            event: { openedAt: at(-40), closedAt: at(-20), retentionDays: null },
            client: { ceilings: { maxLiveDays: 3 } },
          },
          {
            name: 'offboarded, purge_after before the retention',
            event: { closedAt: at(-1), retentionDays: null },
            client: { purgeAfter: at(5) },
          },
          {
            name: 'offboarded, retention before purge_after',
            event: { closedAt: at(-10), retentionDays: 15 },
            client: { purgeAfter: at(60) },
          },
        ]

        it.each(SCENARIOS)('$name', async (scenario) => {
          const event = await seed(scenario)
          const client = scenario.client === null ? null : await clients.findById(CLIENT)
          const deadline = purgeDeadline(event, client, PURGE_POLICY.capNoticeDays)

          if (deadline === null) {
            expect(await dueIds(at(36_500))).toEqual([])
            return
          }
          expect(await dueIds(new Date(deadline.getTime() - 1))).toEqual([])
          expect(await dueIds(deadline)).toEqual(['evt-1'])
        })
      })
    })

    // -------------------------------------------------------------- scheduling --

    it('round-trips a scheduled opening and closing', async () => {
      await repo.save(
        anEvent({
          id: 'evt-1',
          status: 'draft',
          scheduledOpenAt: atPlus(DAY),
          scheduledCloseAt: atPlus(DAY * 2),
        }),
      )

      const stored = await repo.findById(asEventId('evt-1'))

      expect(stored?.scheduledOpenAt?.toISOString()).toBe(atPlus(DAY).toISOString())
      expect(stored?.scheduledCloseAt?.toISOString()).toBe(atPlus(DAY * 2).toISOString())
    })

    it('round-trips an unscheduled event as three nulls', async () => {
      await repo.save(anEvent({ id: 'evt-1' }))

      const stored = await repo.findById(asEventId('evt-1'))

      expect(stored?.scheduledOpenAt).toBeNull()
      expect(stored?.scheduledCloseAt).toBeNull()
      expect(stored?.scheduleDiscardedAt).toBeNull()
    })

    it('round-trips the notice that a schedule was thrown away', async () => {
      // It survives a restart or it is not a notice: the sweep that discarded the
      // instant ran while nobody was looking, and the host reads this hours later.
      await repo.save(anEvent({ id: 'evt-1', scheduleDiscardedAt: atPlus(DAY) }))

      const stored = await repo.findById(asEventId('evt-1'))

      expect(stored?.scheduleDiscardedAt?.toISOString()).toBe(atPlus(DAY).toISOString())
    })

    it('lists an event whose opening instant has passed', async () => {
      await repo.save(anEvent({ id: 'evt-1', status: 'draft', scheduledOpenAt: atPlus(DAY) }))

      const due = await repo.listDueForSchedule(atPlus(DAY))

      expect(due.map((event) => event.id)).toEqual(['evt-1'])
    })

    it('lists an event whose opening was missed hours ago, not only one due this minute', async () => {
      await repo.save(anEvent({ id: 'evt-1', status: 'draft', scheduledOpenAt: atPlus(DAY) }))

      const due = await repo.listDueForSchedule(atPlus(DAY * 3))

      expect(due.map((event) => event.id)).toEqual(['evt-1'])
    })

    it('lists an event whose closing instant has passed', async () => {
      await repo.save(anEvent({ id: 'evt-1', status: 'live', scheduledCloseAt: atPlus(DAY) }))

      const due = await repo.listDueForSchedule(atPlus(DAY * 2))

      expect(due.map((event) => event.id)).toEqual(['evt-1'])
    })

    it('excludes an event whose instants are both still ahead', async () => {
      await repo.save(
        anEvent({
          id: 'evt-1',
          status: 'draft',
          scheduledOpenAt: atPlus(DAY),
          scheduledCloseAt: atPlus(DAY * 2),
        }),
      )

      expect(await repo.listDueForSchedule(AT)).toEqual([])
    })

    it('excludes an event with no schedule at all', async () => {
      await repo.save(anEvent({ id: 'evt-1', status: 'draft' }))

      expect(await repo.listDueForSchedule(atPlus(DAY * 3_650))).toEqual([])
    })
  })
}
