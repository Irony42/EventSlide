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
