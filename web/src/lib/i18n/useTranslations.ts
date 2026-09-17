import { useContext } from 'react'
import { localeContext, type LocaleState } from './localeContext'
import type { UiText } from './translations'

/**
 * The copy a component renders, in the language the guest is reading.
 *
 * `const t = useTranslations()` then `t.upload.send`, which is the same shape the
 * `fr.upload.send` it replaces had — so a guest-facing component's diff is an import and
 * one line, and a host-facing component keeps importing `fr` directly because its copy
 * is French in every language.
 */
export const useTranslations = (): UiText => useContext(localeContext).text

/** The same, plus the locale itself and the setter. Only the language picker needs it. */
export const useLocale = (): LocaleState => useContext(localeContext)
