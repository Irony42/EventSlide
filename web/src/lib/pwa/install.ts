/**
 * What a browser will and will not tell us about installing.
 *
 * Three quite different worlds, and the reason this file exists rather than a `useState`
 * in a component:
 *
 * - **Chromium** fires `beforeinstallprompt`, which must be `preventDefault()`ed and
 *   kept, and can be `prompt()`ed exactly once, and only from a user gesture.
 * - **WebKit on iOS** has no API at all. Installing is Share → "Sur l'écran d'accueil",
 *   so the only honest thing to offer is that sentence. It is detected by the presence
 *   of `navigator.standalone`, which is Safari's own non-standard property — a feature
 *   check rather than a user-agent string, which is what keeps this from rotting.
 * - **Firefox** offers nothing on desktop and nothing worth prompting on Android.
 *   Saying nothing is the correct behaviour there.
 */

/**
 * The Chromium-only event. Not in TypeScript's DOM library, because it is not on a
 * standards track — so it is described here rather than asserted away with a cast.
 */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  readonly userChoice: Promise<{ readonly outcome: 'accepted' | 'dismissed' }>
}

/** Safari's own "am I on the home screen?" flag, which no other browser defines. */
interface IosNavigator extends Navigator {
  readonly standalone?: boolean
}

/**
 * Whether the app is already running as an installed app.
 *
 * Two checks because the two families disagree: `display-mode: standalone` is the
 * standard one, and iOS answers it only sometimes — `navigator.standalone` is what
 * Safari actually sets.
 */
export const isInstalled = (): boolean => {
  const ios = navigator as IosNavigator
  if (ios.standalone === true) return true
  try {
    return window.matchMedia('(display-mode: standalone)').matches
  } catch {
    // `matchMedia` exists everywhere that matters, but a stubbed one in a test harness
    // may not understand this query. Not installed is the safe answer: the worst case
    // is offering to install something already installed.
    return false
  }
}

/**
 * Whether this browser can only be told how to install, not asked.
 *
 * True on iOS Safari, where the instructions are the entire feature.
 */
export const needsManualInstructions = (): boolean =>
  'standalone' in navigator && (navigator as IosNavigator).standalone !== true

/**
 * Where the "did they already say no?" answer is kept.
 *
 * `localStorage` rather than the session, because "no" has to outlive the tab. A guest
 * who dismissed this at 21:00 and reopens the gallery at midnight must not be asked
 * again — the whole point of the feature is to be less friction, not more.
 */
const DISMISSED_KEY = 'eventslide.install.dismissed'

export const wasDismissed = (): boolean => {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1'
  } catch {
    // Safari in private browsing throws on access. Asking once per session is a better
    // failure than never offering at all.
    return false
  }
}

export const rememberDismissal = (): void => {
  try {
    localStorage.setItem(DISMISSED_KEY, '1')
  } catch {
    // The prompt is gone for this page load regardless; only the memory of it is lost.
  }
}

/**
 * The captured `beforeinstallprompt`, held at module scope rather than in a component.
 *
 * This is not premature generality; a hook holding it does not work. The event fires
 * **once per document load**, and the guest's journey — `/join/:code`, then a React
 * Router `navigate` to `/e/:slug/upload` — is one document. Chromium therefore fires it
 * while the join screen is mounted, which is before the upload screen exists, and the
 * event is never fired again. A listener registered inside the upload screen's hook
 * misses it every single time a guest arrives the way guests actually arrive: by
 * scanning the QR code.
 *
 * So the capture is started from the composition root, before any screen mounts, and the
 * hook subscribes to what was already caught.
 */
let captured: BeforeInstallPromptEvent | null = null
let installed = false
const subscribers = new Set<() => void>()

const announce = (): void => {
  for (const notify of [...subscribers]) notify()
}

/**
 * Starts listening. Call once, from the composition root.
 *
 * Returns a teardown, which production never uses and a test always does.
 */
export const watchForInstall = (): (() => void) => {
  const onBeforeInstallPrompt = (event: Event): void => {
    // Without this the browser shows its own mini-infobar, which is the arrival-time
    // interruption this whole design exists to avoid.
    event.preventDefault()
    captured = event as BeforeInstallPromptEvent
    announce()
  }

  const onInstalled = (): void => {
    captured = null
    installed = true
    announce()
  }

  window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
  // Fires when the app is installed by any route, including the browser's own menu.
  // Without it the card sits there offering something already done.
  window.addEventListener('appinstalled', onInstalled)

  return () => {
    window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.removeEventListener('appinstalled', onInstalled)
  }
}

/** Subscribes to "something changed about whether we can offer an install". */
export const onInstallStateChange = (notify: () => void): (() => void) => {
  subscribers.add(notify)
  return () => {
    subscribers.delete(notify)
  }
}

export const hasCapturedPrompt = (): boolean => captured !== null

export const wasInstalledThisSession = (): boolean => installed

/**
 * Raises the browser's prompt, once.
 *
 * Resolves to the guest's answer, or `null` when there was nothing to raise or the
 * browser refused it. The event is spent on use — a `BeforeInstallPromptEvent` may be
 * prompted once and a second call throws — so it is cleared before the first `await`,
 * which is what makes a double-tap safe.
 */
export const raiseInstallPrompt = async (): Promise<'accepted' | 'dismissed' | null> => {
  const event = captured
  if (event === null) return null
  captured = null
  announce()

  try {
    await event.prompt()
    const { outcome } = await event.userChoice
    return outcome
  } catch {
    // Raised outside a user gesture, or withdrawn by the browser.
    return null
  }
}

/** Testing seam: forgets everything captured so far. Never called in production. */
export const resetInstallState = (): void => {
  captured = null
  installed = false
  subscribers.clear()
}
