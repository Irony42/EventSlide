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
 * The reader's language, detected once and then owned by the reader.
 *
 * "The reader" is a guest **and** a host, and that is the whole of roadmap 1.5's second
 * half: a host is a person with a browser exactly as a guest is, so the signal that works
 * for one works for the other. One preference, one storage key, one picker.
 *
 * The alternative considered and rejected was an attribute on the *account*. It is worse
 * in both directions, and the moderator on a borrowed phone is the case that decides it:
 * a language that follows the account would be written onto somebody else's device and
 * left there, while a host who hands their laptop to an English-speaking friend for an
 * hour would have to sign out to change it. A language is a property of the reading, not
 * of the person — so it lives where the reading happens, which is
 * `localePreference.ts`'s argument for `localStorage`.
 *
 * Detection runs in the `useState` initialiser rather than in an effect, and that
 * placement is the feature: an effect would paint the join screen in French and then
 * repaint it in German, which on a phone reads as a bug and on a slow one is a visible
 * flash of the wrong language.
 *
 * `<html lang>` is **not** set here. It belongs to `AppShell`, which is the innermost
 * component every screen renders through and therefore the only one that knows which
 * language is actually on the screen — see {@link LocaleOverride}.
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
 * One surface, in a language nobody at that surface chose.
 *
 * This is what `FrenchSurface` became, and the change of name is the change of meaning:
 * it used to answer "which half of the app is translated", and it now answers "which
 * surface has a language of its own". There is exactly one — the projected wall, whose
 * language is a setting on the event because a projector has nobody in front of it to
 * ask (`src/domain/events/eventLanguage.ts` carries that argument).
 *
 * **The guard it inherits is the one worth keeping.** `Dialog`, `ConfirmDialog`, `Field`,
 * `Progress`, `Spinner` and `Toast` are shared primitives that read their copy from the
 * active table, so without a boundary at the top of the surface a wall set to English
 * would render an English panel with a French "Fermer" inside it, taken from whatever the
 * person who launched the projector happens to have in `localStorage`. Half a screen in
 * the reader's language and half in the surface's is a worse failure than either alone,
 * because it looks like a rendering bug rather than a setting — and it is invisible to
 * every test run on a French machine. The boundary is a component in the route table
 * rather than a rule each primitive has to remember, for exactly that reason.
 *
 * The host console no longer needs one. It is translated now, and a host reading their own
 * console in their own language is the point rather than the hazard.
 *
 * `setLocale` is a no-op: nothing on this surface offers a language, and the wall's comes
 * from the event. A picker here would be a control in a room where nobody can reach the
 * keyboard.
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
 * A {@link LocaleOverride} whose language is not known until the surface underneath it
 * says so.
 *
 * The projected wall, and nothing else. Its language is a property of the **event**, so
 * it arrives on the wall response — one round trip after the shell has rendered — and the
 * shell is what has to be told, because `AppShell` owns `<html lang>` and sits above the
 * page that fetches. `deferredLocale.ts` carries the argument, including why the fetch
 * was not hoisted here instead.
 *
 * **Until the response lands, the default.** Not the browser's language, which on a
 * projector is the language of whichever laptop was plugged in and is precisely the
 * answer this whole mechanism exists to avoid; and not a guess, because before the
 * response there is no event, so there is no event language to use. What renders in that
 * window is a visually-hidden spinner label and, if the fetch fails outright, an error
 * screen for the host who is standing at the projector — and that screen only ever
 * appears when there is no event to have a language.
 *
 * So the room never watches the wall change language: the first frame carrying any
 * interface copy at all is already the event's.
 */
export function DeferredLocale({ children }: DeferredLocaleProps) {
  const [announced, setAnnounced] = useState<Locale | null>(null)

  return (
    <announceLocaleContext.Provider value={setAnnounced}>
      <LocaleOverride locale={announced ?? DEFAULT_LOCALE}>{children}</LocaleOverride>
    </announceLocaleContext.Provider>
  )
}
