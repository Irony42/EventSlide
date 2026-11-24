import { describe, expect, it, vi } from 'vitest'
import {
  browserEnv,
  disablePush,
  enablePush,
  forgetPushOnSignOut,
  keyBytes,
  readPushState,
  supportOf,
  usesKey,
  type PushApi,
  type PushEnv,
} from './browserPush'

/**
 * The checkbox's rules (spec 30, lot 4): the permission is asked only when the box is ticked, a denial
 * is a denial (but a revoked one can still be unticked), an iPhone is sent to the home screen, one
 * browser subscription serves every event and goes with the last, a rotated key means a new
 * subscription, a sign-out forgets the browser everywhere, and a failure leaves nothing half done.
 */

const P256DH = 'B' + 'A'.repeat(86)
const AUTH = 'A'.repeat(22)
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc'
/** Two server keys: the first is what a browser holds, the second what the operator rotated to. */
const KEY_A = 'BAAA'
const KEY_B = 'BBBB'

type Held = ReturnType<typeof aSubscription>

const aSubscription = (key: string | null = KEY_A) => ({
  endpoint: ENDPOINT,
  options: { applicationServerKey: key === null ? null : keyBytes(key).buffer },
  unsubscribe: vi.fn(async () => true),
  toJSON: () => ({
    endpoint: ENDPOINT,
    keys: { p256dh: P256DH, auth: AUTH },
    expirationTime: null,
  }),
})

const aRegistration = (held: Held | null = null) => {
  const made = aSubscription(KEY_B)
  return {
    made,
    registration: {
      pushManager: {
        getSubscription: vi.fn(async () => held),
        subscribe: vi.fn(async () => made),
      },
    } as unknown as ServiceWorkerRegistration,
  }
}

const anEnv = (overrides: Partial<PushEnv> = {}): PushEnv & { memory: Map<string, string> } => {
  const memory = new Map<string, string>()
  return {
    memory,
    capable: true,
    apple: false,
    standalone: false,
    permission: () => 'default',
    requestPermission: vi.fn(async () => 'granted' as const),
    worker: vi.fn(async () => aRegistration().registration),
    existingWorker: vi.fn(async () => undefined),
    remembered: (slug) => memory.get(slug) ?? null,
    remember: (slug, endpoint) =>
      void (endpoint === null ? memory.delete(slug) : memory.set(slug, endpoint)),
    rememberedSlugs: () => [...memory.keys()],
    ...overrides,
  }
}

const anApi = (overrides: Partial<PushApi> = {}): PushApi => ({
  pushKey: vi.fn(async () => ({ publicKey: KEY_A })),
  subscribePush: vi.fn(async () => undefined),
  unsubscribePush: vi.fn(async () => undefined),
  unsubscribePushEverywhere: vi.fn(async () => undefined),
  ...overrides,
})

const refusing = () =>
  vi.fn(async () => {
    throw new Error('network')
  })

describe('what this browser can do', () => {
  it('is supported where a worker, a push manager and notifications exist', () => {
    expect(supportOf(anEnv())).toBe('supported')
    expect(supportOf(anEnv({ capable: false }))).toBe('unsupported')
  })

  it('sends an iPhone to the home screen first, and lets the installed app through', () => {
    expect(supportOf(anEnv({ apple: true, capable: false }))).toBe('addToHomeScreen')
    expect(supportOf(anEnv({ apple: true, standalone: true }))).toBe('supported')
    expect(supportOf(anEnv({ apple: true, standalone: true, capable: false }))).toBe('unsupported')
  })
})

describe('the key a subscription was made with', () => {
  it('matches the box’s key byte for byte, and not another', () => {
    const held = aSubscription(KEY_A) as unknown as PushSubscription

    expect(usesKey(held, KEY_A)).toBe(true)
    expect(usesKey(held, KEY_B)).toBe(false)
    expect(usesKey(held, 'BAAAAA')).toBe(false)
  })

  it('is a mismatch for a subscription made with no key, and a match for a browser that does not say', () => {
    expect(usesKey(aSubscription(null) as unknown as PushSubscription, KEY_A)).toBe(false)
    expect(usesKey({ endpoint: ENDPOINT } as PushSubscription, KEY_A)).toBe(true)
  })
})

describe('the state of an event’s checkbox', () => {
  it('is off where nothing can be done, and never asks anything', async () => {
    const env = anEnv({ capable: false })

    expect(await readPushState('fete', env)).toEqual({
      support: 'unsupported',
      permission: 'default',
      subscribed: false,
    })
  })

  it('is off until this event was ticked here, and on while the browser holds its subscription', async () => {
    const held = aRegistration(aSubscription())
    const env = anEnv({
      permission: () => 'granted',
      existingWorker: async () => held.registration,
    })

    expect((await readPushState('fete', env)).subscribed).toBe(false)
    env.remember('fete', ENDPOINT)
    expect((await readPushState('fete', env)).subscribed).toBe(true)
    expect((await readPushState('autre', env)).subscribed).toBe(false)
  })

  it('is off when the browser lost its subscription, or cannot say', async () => {
    const lost = aRegistration(null)
    const env = anEnv({
      permission: () => 'granted',
      existingWorker: async () => lost.registration,
    })
    env.remember('fete', ENDPOINT)

    expect((await readPushState('fete', env)).subscribed).toBe(false)
    expect(
      (
        await readPushState('fete', {
          ...env,
          existingWorker: async () => {
            throw new Error('boom')
          },
        })
      ).subscribed,
    ).toBe(false)
    expect(
      (await readPushState('fete', { ...env, existingWorker: async () => undefined })).subscribed,
    ).toBe(false)
  })

  it('is off when the subscription was made with another key than the box’s now (the pair was rotated)', async () => {
    const held = aRegistration(aSubscription(KEY_A))
    const env = anEnv({
      permission: () => 'granted',
      existingWorker: async () => held.registration,
    })
    env.remember('fete', ENDPOINT)

    expect((await readPushState('fete', env, KEY_A)).subscribed).toBe(true)
    expect((await readPushState('fete', env, KEY_B)).subscribed).toBe(false)
  })

  it('reads a permission revoked after ticking as ticked, so that it can be unticked', async () => {
    const env = anEnv({ permission: () => 'denied' })

    expect((await readPushState('fete', env)).subscribed).toBe(false)
    env.remember('fete', ENDPOINT)
    expect(await readPushState('fete', env)).toEqual({
      support: 'supported',
      permission: 'denied',
      subscribed: true,
    })
  })
})

describe('ticking the box', () => {
  it('asks the permission, subscribes with the box’s key, and tells the server this event', async () => {
    const { registration, made } = aRegistration()
    const env = anEnv({ worker: async () => registration })
    const api = anApi({ pushKey: vi.fn(async () => ({ publicKey: KEY_B })) })

    expect(await enablePush(api, 'fete', env)).toBe('on')

    expect(env.requestPermission).toHaveBeenCalledTimes(1)
    expect(registration.pushManager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(KEY_B),
    })
    expect(api.subscribePush).toHaveBeenCalledWith('fete', {
      endpoint: made.endpoint,
      keys: { p256dh: P256DH, auth: AUTH },
    })
    expect(env.remembered('fete')).toBe(ENDPOINT)
  })

  it('does not ask again when the permission is already granted, and reuses a subscription made with the box’s key', async () => {
    const held = aRegistration(aSubscription(KEY_A))
    const env = anEnv({ permission: () => 'granted', worker: async () => held.registration })

    expect(await enablePush(anApi(), 'fete', env)).toBe('on')

    expect(env.requestPermission).not.toHaveBeenCalled()
    expect(held.registration.pushManager.subscribe).not.toHaveBeenCalled()
  })

  it('makes the subscription again when the box’s key changed: the old one is dropped, the new one is sent', async () => {
    const stale = aSubscription(KEY_A)
    const held = aRegistration(stale)
    const env = anEnv({ permission: () => 'granted', worker: async () => held.registration })
    const api = anApi({ pushKey: vi.fn(async () => ({ publicKey: KEY_B })) })

    expect(await enablePush(api, 'fete', env)).toBe('on')

    expect(stale.unsubscribe).toHaveBeenCalledTimes(1)
    expect(held.registration.pushManager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(KEY_B),
    })
    expect(api.subscribePush).toHaveBeenCalledTimes(1)
  })

  it('is a denial when the host refuses, and sends nothing to the server', async () => {
    const api = anApi()
    const env = anEnv({ requestPermission: vi.fn(async () => 'denied' as const) })

    expect(await enablePush(api, 'fete', env)).toBe('denied')

    expect(api.pushKey).not.toHaveBeenCalled()
    expect(api.subscribePush).not.toHaveBeenCalled()
    expect(env.remembered('fete')).toBeNull()
  })

  it('does nothing where the browser cannot', async () => {
    const env = anEnv({ capable: false })

    expect(await enablePush(anApi(), 'fete', env)).toBe('failed')
    expect(env.requestPermission).not.toHaveBeenCalled()
  })

  it.each([
    ['no worker can be registered', { worker: async () => null }, anApi()],
    ['the box refuses the subscription', {}, anApi({ subscribePush: refusing() })],
    ['the box has no key', {}, anApi({ pushKey: refusing() })],
  ])('fails, remembering nothing, when %s', async (_name, env, api) => {
    const made = anEnv(env as Partial<PushEnv>)

    expect(await enablePush(api, 'fete', made)).toBe('failed')
    expect(made.remembered('fete')).toBeNull()
  })

  it('fails when the browser’s subscription lacks its keys or its address', async () => {
    const without = (json: object) =>
      ({
        pushManager: {
          getSubscription: async () => null,
          subscribe: async () => ({ toJSON: () => json }),
        },
      }) as unknown as ServiceWorkerRegistration
    const api = anApi()

    expect(
      await enablePush(api, 'fete', anEnv({ worker: async () => without({ endpoint: ENDPOINT }) })),
    ).toBe('failed')
    expect(
      await enablePush(
        api,
        'fete',
        anEnv({ worker: async () => without({ keys: { p256dh: P256DH, auth: AUTH } }) }),
      ),
    ).toBe('failed')
    expect(api.subscribePush).not.toHaveBeenCalled()
  })
})

describe('unticking the box', () => {
  it('tells the server to forget this browser for the event, and keeps the browser’s subscription while another event uses it', async () => {
    const held = aSubscription()
    const { registration } = aRegistration(held)
    const env = anEnv({ existingWorker: async () => registration })
    env.remember('fete', ENDPOINT)
    env.remember('autre', ENDPOINT)
    const api = anApi()

    expect(await disablePush(api, 'fete', env)).toBe(true)

    expect(api.unsubscribePush).toHaveBeenCalledWith('fete', ENDPOINT)
    expect(env.remembered('fete')).toBeNull()
    expect(held.unsubscribe).not.toHaveBeenCalled()
  })

  it('drops the browser’s subscription with the last event', async () => {
    const held = aSubscription()
    const { registration } = aRegistration(held)
    const env = anEnv({ existingWorker: async () => registration })
    env.remember('fete', ENDPOINT)

    expect(await disablePush(anApi(), 'fete', env)).toBe(true)

    expect(held.unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('is done even when dropping the browser’s subscription fails', async () => {
    const held = aSubscription()
    held.unsubscribe = refusing()
    const { registration } = aRegistration(held)
    const env = anEnv({ existingWorker: async () => registration })
    env.remember('fete', ENDPOINT)

    expect(await disablePush(anApi(), 'fete', env)).toBe(true)
  })

  it('forgets the row by the address kept here when the browser no longer holds a subscription (permission revoked)', async () => {
    const env = anEnv({ permission: () => 'denied' })
    env.remember('fete', ENDPOINT)
    const api = anApi()

    expect(await disablePush(api, 'fete', env)).toBe(true)

    expect(api.unsubscribePush).toHaveBeenCalledWith('fete', ENDPOINT)
    expect(env.remembered('fete')).toBeNull()
  })

  it('is done when there is nothing to forget', async () => {
    const env = anEnv()
    const api = anApi()

    expect(await disablePush(api, 'fete', env)).toBe(true)
    expect(api.unsubscribePush).not.toHaveBeenCalled()
  })

  it('stays ticked when the server could not be told', async () => {
    const held = aRegistration(aSubscription())
    const env = anEnv({ existingWorker: async () => held.registration })
    env.remember('fete', ENDPOINT)
    const api = anApi({ unsubscribePush: refusing() })

    expect(await disablePush(api, 'fete', env)).toBe(false)
    expect(env.remembered('fete')).toBe(ENDPOINT)
  })
})

describe('a sign-out', () => {
  it('forgets this browser for every event on the server, drops its subscription and forgets what was ticked', async () => {
    const held = aSubscription()
    const { registration } = aRegistration(held)
    const env = anEnv({ existingWorker: async () => registration })
    env.remember('fete', ENDPOINT)
    env.remember('autre', ENDPOINT)
    const api = anApi()

    await forgetPushOnSignOut(api, env)

    expect(api.unsubscribePushEverywhere).toHaveBeenCalledWith(ENDPOINT)
    expect(held.unsubscribe).toHaveBeenCalledTimes(1)
    expect(env.rememberedSlugs()).toEqual([])
  })

  it('does not hold the sign-out back: a server or browser failure is swallowed', async () => {
    const held = aSubscription()
    held.unsubscribe = refusing()
    const { registration } = aRegistration(held)
    const env = anEnv({ existingWorker: async () => registration })
    env.remember('fete', ENDPOINT)

    await expect(
      forgetPushOnSignOut(anApi({ unsubscribePushEverywhere: refusing() }), env),
    ).resolves.toBeUndefined()
    expect(env.rememberedSlugs()).toEqual([])
  })

  it('does nothing when there is no subscription and nothing ticked', async () => {
    const api = anApi()

    await forgetPushOnSignOut(api, anEnv())

    expect(api.unsubscribePushEverywhere).not.toHaveBeenCalled()
  })

  it('forgets what was ticked even when the browser holds no subscription any more, and when it cannot say', async () => {
    const env = anEnv({ existingWorker: refusing() })
    env.remember('fete', ENDPOINT)
    const api = anApi()

    await forgetPushOnSignOut(api, env)

    expect(env.rememberedSlugs()).toEqual([])
    expect(api.unsubscribePushEverywhere).not.toHaveBeenCalled()
  })
})

describe('the key', () => {
  it('is read as base64url, padded or not', () => {
    expect(Array.from(keyBytes('AQID'))).toEqual([1, 2, 3])
    expect(Array.from(keyBytes('-_8'))).toEqual([251, 255])
  })
})

describe('the browser, for real', () => {
  it('says what jsdom lacks, and keeps the address of what was ticked in local storage', () => {
    const env = browserEnv()

    expect(env.capable).toBe(false)
    expect(env.apple).toBe(false)
    expect(env.permission()).toBe('denied')
    env.remember('fete', ENDPOINT)
    env.remember('autre', ENDPOINT)
    expect(env.remembered('fete')).toBe(ENDPOINT)
    expect([...env.rememberedSlugs()].sort()).toEqual(['autre', 'fete'])
    env.remember('fete', null)
    expect(env.remembered('fete')).toBeNull()
    expect(env.rememberedSlugs()).toEqual(['autre'])
  })

  it('does not fail when storage is refused', () => {
    const env = browserEnv()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Object, 'keys').mockImplementation(() => {
      throw new Error('blocked')
    })

    expect(env.remembered('fete')).toBeNull()
    expect(() => env.remember('fete', ENDPOINT)).not.toThrow()
    expect(env.rememberedSlugs()).toEqual([])
    vi.restoreAllMocks()
  })

  it('knows an iPhone by its agent, and an installed app by its display mode', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)',
    )
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList)

    const env = browserEnv()

    expect(env.apple).toBe(true)
    expect(env.standalone).toBe(true)
    vi.restoreAllMocks()
  })
})
