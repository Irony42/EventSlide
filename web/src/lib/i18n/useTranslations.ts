import { useContext } from 'react'
import { localeContext, type LocaleState } from './localeContext'
import type { UiText } from './translations'

/**
 * The copy a component renders, in the language of the surface it is on.
 *
 * `const t = useTranslations()` then `t.upload.send`, which is the same shape the
 * `fr.upload.send` it replaces had — so a component's diff is an import and one line.
 * **Every** component reads from here now, guest, host and wall alike; a file that still
 * imports `fr` directly is either a test stating the French wording on purpose or a bug.
 *
 * Which language that is depends on where the component is mounted, and that is the point
 * of reading it from the tree rather than importing it: under the guest and host layouts
 * it is the reader's own preference, and under the wall's it is the event's own setting.
 * A component never has to know which.
 *
 * A module that is not a component and not a hook cannot call this — it takes `UiText` as
 * a parameter instead. `features/wall/photoAlt.ts` is the worked example.
 */
export const useTranslations = (): UiText => useContext(localeContext).text

/**
 * The same, plus the locale itself and the setter.
 *
 * Three callers: the language picker, `AppShell` (which puts the locale on `<html lang>`)
 * and the create-event form, which reads it once to seed the new event's wall language.
 */
export const useLocale = (): LocaleState => useContext(localeContext)
