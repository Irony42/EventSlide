import { CheckboxField } from '../../../admin/components/CheckboxField'
import { SelectField, type SelectOption } from '../../../admin/components/SelectField'
import { Button } from '../../../../design-system/components/Button'
import { WALL_UNSET, wallLayoutOptions, wallRhythmOptions } from '../../../admin/wallDisplayOptions'
import type { WallLayout } from '../../../../lib/api/dto'
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
// The file exports a descriptor the registry collects, not its component.
// eslint-disable-next-line react-refresh/only-export-components
function DisplaySection({ settings, save, screen }: WallPanelContext) {
  const t = useTranslations()
  const { wall } = settings

  return (
    <>
      <SelectField
        label={t.admin.wallDisplay.layout}
        value={wall.layout ?? WALL_UNSET}
        options={wallLayoutOptions(t)}
        onChange={(value) => {
          const known = wallLayoutOptions(t).some((o) => o.value === value && value !== WALL_UNSET)
          save({ wall: { layout: known ? (value as WallLayout) : null } })
        }}
      />
      {/* This screen's own layout beats the event's until it is released (spec 13, rule 6). */}
      {screen.localLayout === null ? null : (
        <p role="status">
          {t.wall.panel.screenShows(screen.layoutName)}{' '}
          <Button size="sm" onClick={screen.localLayout.onReset}>
            {t.wall.panel.backToEvent}
          </Button>
        </p>
      )}
      <SelectField
        label={t.admin.wallDisplay.interval}
        value={wall.slideIntervalMs === null ? WALL_UNSET : String(wall.slideIntervalMs)}
        options={wallRhythmOptions(t, wall.slideIntervalMs)}
        onChange={(value) =>
          save({
            wall: { slideIntervalMs: value === WALL_UNSET ? null : Number.parseInt(value, 10) },
          })
        }
      />
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
      <CheckboxField
        label={t.admin.wallDisplay.freshLane}
        checked={wall.freshLane}
        onChange={(freshLane) => save({ wall: { freshLane } })}
      />
      <CheckboxField
        label={t.admin.wallDisplay.tilt}
        checked={wall.tilt}
        onChange={(tilt) => save({ wall: { tilt } })}
      />
      <CheckboxField
        label={t.admin.wallDisplay.showTime}
        checked={wall.showTime}
        onChange={(showTime) => save({ wall: { showTime } })}
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
