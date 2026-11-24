import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteOutboxDb } from './indexedDbOutbox'
import type * as IndexedDbOutboxModule from './indexedDbOutbox'
import {
  KILL_MESSAGE,
  OUTBOX_SYNC_TAG,
  PUSH_ONLY_MESSAGE,
  ensurePushWorker,
  registerUploadWorker,
  removeUploadWorker,
  requestBackgroundSync,
  supportsBackgroundSync,
} from './serviceWorker'

/**
 * Registration, removal, and the Background Sync request.
 *
 * jsdom implements no service worker at all, so `navigator.serviceWorker` is installed
 * per test — which is also the honest shape of the problem: every branch here exists
 * because some real browser is missing the same thing.
 */

vi.mock('./indexedDbOutbox', async (importOriginal) => ({
  // Only the database deletion is stubbed, and only because jsdom has no IndexedDB.
  // Everything else in the module is the real code, tested against a real
  // implementation in `indexedDbOutbox.test.ts`.
  ...(await importOriginal<typeof IndexedDbOutboxModule>()),
  deleteOutboxDb: vi.fn(async () => undefined),
}))

interface FakeRegistration {
  active: { postMessage: ReturnType<typeof vi.fn> } | null
  unregister: ReturnType<typeof vi.fn>
  sync?: { register: ReturnType<typeof vi.fn> }
  pushManager?: { getSubscription: ReturnType<typeof vi.fn> }
}

const install = (container: Partial<ServiceWorkerContainer>): void => {
  Object.defineProperty(navigator, 'serviceWorker', {
    value: container,
    configurable: true,
    writable: true,
  })
}

const uninstall = (): void => {
  Reflect.deleteProperty(navigator, 'serviceWorker')
}

const aRegistration = (overrides: Partial<FakeRegistration> = {}): FakeRegistration => ({
  active: { postMessage: vi.fn() },
  unregister: vi.fn(async () => true),
  ...overrides,
})

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  uninstall()
  vi.restoreAllMocks()
})

describe('registerUploadWorker', () => {
  it('registers at the root, so the worker can act for every event', async () => {
    const register = vi.fn(async () => aRegistration())
    install({ register } as unknown as Partial<ServiceWorkerContainer>)

    expect(await registerUploadWorker()).toBe(true)
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' })
  })

  it('does nothing in a browser with no service workers', async () => {
    // An insecure origin, a locked-down webview, a browser that simply does not have
    // them. The foreground drain still works, so this must not throw.
    expect(await registerUploadWorker()).toBe(false)
  })

  it('survives a registration the browser refuses', async () => {
    install({
      register: vi.fn(async () => {
        throw new Error('quota')
      }),
    } as unknown as Partial<ServiceWorkerContainer>)

    expect(await registerUploadWorker()).toBe(false)
  })
})

describe('removeUploadWorker', () => {
  it('unregisters every worker and deletes what they were holding', async () => {
    // Both halves matter. Unregistering alone leaves a database nothing drains;
    // deleting alone leaves a worker that recreates it on the next sync.
    const registration = aRegistration()
    install({
      getRegistrations: vi.fn(async () => [registration]),
    } as unknown as Partial<ServiceWorkerContainer>)

    await removeUploadWorker()

    expect(registration.active?.postMessage).toHaveBeenCalledWith({ type: KILL_MESSAGE })
    expect(registration.unregister).toHaveBeenCalled()
    expect(deleteOutboxDb).toHaveBeenCalled()
  })

  it('still deletes the stored photos when there is no worker to remove', async () => {
    await removeUploadWorker()

    expect(deleteOutboxDb).toHaveBeenCalled()
  })

  it('still deletes the stored photos when unregistering fails', async () => {
    install({
      getRegistrations: vi.fn(async () => {
        throw new Error('denied')
      }),
    } as unknown as Partial<ServiceWorkerContainer>)

    await removeUploadWorker()

    expect(deleteOutboxDb).toHaveBeenCalled()
  })
})

describe('requestBackgroundSync', () => {
  it('asks the browser to finish the outbox later', async () => {
    const sync = { register: vi.fn(async () => undefined) }
    install({
      ready: Promise.resolve(aRegistration({ sync })),
    } as unknown as Partial<ServiceWorkerContainer>)

    expect(await requestBackgroundSync()).toBe(true)
    expect(sync.register).toHaveBeenCalledWith(OUTBOX_SYNC_TAG)
  })

  it('reports no when the browser has no Background Sync', async () => {
    // WebKit, which is what most guests at an event are holding. The foreground drain
    // is the path that has to work, and this one is the bonus.
    install({
      ready: Promise.resolve(aRegistration()),
    } as unknown as Partial<ServiceWorkerContainer>)

    expect(await requestBackgroundSync()).toBe(false)
  })

  it('reports no when the browser refuses the registration', async () => {
    install({
      ready: Promise.resolve(
        aRegistration({
          sync: {
            register: vi.fn(async () => {
              throw new Error('denied')
            }),
          },
        }),
      ),
    } as unknown as Partial<ServiceWorkerContainer>)

    expect(await requestBackgroundSync()).toBe(false)
  })

  it('reports no in a browser with no service workers at all', async () => {
    expect(await requestBackgroundSync()).toBe(false)
  })
})

describe('supportsBackgroundSync', () => {
  it('says yes where the registration can sync, so "you can close this page" is true', async () => {
    const sync = { register: vi.fn(async () => undefined) }
    install({
      getRegistration: vi.fn(async () => aRegistration({ sync })),
    } as unknown as Partial<ServiceWorkerContainer>)

    expect(await supportsBackgroundSync()).toBe(true)
  })

  it('says no on WebKit, where photos leave only while a page is open', async () => {
    install({
      getRegistration: vi.fn(async () => aRegistration()),
    } as unknown as Partial<ServiceWorkerContainer>)

    expect(await supportsBackgroundSync()).toBe(false)
  })

  it('says no when no worker was ever registered, without waiting for one', async () => {
    // `ready` would never resolve here; the answer has to come back all the same.
    install({
      getRegistration: vi.fn(async () => undefined),
    } as unknown as Partial<ServiceWorkerContainer>)

    expect(await supportsBackgroundSync()).toBe(false)
  })

  it('says no when the lookup itself fails', async () => {
    install({
      getRegistration: vi.fn(async () => {
        throw new Error('locked down')
      }),
    } as unknown as Partial<ServiceWorkerContainer>)

    expect(await supportsBackgroundSync()).toBe(false)
  })

  it('says no in a browser with no service workers at all', async () => {
    expect(await supportsBackgroundSync()).toBe(false)
  })
})

describe('a browser notification on the worker (spec 30, lot 4)', () => {
  it('keeps a registration a push subscription lives on, and tells its worker to stop serving the shell', async () => {
    const subscribed = aRegistration({
      pushManager: { getSubscription: vi.fn(async () => ({ endpoint: 'https://x.example/e' })) },
    })
    const plain = aRegistration({ pushManager: { getSubscription: vi.fn(async () => null) } })
    install({
      getRegistrations: vi.fn(async () => [subscribed, plain]) as never,
    })

    await removeUploadWorker()

    expect(subscribed.unregister).not.toHaveBeenCalled()
    expect(subscribed.active?.postMessage).toHaveBeenCalledWith({ type: PUSH_ONLY_MESSAGE })
    expect(subscribed.active?.postMessage).not.toHaveBeenCalledWith({ type: KILL_MESSAGE })
    expect(plain.unregister).toHaveBeenCalledTimes(1)
    expect(plain.active?.postMessage).toHaveBeenCalledWith({ type: KILL_MESSAGE })
  })

  it('removes a registration whose subscription cannot be read', async () => {
    const broken = aRegistration({
      pushManager: {
        getSubscription: vi.fn(async () => {
          throw new Error('denied')
        }),
      },
    })
    install({ getRegistrations: vi.fn(async () => [broken]) as never })

    await removeUploadWorker()

    expect(broken.unregister).toHaveBeenCalledTimes(1)
  })

  it('registers the worker for a host who asked for notifications, and says when it cannot', async () => {
    const ready = aRegistration()
    const register = vi.fn(async () => ready)
    install({ register: register as never, ready: Promise.resolve(ready) as never })

    expect(await ensurePushWorker('/sw.js')).toBe(ready)
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' })

    install({
      register: vi.fn(async () => {
        throw new Error('insecure')
      }) as never,
    })
    expect(await ensurePushWorker()).toBeNull()

    uninstall()
    expect(await ensurePushWorker()).toBeNull()
  })
})
