import { createContext } from 'react'
import { DEFAULT_LOCALE, type Locale } from './locale'
import { translationsFor, type UiText } from './translations'

/**
 * The active language, as React state.
 *
 * Its own file, beside `apiContext.ts` and `toastContext.ts`, for the same reason those
 * two have one: a `.tsx` file that exports both a component and a value breaks fast
 * refresh, and the lint rule that says so is right.
 *
 * The default value is the **French table**, not a thrown error. A component rendered
 * outside the provider — an isolated test, a screen mounted from a lazy chunk before the
 * tree is complete — renders French, which is this app's default language and is always
 * a correct thing to show. `useApi` throws in the same position because there is no
 * sensible default API; there is a sensible default language.
 */
export interface LocaleState {
  readonly locale: Locale
  /** Every string in the app, in {@link LocaleState.locale}. */
  readonly text: UiText
  /** Chosen by the guest. Persisted, so it survives the reload. */
  readonly setLocale: (locale: Locale) => void
}

export const localeContext = createContext<LocaleState>({
  locale: DEFAULT_LOCALE,
  text: translationsFor(DEFAULT_LOCALE),
  setLocale: () => {},
})
