import { DEFAULT_LOCALE, negotiate, parseLocale, type Locale } from './locale'

/**
 * Where a guest's language choice lives, and why it is not anywhere else.
 *
 * Three storages already existed in this app and none of them is right for this:
 *
 * - The **device token** is an `HttpOnly`, event-scoped cookie the server signs. The
 *   client cannot write it, and a language is not something the server needs to know —
 *   it answers with codes, never with prose.
 * - `guestSession` uses **`sessionStorage`**, keyed by event slug. That lifetime is
 *   deliberate for what it holds (the event name, for a reload) and wrong for this: it
 *   dies when the tab closes, and a guest who reopens the installed app an hour later
 *   would be back in French. It is also event-scoped, and a language is a property of
 *   the person, not of the wedding they are at.
 * - **`localStorage`**, which is what this uses: one key, no event in it, survives a
 *   reload, a tab close and an app relaunch, and needs no account.
 *
 * Every access is wrapped, because both of them throw: Safari in private browsing
 * throws on write, and a browser with site data blocked throws on read. Losing the
 * preference is survivable — detection runs again and the guest is back where they
 * started. Failing the render over it is not.
 */

const STORAGE_KEY = 'eventslide.locale'

/**
 * What the browser last stored, or `null`.
 *
 * Parsed rather than cast: what comes back is a string this build did not necessarily
 * write — an older bundle, another tab, a hand-edited entry. `parseLocale` is the guard,
 * and it says at its own definition why it is a membership test and not a schema.
 */
export const readStoredLocale = (): Locale | null => {
  try {
    return parseLocale(localStorage.getItem(STORAGE_KEY))
  } catch {
    return null
  }
}

export const storeLocale = (locale: Locale): void => {
  try {
    localStorage.setItem(STORAGE_KEY, locale)
  } catch {
    // Private browsing, or site data blocked. The choice holds for this page and is
    // forgotten on the next one, which is better than a join screen that will not render.
  }
}

/**
 * The browser's own ordered language preferences.
 *
 * `navigator.languages` is the list; `navigator.language` is the first of it and is the
 * fallback for anything that only implements the singular form. An empty list is
 * treated as no signal at all rather than as a preference for nothing.
 */
const browserPreferences = (): readonly string[] => {
  const list = navigator.languages
  if (Array.isArray(list) && list.length > 0) return list
  return typeof navigator.language === 'string' && navigator.language.length > 0
    ? [navigator.language]
    : []
}

/**
 * The language to start in: what the guest chose, else what their browser asks for,
 * else French.
 *
 * The stored choice wins over the browser, always. A guest who picked English on a
 * phone whose system language is Spanish meant it, and re-deciding for them on the next
 * screen is the bug this order exists to prevent.
 */
export const detectLocale = (): Locale => {
  const stored = readStoredLocale()
  if (stored !== null) return stored
  const preferences = browserPreferences()
  return preferences.length > 0 ? negotiate(preferences) : DEFAULT_LOCALE
}
