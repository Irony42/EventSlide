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
  remembered(slug: string): boolean
  remember(slug: string, on: boolean): void
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

/** The state of one event's checkbox. Never rejects: a browser that cannot say is "off". */
export const readPushState = async (slug: string, env: PushEnv): Promise<PushState> => {
  const support = supportOf(env)
  if (support !== 'supported') return { support, permission: 'default', subscribed: false }
  const permission = env.permission()
  if (permission !== 'granted' || !env.remembered(slug)) {
    return { support, permission, subscribed: false }
  }
  try {
    const registration = await env.existingWorker()
    const subscription = await registration?.pushManager.getSubscription()
    return { support, permission, subscribed: subscription !== null && subscription !== undefined }
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
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(publicKey),
      }))
    const json = subscription.toJSON()
    const p256dh = json.keys?.['p256dh']
    const auth = json.keys?.['auth']
    if (json.endpoint === undefined || p256dh === undefined || auth === undefined) return 'failed'
    await api.subscribePush(slug, { endpoint: json.endpoint, keys: { p256dh, auth } })
    env.remember(slug, true)
    return 'on'
  } catch {
    return 'failed'
  }
}

/**
 * Turns it off for one event: the server forgets this browser for the event. The browser's own
 * subscription stays (other events may use it); a failure leaves the checkbox on, and says so.
 */
export const disablePush = async (api: PushApi, slug: string, env: PushEnv): Promise<boolean> => {
  try {
    const registration = await env.existingWorker()
    const subscription = await registration?.pushManager.getSubscription()
    if (subscription !== null && subscription !== undefined) {
      await api.unsubscribePush(slug, subscription.endpoint)
    }
    env.remember(slug, false)
    return true
  } catch {
    return false
  }
}

const memoryKey = (slug: string): string => `eventslide.push.${slug}`

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
    existingWorker: async () => (await nav?.serviceWorker.getRegistration()) ?? undefined,
    remembered: (slug) => {
      try {
        return window.localStorage.getItem(memoryKey(slug)) === '1'
      } catch {
        return false
      }
    },
    remember: (slug, on) => {
      try {
        if (on) window.localStorage.setItem(memoryKey(slug), '1')
        else window.localStorage.removeItem(memoryKey(slug))
      } catch {
        // Private mode: the checkbox is read from the browser's own subscription next time, or is off.
      }
    },
  }
}
