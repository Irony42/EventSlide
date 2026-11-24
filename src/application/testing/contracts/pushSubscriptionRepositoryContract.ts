import { beforeEach, describe, expect, it } from 'vitest'
import { PushSubscription } from '../../../domain/push/pushSubscription'
import { asEventId, asUserId } from '../../../domain/shared/ids'
import type { PushSubscriptionRepository } from '../../ports/pushSubscriptionRepository'

/**
 * The behaviour every `PushSubscriptionRepository` must have, run against the fake **and** SQLite:
 * an upsert on (endpoint, event, account), a cap per account and event decided in the write, a
 * removal that names the account, a removal by id that names the event, and a listing scoped to
 * the event.
 */

/** Rows the SQLite harness must create before the contract runs; the fake ignores them. */
export const PUSH_CONTRACT_FIXTURES = {
  eventIds: ['evt-wedding', 'evt-gala'],
  userIds: ['user-one', 'user-two'],
} as const

export interface PushSubscriptionRepositorySubject {
  readonly repo: PushSubscriptionRepository
  readonly dispose?: () => Promise<void>
}

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')
const ONE = asUserId('user-one')
const TWO = asUserId('user-two')
const T0 = new Date('2026-11-23T10:00:00.000Z')
const T1 = new Date('2026-11-23T11:00:00.000Z')
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/aaa'

const sub = (
  overrides: Partial<{
    id: string
    event: typeof WEDDING
    user: typeof ONE
    endpoint: string
    p256dh: string
    auth: string
    createdAt: Date
  }> = {},
): PushSubscription =>
  PushSubscription.create({
    id: overrides.id ?? 's-1',
    eventId: overrides.event ?? WEDDING,
    userId: overrides.user ?? ONE,
    endpoint: overrides.endpoint ?? ENDPOINT,
    p256dh: overrides.p256dh ?? 'key-1',
    auth: overrides.auth ?? 'auth-1',
    createdAt: overrides.createdAt ?? T0,
  })

export const pushSubscriptionRepositoryContract = (
  name: string,
  makeSubject: () => Promise<PushSubscriptionRepositorySubject>,
): void => {
  describe(`PushSubscriptionRepository contract: ${name}`, () => {
    let subject: PushSubscriptionRepositorySubject
    let repo: PushSubscriptionRepository

    beforeEach(async () => {
      if (subject?.dispose !== undefined) await subject.dispose()
      subject = await makeSubject()
      repo = subject.repo
    })

    it('stores a subscription and lists it with its keys', async () => {
      expect(await repo.upsert(sub(), 10)).toBe('added')

      const [listed] = await repo.listByEvent(WEDDING)
      expect([listed?.id, listed?.endpoint, listed?.p256dh, listed?.auth, listed?.userId]).toEqual([
        's-1',
        ENDPOINT,
        'key-1',
        'auth-1',
        ONE,
      ])
      expect(listed?.createdAt).toEqual(T0)
    })

    it('refreshes the keys of the same browser, event and account, keeping the id and the creation', async () => {
      await repo.upsert(sub(), 10)

      const again = await repo.upsert(
        sub({ id: 's-2', p256dh: 'key-2', auth: 'auth-2', createdAt: T1 }),
        10,
      )

      expect(again).toBe('updated')
      const listed = await repo.listByEvent(WEDDING)
      expect(listed).toHaveLength(1)
      expect([listed[0]?.id, listed[0]?.p256dh, listed[0]?.auth, listed[0]?.createdAt]).toEqual([
        's-1',
        'key-2',
        'auth-2',
        T0,
      ])
    })

    it('keeps one row for each event and each account of the same browser', async () => {
      await repo.upsert(sub({ id: 's-1' }), 10)
      await repo.upsert(sub({ id: 's-2', event: GALA }), 10)
      await repo.upsert(sub({ id: 's-3', user: TWO }), 10)

      expect((await repo.listByEvent(WEDDING)).map((row) => row.id)).toEqual(['s-1', 's-3'])
      expect((await repo.listByEvent(GALA)).map((row) => row.id)).toEqual(['s-2'])
    })

    it('refuses a new subscription past the cap of an account in an event, and writes nothing', async () => {
      await repo.upsert(sub({ id: 's-1', endpoint: 'https://a.example/1' }), 2)
      await repo.upsert(sub({ id: 's-2', endpoint: 'https://a.example/2' }), 2)

      const third = await repo.upsert(sub({ id: 's-3', endpoint: 'https://a.example/3' }), 2)
      const other = await repo.upsert(
        sub({ id: 's-4', user: TWO, endpoint: 'https://a.example/3' }),
        2,
      )
      const refresh = await repo.upsert(sub({ id: 's-5', endpoint: 'https://a.example/1' }), 2)

      expect([third, other, refresh]).toEqual(['tooMany', 'added', 'updated'])
      expect((await repo.listByEvent(WEDDING)).map((row) => row.id)).toEqual(['s-1', 's-2', 's-4'])
    })

    it('removes only this account’s browser in this event, and says whether one existed', async () => {
      await repo.upsert(sub({ id: 's-1' }), 10)
      await repo.upsert(sub({ id: 's-2', user: TWO }), 10)

      expect(await repo.remove(WEDDING, TWO, 'https://other.example/x')).toBe(false)
      expect(await repo.remove(GALA, ONE, ENDPOINT)).toBe(false)
      expect(await repo.remove(WEDDING, ONE, ENDPOINT)).toBe(true)
      expect(await repo.remove(WEDDING, ONE, ENDPOINT)).toBe(false)
      expect((await repo.listByEvent(WEDDING)).map((row) => row.id)).toEqual(['s-2'])
    })

    it('removes by id within the event only', async () => {
      await repo.upsert(sub({ id: 's-1' }), 10)

      expect(await repo.removeById(GALA, 's-1')).toBe(false)
      expect(await repo.listByEvent(WEDDING)).toHaveLength(1)
      expect(await repo.removeById(WEDDING, 's-1')).toBe(true)
      expect(await repo.listByEvent(WEDDING)).toHaveLength(0)
    })

    it('prunes a subscription after the limit of failures in a row, and a delivery starts the count again', async () => {
      await repo.upsert(sub({ id: 's-1' }), 10)

      expect(await repo.recordFailure(WEDDING, 's-1', 3)).toBe('kept')
      expect(await repo.recordFailure(WEDDING, 's-1', 3)).toBe('kept')
      await repo.resetFailures(WEDDING, 's-1')
      expect(await repo.recordFailure(WEDDING, 's-1', 3)).toBe('kept')
      expect(await repo.recordFailure(WEDDING, 's-1', 3)).toBe('kept')
      expect(await repo.recordFailure(WEDDING, 's-1', 3)).toBe('pruned')
      expect(await repo.listByEvent(WEDDING)).toHaveLength(0)
    })

    it('counts failures within the event, forgets them when the browser subscribes again, and ignores an id that is gone', async () => {
      await repo.upsert(sub({ id: 's-1' }), 10)

      expect(await repo.recordFailure(GALA, 's-1', 1)).toBe('kept')
      expect(await repo.recordFailure(WEDDING, 'nope', 1)).toBe('kept')
      expect(await repo.recordFailure(WEDDING, 's-1', 2)).toBe('kept')
      await repo.upsert(sub({ id: 's-9', p256dh: 'key-2' }), 10)
      expect(await repo.recordFailure(WEDDING, 's-1', 2)).toBe('kept')
      expect(await repo.listByEvent(WEDDING)).toHaveLength(1)
      await repo.resetFailures(GALA, 'nope')
    })

    it('removes every subscription of an account for one event, and no other', async () => {
      await repo.upsert(sub({ id: 's-1' }), 10)
      await repo.upsert(sub({ id: 's-2', endpoint: 'https://a.example/2' }), 10)
      await repo.upsert(sub({ id: 's-3', user: TWO, endpoint: 'https://a.example/3' }), 10)
      await repo.upsert(sub({ id: 's-4', event: GALA, endpoint: 'https://a.example/4' }), 10)

      expect(await repo.removeForMember(WEDDING, ONE)).toBe(2)
      expect(await repo.removeForMember(WEDDING, ONE)).toBe(0)

      expect((await repo.listByEvent(WEDDING)).map((row) => row.id)).toEqual(['s-3'])
      expect(await repo.listByEvent(GALA)).toHaveLength(1)
    })

    it('lists the oldest first, and nothing of another event', async () => {
      await repo.upsert(
        sub({ id: 's-late', createdAt: T1, endpoint: 'https://a.example/late' }),
        10,
      )
      await repo.upsert(
        sub({ id: 's-early', createdAt: T0, endpoint: 'https://a.example/early' }),
        10,
      )
      await repo.upsert(sub({ id: 's-gala', event: GALA }), 10)

      expect((await repo.listByEvent(WEDDING)).map((row) => row.id)).toEqual(['s-early', 's-late'])
    })
  })
}
