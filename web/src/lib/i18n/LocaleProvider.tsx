import { useCallback, useMemo, useState } from 'react'
import { fr } from './fr'
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
 * The guest's language, detected once and then owned by the guest.
 *
 * Detection runs in the `useState` initialiser rather than in an effect, and that
 * placement is the feature: an effect would paint the join screen in French and then
 * repaint it in German, which on a phone reads as a bug and on a slow one is a visible
 * flash of the wrong language.
 *
 * `<html lang>` is **not** set here. It belongs to `AppShell`, which is the innermost
 * component every screen renders through and therefore the only one that knows which
 * language is actually on the screen — see {@link FrenchSurface}.
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

/**
 * French, whatever the browser asked for.
 *
 * The host console and the projected wall are not translated, and without this they
 * would be *half* translated: `Dialog`, `ConfirmDialog`, `Field`, `Progress` and `Toast`
 * are shared primitives that read their copy from the active table, so a host whose
 * browser is set to English would have got "Cancel" and "Confirm" inside an otherwise
 * French moderation dialog — and would have got it without ever choosing anything,
 * because detection reads `navigator.languages`.
 *
 * So the host and wall layouts re-provide French, and the boundary is a component in the
 * route table rather than a rule each primitive has to remember. A guest's choice stops
 * exactly where the guest surface stops.
 */
const FRENCH: LocaleState = {
  locale: DEFAULT_LOCALE,
  text: fr,
  // Nothing on a host or wall surface offers a language, so there is nothing to set.
  setLocale: () => {},
}

export interface FrenchSurfaceProps {
  readonly children: ReactNode
}

export function FrenchSurface({ children }: FrenchSurfaceProps) {
  return <localeContext.Provider value={FRENCH}>{children}</localeContext.Provider>
}
