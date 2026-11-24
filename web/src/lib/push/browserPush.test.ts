import { describe, expect, it, vi } from 'vitest'
import {
  browserEnv,
  disablePush,
  enablePush,
  keyBytes,
  readPushState,
  supportOf,
  type PushApi,
  type PushEnv,
} from './browserPush'

/**
 * The checkbox's rules (spec 30, lot 4): the permission is asked only when the box is ticked, a denial
 * is a denial, an iPhone is sent to the home screen, one browser subscription serves every event, and
 * a failure leaves nothing half done.
 */

const P256DH = 'B' + 'A'.repeat(86)
const AUTH = 'A'.repeat(22)
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc'

const aSubscription = () => ({
  endpoint: ENDPOINT,
  toJSON: () => ({
    endpoint: ENDPOINT,
    keys: { p256dh: P256DH, auth: AUTH },
    expirationTime: null,
  }),
})

const aRegistration = (held: ReturnType<typeof aSubscription> | null = null) => {
  const subscription = aSubscription()
  return {
    subscription,
    registration: {
      pushManager: {
        getSubscription: vi.fn(async () => held),
        subscribe: vi.fn(async () => subscription),
      },
    } as unknown as ServiceWorkerRegistration,
  }
}

const anEnv = (overrides: Partial<PushEnv> = {}): PushEnv & { memory: Set<string> } => {
  const memory = new Set<string>()
  return {
    memory,
    capable: true,
    apple: false,
    standalone: false,
    permission: () => 'default',
    requestPermission: vi.fn(async () => 'granted' as const),
    worker: vi.fn(async () => aRegistration().registration),
    existingWorker: vi.fn(async () => undefined),
    remembered: (slug) => memory.has(slug),
    remember: (slug, on) => void (on ? memory.add(slug) : memory.delete(slug)),
    ...overrides,
  }
}

const anApi = (overrides: Partial<PushApi> = {}): PushApi => ({
  pushKey: vi.fn(async () => ({ publicKey: 'BAAA' })),
  subscribePush: vi.fn(async () => undefined),
  unsubscribePush: vi.fn(async () => undefined),
  ...overrides,
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

describe('the state of an event’s checkbox', () => {
  it('is off where nothing can be done, and never asks anything', async () => {
    const env = anEnv({ capable: false })

    expect(await readPushState('fete', env)).toEqual({
      support: 'unsupported',
      permission: 'default',
      subscribed: false,
    })
  })

  it('is off until the permission is granted and this event was ticked here', async () => {
    const held = aRegistration(aSubscription())
    const env = anEnv({
      permission: () => 'granted',
      existingWorker: async () => held.registration,
    })

    expect((await readPushState('fete', env)).subscribed).toBe(false)
    env.remember('fete', true)
    expect((await readPushState('fete', env)).subscribed).toBe(true)
    expect((await readPushState('autre', env)).subscribed).toBe(false)
    expect((await readPushState('fete', { ...env, permission: () => 'denied' })).subscribed).toBe(
      false,
    )
  })

  it('is off when the browser lost its subscription, or cannot say', async () => {
    const lost = aRegistration(null)
    const env = anEnv({
      permission: () => 'granted',
      existingWorker: async () => lost.registration,
    })
    env.remember('fete', true)

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

  it('reports a denial as it is', async () => {
    expect((await readPushState('fete', anEnv({ permission: () => 'denied' }))).permission).toBe(
      'denied',
    )
  })
})

describe('ticking the box', () => {
  it('asks the permission, subscribes with the box’s key, and tells the server this event', async () => {
    const { registration, subscription } = aRegistration()
    const env = anEnv({ worker: async () => registration })
    const api = anApi()

    expect(await enablePush(api, 'fete', env)).toBe('on')

    expect(env.requestPermission).toHaveBeenCalledTimes(1)
    expect(registration.pushManager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: keyBytes('BAAA'),
    })
    expect(api.subscribePush).toHaveBeenCalledWith('fete', {
      endpoint: subscription.endpoint,
      keys: { p256dh: P256DH, auth: AUTH },
    })
    expect(env.remembered('fete')).toBe(true)
  })

  it('does not ask again when the permission is already granted, and reuses the browser’s subscription', async () => {
    const held = aRegistration(aSubscription())
    const env = anEnv({ permission: () => 'granted', worker: async () => held.registration })

    expect(await enablePush(anApi(), 'fete', env)).toBe('on')

    expect(env.requestPermission).not.toHaveBeenCalled()
    expect(held.registration.pushManager.subscribe).not.toHaveBeenCalled()
  })

  it('is a denial when the host refuses, and sends nothing to the server', async () => {
    const api = anApi()
    const env = anEnv({ requestPermission: vi.fn(async () => 'denied' as const) })

    expect(await enablePush(api, 'fete', env)).toBe('denied')

    expect(api.pushKey).not.toHaveBeenCalled()
    expect(api.subscribePush).not.toHaveBeenCalled()
    expect(env.remembered('fete')).toBe(false)
  })

  it('does nothing where the browser cannot', async () => {
    const env = anEnv({ capable: false })

    expect(await enablePush(anApi(), 'fete', env)).toBe('failed')
    expect(env.requestPermission).not.toHaveBeenCalled()
  })

  it.each([
    ['no worker can be registered', { worker: async () => null }, anApi()],
    [
      'the box refuses the subscription',
      {},
      anApi({
        subscribePush: vi.fn(async () => {
          throw new Error('409')
        }),
      }),
    ],
    [
      'the box has no key',
      {},
      anApi({
        pushKey: vi.fn(async () => {
          throw new Error('404')
        }),
      }),
    ],
  ])('fails, remembering nothing, when %s', async (_name, env, api) => {
    const made = anEnv(env as Partial<PushEnv>)

    expect(await enablePush(api, 'fete', made)).toBe('failed')
    expect(made.remembered('fete')).toBe(false)
  })

  it('fails when the browser’s subscription lacks its keys', async () => {
    const registration = {
      pushManager: {
        getSubscription: async () => null,
        subscribe: async () => ({ toJSON: () => ({ endpoint: ENDPOINT }) }),
      },
    } as unknown as ServiceWorkerRegistration
    const api = anApi()

    expect(await enablePush(api, 'fete', anEnv({ worker: async () => registration }))).toBe(
      'failed',
    )
    expect(api.subscribePush).not.toHaveBeenCalled()
  })

  it('fails when the browser’s subscription has no endpoint', async () => {
    const registration = {
      pushManager: {
        getSubscription: async () => null,
        subscribe: async () => ({ toJSON: () => ({ keys: { p256dh: P256DH, auth: AUTH } }) }),
      },
    } as unknown as ServiceWorkerRegistration

    expect(await enablePush(anApi(), 'fete', anEnv({ worker: async () => registration }))).toBe(
      'failed',
    )
  })
})

describe('unticking the box', () => {
  it('tells the server to forget this browser for the event, and leaves the browser’s subscription', async () => {
    const held = aRegistration(aSubscription())
    const env = anEnv({ existingWorker: async () => held.registration })
    env.remember('fete', true)
    const api = anApi()

    expect(await disablePush(api, 'fete', env)).toBe(true)

    expect(api.unsubscribePush).toHaveBeenCalledWith('fete', ENDPOINT)
    expect(env.remembered('fete')).toBe(false)
  })

  it('is done when there is nothing to forget', async () => {
    const env = anEnv()
    env.remember('fete', true)
    const api = anApi()

    expect(await disablePush(api, 'fete', env)).toBe(true)
    expect(api.unsubscribePush).not.toHaveBeenCalled()
    expect(env.remembered('fete')).toBe(false)
  })

  it('stays ticked when the server could not be told', async () => {
    const held = aRegistration(aSubscription())
    const env = anEnv({ existingWorker: async () => held.registration })
    env.remember('fete', true)
    const api = anApi({
      unsubscribePush: vi.fn(async () => {
        throw new Error('network')
      }),
    })

    expect(await disablePush(api, 'fete', env)).toBe(false)
    expect(env.remembered('fete')).toBe(true)
  })
})

describe('the key', () => {
  it('is read as base64url, padded or not', () => {
    expect(Array.from(keyBytes('AQID'))).toEqual([1, 2, 3])
    expect(Array.from(keyBytes('-_8'))).toEqual([251, 255])
  })
})

describe('the browser, for real', () => {
  it('says what jsdom lacks, and keeps what was ticked in local storage', () => {
    const env = browserEnv()

    expect(env.capable).toBe(false)
    expect(env.apple).toBe(false)
    expect(env.permission()).toBe('denied')
    env.remember('fete', true)
    expect(env.remembered('fete')).toBe(true)
    env.remember('fete', false)
    expect(env.remembered('fete')).toBe(false)
  })

  it('does not fail when storage is refused', () => {
    const env = browserEnv()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })

    expect(env.remembered('fete')).toBe(false)
    expect(() => env.remember('fete', true)).not.toThrow()
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
