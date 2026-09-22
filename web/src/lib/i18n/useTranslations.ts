import { useContext } from 'react'
import { localeContext, type LocaleState } from './localeContext'
import type { UiText } from './translations'

/**
 * The copy a component renders, in the language of the surface it is on.
 *
 * **Every** component reads from here — a file that still imports `fr` directly is either
 * a test stating the French wording on purpose or a bug. Which language it is depends on
 * where the component is mounted, which is the point of reading it from the tree: the
 * reader's preference under the guest and host layouts, the event's setting under the
 * wall's, and no component has to know which.
 *
 * A module that is not a component and not a hook takes `UiText` as a parameter instead —
 * `features/wall/photoAlt.ts` is the worked example.
 */
export const useTranslations = (): UiText => useContext(localeContext).text

/**
 * The same, plus the locale itself and the setter. Three callers: the language picker,
 * `AppShell` (which puts the locale on `<html lang>`) and the create-event form, which
 * reads it once to seed the new event's wall language.
 */
export const useLocale = (): LocaleState => useContext(localeContext)
