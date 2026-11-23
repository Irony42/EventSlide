import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_PUSH_HOSTS } from '../../../domain/push/pushEndpoint'
import { FakePushSubscriptionRepository } from '../../testing/fakePushSubscriptionRepository'
import {
  ARCHIVED,
  GALA,
  MODERATOR,
  OWNER,
  STRANGER,
  WEDDING,
  guestInviteScene,
  type GuestInviteScene,
} from '../../testing/guestInviteScene'
import { SequentialIdGenerator } from '../../testing/sequentialIdGenerator'
import {
  makeGetPushKey,
  makeSubscribePush,
  makeUnsubscribePush,
  type PushConfig,
} from './pushSubscriptions'

const PUSH: PushConfig = { publicKey: 'PUBLIC', allowedHosts: DEFAULT_PUSH_HOSTS }
const KEYS = { p256dh: 'B' + 'A'.repeat(86), auth: 'A'.repeat(22) }
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc'
const code = (result: { ok: boolean; error?: { code: string } }): string | undefined =>
  result.ok ? undefined : result.error?.code

describe('the host’s browser notifications (spec 30, lot 4)', () => {
  let scene: GuestInviteScene
  let subscriptions: FakePushSubscriptionRepository

  beforeEach(async () => {
    scene = await guestInviteScene()
    subscriptions = new FakePushSubscriptionRepository()
  })

  const deps = (push: PushConfig | null = PUSH) => ({
    events: scene.events,
    memberships: scene.memberships,
    subscriptions,
    ids: new SequentialIdGenerator(),
    clock: scene.clock,
    push,
  })
  const subscribe = (overrides: Record<string, unknown> = {}, push: PushConfig | null = PUSH) =>
    makeSubscribePush(deps(push))({
      eventId: WEDDING,
      actorId: OWNER,
      endpoint: ENDPOINT,
      keys: KEYS,
      ...overrides,
    } as never)
  const held = async () => subscriptions.listByEvent(WEDDING)

  describe('the public key', () => {
    it('is told when the box has keys, and is 404 push.disabled when it has none', () => {
      expect(makeGetPushKey(PUSH)()).toEqual({ ok: true, value: 'PUBLIC' })
      expect(code(makeGetPushKey(null)())).toBe('push.disabled')
    })
  })

  describe('subscribing', () => {
    it('stores the owner’s browser for the event, the endpoint normalised, and nothing is said of it', async () => {
      const done = await subscribe({ endpoint: 'https://FCM.googleapis.com/fcm/send/abc' })

      expect(done.ok).toBe(true)
      const [stored] = await held()
      expect([stored?.endpoint, stored?.userId, stored?.p256dh, stored?.auth]).toEqual([
        ENDPOINT,
        OWNER,
        KEYS.p256dh,
        KEYS.auth,
      ])
      expect(JSON.stringify(done)).not.toContain('fcm')
    })

    it('is off, 404 push.disabled, while the box has no keys, and stores nothing', async () => {
      expect(code(await subscribe({}, null))).toBe('push.disabled')
      expect(await held()).toHaveLength(0)
    })

    it('is the owner’s: a moderator is refused, a stranger finds nothing, another event’s owner too', async () => {
      expect(code(await subscribe({ actorId: MODERATOR }))).toBe('auth.forbidden')
      expect(code(await subscribe({ actorId: STRANGER }))).toBe('event.notFound')
      expect(code(await subscribe({ eventId: GALA }))).toBe('event.notFound')
      expect(await held()).toHaveLength(0)
    })

    it('is refused on an archived event, which no longer takes a write', async () => {
      expect(code(await subscribe({ eventId: ARCHIVED }))).toBe('guestInvite.eventArchived')
    })

    it('refuses an endpoint that is not an allowed push service, whatever it looks like', async () => {
      for (const endpoint of [
        'http://fcm.googleapis.com/x',
        'https://127.0.0.1/x',
        'https://localhost/x',
        'https://10.0.0.1/x',
        'https://evil.test/x',
        'https://fcm.googleapis.com.evil.test/x',
        4,
        undefined,
      ]) {
        const refused = await subscribe({ endpoint })
        expect(['push.endpointInvalid', 'push.endpointNotAllowed']).toContain(code(refused))
      }
      expect(await held()).toHaveLength(0)
    })

    it('judges the endpoint by the operator’s own list', async () => {
      const narrowed: PushConfig = { ...PUSH, allowedHosts: ['push.example.org'] }

      expect(code(await subscribe({}, narrowed))).toBe('push.endpointNotAllowed')
      expect((await subscribe({ endpoint: 'https://push.example.org/x' }, narrowed)).ok).toBe(true)
    })

    it('refuses keys of the wrong shape', async () => {
      for (const keys of [undefined, 'x', {}, { p256dh: KEYS.p256dh }, { ...KEYS, auth: 'AAAA' }]) {
        expect(code(await subscribe({ keys }))).toBe('push.keysInvalid')
      }
    })

    it('refreshes the keys of the same browser instead of adding another', async () => {
      await subscribe()
      await subscribe({ keys: { p256dh: 'B' + 'C'.repeat(86), auth: 'C'.repeat(22) } })

      const rows = await held()
      expect(rows).toHaveLength(1)
      expect(rows[0]?.auth).toBe('C'.repeat(22))
    })

    it('holds ten browsers per account and event, and says push.tooMany for the eleventh', async () => {
      for (let i = 0; i < 10; i += 1) {
        expect((await subscribe({ endpoint: `https://fcm.googleapis.com/x/${i}` })).ok).toBe(true)
      }

      expect(code(await subscribe({ endpoint: 'https://fcm.googleapis.com/x/10' }))).toBe(
        'push.tooMany',
      )
      expect((await subscribe({ endpoint: 'https://fcm.googleapis.com/x/3' })).ok).toBe(true)
      expect(await held()).toHaveLength(10)
    })
  })

  describe('unsubscribing', () => {
    const unsubscribe = (overrides: Record<string, unknown> = {}, push: PushConfig | null = PUSH) =>
      makeUnsubscribePush({ subscriptions, push })({
        eventId: WEDDING,
        actorId: OWNER,
        endpoint: ENDPOINT,
        ...overrides,
      } as never)

    it('removes this browser, and says the same thing when there was none', async () => {
      await subscribe()

      const first = await unsubscribe()
      const again = await unsubscribe()

      expect([first.ok, again.ok]).toEqual([true, true])
      expect(await held()).toHaveLength(0)
    })

    it('removes only the account’s own, not another account’s of the same browser', async () => {
      await subscribe()
      await subscribe({ actorId: MODERATOR })

      await unsubscribe({ actorId: MODERATOR })

      expect((await held()).map((row) => row.userId)).toEqual([OWNER])
    })

    it('takes the endpoint in the way it was subscribed, host case aside', async () => {
      await subscribe()

      await unsubscribe({ endpoint: 'https://FCM.googleapis.com/fcm/send/abc' })

      expect(await held()).toHaveLength(0)
    })

    it('still works with the feature off, with an address the list no longer allows, and says nothing for rubbish', async () => {
      await subscribe()

      expect((await unsubscribe({ endpoint: 4 })).ok).toBe(true)
      expect((await unsubscribe({ endpoint: '' })).ok).toBe(true)
      expect((await unsubscribe({ endpoint: 'x'.repeat(3000) })).ok).toBe(true)
      expect(await held()).toHaveLength(1)
      expect((await unsubscribe({}, null)).ok).toBe(true)
      expect(await held()).toHaveLength(0)
    })
  })
})
