import { CheckboxField } from '../../../admin/components/CheckboxField'
import { SelectField, type SelectOption } from '../../../admin/components/SelectField'
import { LOCALE_NAMES, SUPPORTED_LOCALES, parseLocale } from '../../../../lib/i18n/locale'
import { useTranslations } from '../../../../lib/i18n/useTranslations'
import type { WallPanelContext, WallPanelSection } from '../panelTypes'

/** Endonyms, never translated: the word chosen is the one the room reads. */
const LANGUAGE_OPTIONS: readonly SelectOption[] = SUPPORTED_LOCALES.map((locale) => ({
  value: locale,
  label: LOCALE_NAMES[locale],
}))

/**
 * "Affichage" (order 10). In this first PR: the wall's language and the guestbook messages on
 * the wall, both settings that already exist. Layout, rhythm, fresh photos, tilt and time arrive
 * with PR 3 to 5, in this same file; spec 09 adds its alternation rows here too.
 */
function DisplaySection({ settings, save }: WallPanelContext) {
  const t = useTranslations()

  return (
    <>
      <SelectField
        label={t.admin.wallLanguage}
        value={settings.wallLanguage}
        options={LANGUAGE_OPTIONS}
        onChange={(value) => {
          // Parsed, not cast: the value comes back from the DOM as a bare string.
          const chosen = parseLocale(value)
          if (chosen !== null) save({ wallLanguage: chosen })
        }}
      />
      {/* Only meaningful once the guestbook is open, as on the settings page. */}
      <CheckboxField
        label={t.admin.guestbookOnWall}
        checked={settings.guestbookOnWall}
        disabled={!settings.allowGuestbook}
        onChange={(guestbookOnWall) => save({ guestbookOnWall })}
      />
    </>
  )
}

export const section: WallPanelSection = {
  id: 'display',
  order: 10,
  title: (text) => text.wall.panel.sectionDisplay,
  Component: DisplaySection,
}
