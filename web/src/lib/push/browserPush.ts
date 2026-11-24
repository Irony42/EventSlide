import { ensurePushWorker } from '../offline/serviceWorker'

/**
 * The host's browser notification (spec 30, lot 4, Web Push), seen from the page: whether this
 * browser can, what it has been told, and subscribing and unsubscribing one event.
 *
 * Everything the browser provides goes through {@link PushEnv}, so that the rules (the permission is
 * asked **only** from a click, a denial is said and never retried, iPhone needs the home screen first,
 * one browser subscription serves every event of the host) are ordinary tested code.
 *
 * One browser holds **one** push subscription for the whole site; the server keeps one row per event
 * and account. Switching one event off therefore tells the server to forget that event for this
 * browser and leaves the browser's subscription alone (another event may still use it).
 */

/** What the page asks of the server: the three calls of the notification routes. */
export interface PushApi {
  pushKey(signal?: AbortSignal): Promise<{ readonly publicKey: string }>
  subscribePush(
    slug: string,
    input: {
      readonly endpoint: string
      readonly keys: { readonly p256dh: string; readonly auth: string }
    },
  ): Promise<void>
  unsubscribePush(slug: string, endpoint: string): Promise<void>
  /** Every event of this account for this browser, on a sign-out. */
  unsubscribePushEverywhere(endpoint: string): Promise<void>
}

export interface PushEnv {
  /** The browser has a service worker, a push manager and notifications. */
  readonly capable: boolean
  /** An iPhone or iPad: Web Push exists there only for an app added to the home screen. */
  readonly apple: boolean
  /** The page runs as an installed app (home screen), not in a browser tab. */
  readonly standalone: boolean
  permission(): NotificationPermission
  requestPermission(): Promise<NotificationPermission>
  /** The worker's registration, registering it when only push is wanted. `null` when it cannot be. */
  worker(): Promise<ServiceWorkerRegistration | null>
  /** The worker's registration if there is one, without registering anything. */
  existingWorker(): Promise<ServiceWorkerRegistration | undefined>
  /** The endpoint this browser was subscribed with for the event, or `null`: kept here, so that a revoked permission can still be unticked. */
  remembered(slug: string): string | null
  remember(slug: string, endpoint: string | null): void
  /** Every event this browser holds a subscription for. */
  rememberedSlugs(): readonly string[]
}

export type PushSupport = 'supported' | 'unsupported' | 'addToHomeScreen'

/** What this browser can do: iPhone first, because there the API does not exist until the app is installed. */
export const supportOf = (env: PushEnv): PushSupport => {
  if (env.apple && !env.standalone) return 'addToHomeScreen'
  return env.capable ? 'supported' : 'unsupported'
}

export interface PushState {
  readonly support: PushSupport
  readonly permission: NotificationPermission
  /** This browser is subscribed for this event, and still can be. */
  readonly subscribed: boolean
}

/**
 * Whether the browser's subscription was made with the key the box holds now. A browser that does not
 * say (no `options`) is taken as matching: it cannot be told apart. A subscription made with another
 * key (the operator rotated the pair) is refused by every push service, and is to be made again.
 */
export const usesKey = (subscription: PushSubscription, publicKey: string): boolean => {
  const options = (subscription as { options?: PushSubscriptionOptions }).options
  if (options === undefined) return true
  const held = options.applicationServerKey
  if (held === null || held === undefined) return false
  const bytes = new Uint8Array(held)
  const wanted = keyBytes(publicKey)
  return bytes.length === wanted.length && bytes.every((byte, at) => byte === wanted[at])
}

/**
 * The state of one event's checkbox. Never rejects: a browser that cannot say is "off".
 *
 * A **revoked permission** with the event still ticked here reads as ticked (so that it can be
 * unticked, which removes the server's row); a subscription made with another key than the box's
 * now reads as off.
 */
export const readPushState = async (
  slug: string,
  env: PushEnv,
  publicKey?: string,
): Promise<PushState> => {
  const support = supportOf(env)
  if (support !== 'supported') return { support, permission: 'default', subscribed: false }
  const permission = env.permission()
  if (env.remembered(slug) === null) return { support, permission, subscribed: false }
  if (permission === 'denied') return { support, permission, subscribed: true }
  try {
    const registration = await env.existingWorker()
    const subscription = await registration?.pushManager.getSubscription()
    const alive =
      subscription !== null &&
      subscription !== undefined &&
      (publicKey === undefined || usesKey(subscription, publicKey))
    return { support, permission, subscribed: alive }
  } catch {
    return { support, permission, subscribed: false }
  }
}

/** The server's key as the bytes `subscribe` wants (base64url, unpadded). */
export const keyBytes = (publicKey: string): Uint8Array<ArrayBuffer> => {
  const padded = publicKey.replace(/-/gu, '+').replace(/_/gu, '/')
  const raw = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  return Uint8Array.from(raw, (char) => char.charCodeAt(0))
}

export type EnableOutcome = 'on' | 'denied' | 'failed'

/**
 * Turns the notification on for one event. **Call it from a click, and from nowhere else**: it is the
 * only place the permission is asked. A refusal is `denied` (the page says how to allow it again; it is
 * never asked a second time by the page), anything else that goes wrong is `failed` and leaves
 * nothing half done on the server.
 */
export const enablePush = async (
  api: PushApi,
  slug: string,
  env: PushEnv,
): Promise<EnableOutcome> => {
  if (supportOf(env) !== 'supported') return 'failed'
  try {
    const permission = env.permission() === 'granted' ? 'granted' : await env.requestPermission()
    if (permission !== 'granted') return 'denied'
    const registration = await env.worker()
    if (registration === null) return 'failed'
    const { publicKey } = await api.pushKey()
    let held = await registration.pushManager.getSubscription()
    // The operator rotated the pair: what was subscribed with the old key is made again, not reused.
    if (held !== null && !usesKey(held, publicKey)) {
      await held.unsubscribe()
      held = null
    }
    const subscription =
      held ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(publicKey),
      }))
    const json = subscription.toJSON()
    const p256dh = json.keys?.['p256dh']
    const auth = json.keys?.['auth']
    if (json.endpoint === undefined || p256dh === undefined || auth === undefined) return 'failed'
    await api.subscribePush(slug, { endpoint: json.endpoint, keys: { p256dh, auth } })
    env.remember(slug, json.endpoint)
    return 'on'
  } catch {
    return 'failed'
  }
}

/**
 * Turns it off for one event: the server forgets this browser for the event (by the address kept here,
 * so a browser whose permission was revoked can still be unticked). The browser's own subscription stays
 * while another event uses it, and goes with the last one. A failure leaves the checkbox on, and says so.
 */
export const disablePush = async (api: PushApi, slug: string, env: PushEnv): Promise<boolean> => {
  try {
    const registration = await env.existingWorker()
    const subscription = await registration?.pushManager.getSubscription()
    const endpoint = env.remembered(slug) ?? subscription?.endpoint
    if (endpoint !== undefined) await api.unsubscribePush(slug, endpoint)
    env.remember(slug, null)
    if (subscription !== null && subscription !== undefined && env.rememberedSlugs().length === 0) {
      await subscription.unsubscribe().catch(() => false)
    }
    return true
  } catch {
    return false
  }
}

/**
 * On a sign-out (a shared computer): this account's rows for this browser are removed on the server, for
 * every event, and the browser's own subscription is dropped. **Call it before the sign-out**, which ends
 * the session it needs. Never rejects: a sign-out is not held back by a notification.
 */
export const forgetPushOnSignOut = async (api: PushApi, env: PushEnv): Promise<void> => {
  const subscription = await (async (): Promise<PushSubscription | null | undefined> => {
    try {
      return await (await env.existingWorker())?.pushManager.getSubscription()
    } catch {
      return null
    }
  })()
  const slugs = env.rememberedSlugs()
  if (subscription === null || subscription === undefined) {
    if (slugs.length === 0) return
  } else {
    await api.unsubscribePushEverywhere(subscription.endpoint).catch(() => undefined)
    await subscription.unsubscribe().catch(() => false)
  }
  for (const slug of slugs) env.remember(slug, null)
}

const MEMORY_PREFIX = 'eventslide.push.'
const memoryKey = (slug: string): string => `${MEMORY_PREFIX}${slug}`

/** The browser, for real. */
export const browserEnv = (): PushEnv => {
  const nav = typeof navigator === 'undefined' ? null : navigator
  const apple =
    nav !== null &&
    (/iPhone|iPad|iPod/u.test(nav.userAgent) ||
      (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1))
  const standalone =
    (typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches) ||
    (nav as (Navigator & { standalone?: boolean }) | null)?.standalone === true
  return {
    capable:
      nav !== null &&
      'serviceWorker' in nav &&
      typeof window !== 'undefined' &&
      'PushManager' in window &&
      'Notification' in window,
    apple,
    standalone,
    permission: () => (typeof Notification === 'undefined' ? 'denied' : Notification.permission),
    requestPermission: () => Notification.requestPermission(),
    worker: () => ensurePushWorker(),
    existingWorker: async () => (await nav?.serviceWorker?.getRegistration()) ?? undefined,
    remembered: (slug) => {
      try {
        return window.localStorage.getItem(memoryKey(slug))
      } catch {
        return null
      }
    },
    remember: (slug, endpoint) => {
      try {
        if (endpoint !== null) window.localStorage.setItem(memoryKey(slug), endpoint)
        else window.localStorage.removeItem(memoryKey(slug))
      } catch {
        // Private mode: the checkbox is read from the browser's own subscription next time, or is off.
      }
    },
    rememberedSlugs: () => {
      try {
        return Object.keys(window.localStorage)
          .filter((key) => key.startsWith(MEMORY_PREFIX))
          .map((key) => key.slice(MEMORY_PREFIX.length))
      } catch {
        return []
      }
    },
  }
}
