import { useCallback, useMemo, useState } from 'react'
import { announceLocaleContext } from './deferredLocale'
import { DEFAULT_LOCALE, type Locale } from './locale'
import { localeContext, type LocaleState } from './localeContext'
import { detectLocale, storeLocale } from './localePreference'
import { translationsFor } from './translations'
import type { ReactNode } from 'react'

export interface LocaleProviderProps {
  /**
   * Starts in this language instead of detecting one.
   *
   * For tests, which must not depend on the machine's browser settings, and for nothing
   * in the running app: `main.tsx` passes nothing, so the app detects. It is the
   * *initial* value and not a controlled prop — the picker still works underneath it,
   * which is what lets a component test drive a language change.
   */
  readonly initialLocale?: Locale
  readonly children: ReactNode
}

/**
 * The reader's language — a guest **and** a host — detected once and then owned by them.
 * One preference, one storage key, one picker.
 *
 * **An attribute on the *account* was rejected**, and the moderator on a borrowed phone
 * decides it: a language following the account would be written onto somebody else's
 * device and left there, while an owner lending their laptop for an hour would have to
 * sign out to change it. A language is a property of the reading, which is
 * `localePreference.ts`'s argument for `localStorage`.
 *
 * Detection runs in the `useState` initialiser rather than in an effect: an effect would
 * paint the join screen in French and repaint it in German, a visible flash of the wrong
 * language on a slow phone. `LocaleProvider.test.tsx` pins that.
 *
 * `<html lang>` is **not** set here — it belongs to `AppShell`, the innermost component
 * every screen renders through and so the only one that knows the language on screen.
 */
export function LocaleProvider({ initialLocale, children }: LocaleProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(() => initialLocale ?? detectLocale())

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    storeLocale(next)
  }, [])

  const value = useMemo<LocaleState>(
    () => ({ locale, text: translationsFor(locale), setLocale }),
    [locale, setLocale],
  )

  return <localeContext.Provider value={value}>{children}</localeContext.Provider>
}

export interface LocaleOverrideProps {
  /** The language everything under this point renders in, whatever the reader chose. */
  readonly locale: Locale
  readonly children: ReactNode
}

/**
 * One surface, in a language nobody at that surface chose. What `FrenchSurface` became:
 * it used to answer "which half of the app is translated" and now answers "which surface
 * has a language of its own". There is exactly one, the projected wall.
 *
 * **The guard it inherits is the one worth keeping.** `Dialog`, `Field`, `Progress`,
 * `Toast` and the other shared primitives read the active table, so without a boundary at
 * the top of the surface a wall set to Italian renders a French "Fermer" inside its own
 * panel, taken from whatever the person who launched the projector had stored. Half a
 * screen in each language looks like a rendering bug rather than a setting, and is
 * invisible to every test run on a French machine.
 *
 * `setLocale` is a no-op rather than absent, so a shared control that happens to render
 * here does nothing instead of throwing on a projector.
 */
export function LocaleOverride({ locale, children }: LocaleOverrideProps) {
  const value = useMemo<LocaleState>(
    () => ({ locale, text: translationsFor(locale), setLocale: () => {} }),
    [locale],
  )

  return <localeContext.Provider value={value}>{children}</localeContext.Provider>
}

export interface DeferredLocaleProps {
  readonly children: ReactNode
}

/**
 * A {@link LocaleOverride} whose language is not known until the surface underneath says
 * so. The projected wall, and nothing else — `deferredLocale.ts` has the argument.
 *
 * **Until the response lands, the default.** Not the browser's, which on a projector is
 * the laptop that was plugged in and is the answer this mechanism exists to avoid; and
 * not a guess, because before the response there is no event to have a language. Only a
 * visually-hidden spinner label renders in that window, so the room never watches the
 * wall change language.
 */
export function DeferredLocale({ children }: DeferredLocaleProps) {
  const [announced, setAnnounced] = useState<Locale | null>(null)

  return (
    <announceLocaleContext.Provider value={setAnnounced}>
      <LocaleOverride locale={announced ?? DEFAULT_LOCALE}>{children}</LocaleOverride>
    </announceLocaleContext.Provider>
  )
}
