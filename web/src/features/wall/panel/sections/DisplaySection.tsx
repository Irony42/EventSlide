import { SelectField, type SelectOption } from '../../../../design-system/components/SelectField'
import { Button } from '../../../../design-system/components/Button'
import {
  DEFAULT_RHYTHM_SECONDS,
  MIXED_SLIDESHOW_STEPS_SECONDS,
  MIXED_WALL_STEPS_SECONDS,
  mixedDurationOptions,
} from '../../../../lib/wallDisplayOptions'
import { LOCALE_NAMES, SUPPORTED_LOCALES, parseLocale } from '../../../../lib/i18n/locale'
import { useTranslations } from '../../../../lib/i18n/useTranslations'
import { LayoutTiles } from '../controls/LayoutTiles'
import { OptionCard } from '../controls/OptionCard'
import { RhythmSteps } from '../controls/RhythmSteps'
import type { WallPanelContext, WallPanelSection } from '../panelTypes'

/** Endonyms, never translated: the word chosen is the one the room reads. */
const LANGUAGE_OPTIONS: readonly SelectOption[] = SUPPORTED_LOCALES.map((locale) => ({
  value: locale,
  label: LOCALE_NAMES[locale],
}))

/**
 * "Affichage" (order 10). In this first PR: the wall's language and the guestbook messages on
 * the wall, both settings that already exist. Layout, rhythm, fresh photos, tilt and time arrive
 * with PR 3 to 5, in this same file; spec 09's alternation rows follow the rhythm.
 */
// The file exports a descriptor the registry collects, not its component.
// eslint-disable-next-line react-refresh/only-export-components
function DisplaySection({ settings, save, screen }: WallPanelContext) {
  const t = useTranslations()
  const { wall } = settings

  return (
    <>
      <LayoutTiles value={wall.layout} onChange={(layout) => save({ wall: { layout } })} />
      {/* This screen's own layout beats the event's until it is released (spec 13, rule 6). */}
      {screen.localLayout === null ? null : (
        <p role="status">
          {t.wall.panel.screenShows(screen.layoutName)}{' '}
          <Button size="sm" onClick={screen.localLayout.onReset}>
            {t.wall.panel.backToEvent}
          </Button>
        </p>
      )}
      <RhythmSteps
        valueMs={wall.slideIntervalMs}
        onChange={(slideIntervalMs) => save({ wall: { slideIntervalMs } })}
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
      <OptionCard
        art="fresh"
        label={t.admin.wallDisplay.freshLane}
        checked={wall.freshLane}
        onChange={(freshLane) => save({ wall: { freshLane } })}
      />
      <OptionCard
        art="tilt"
        label={t.admin.wallDisplay.tilt}
        checked={wall.tilt}
        onChange={(tilt) => save({ wall: { tilt } })}
      />
      <OptionCard
        art="time"
        label={t.admin.wallDisplay.showTime}
        checked={wall.showTime}
        onChange={(showTime) => save({ wall: { showTime } })}
      />
      {/* The mixed wall (spec 09): the same rows, bounds and keys as the settings page. */}
      <OptionCard
        art="mixed"
        label={t.admin.wallDisplay.mixed}
        hint={t.admin.wallDisplay.mixedHint}
        checked={wall.mixedEnabled}
        onChange={(mixedEnabled) => save({ wall: { mixedEnabled } })}
      />
      {wall.mixedEnabled ? (
        <>
          <SelectField
            label={t.admin.wallDisplay.mixedWall}
            value={String(wall.mixedWallSeconds)}
            options={mixedDurationOptions(MIXED_WALL_STEPS_SECONDS, wall.mixedWallSeconds)}
            onChange={(value) => save({ wall: { mixedWallSeconds: Number.parseInt(value, 10) } })}
          />
          <SelectField
            label={t.admin.wallDisplay.mixedSlideshow}
            value={String(wall.mixedSlideshowSeconds)}
            options={mixedDurationOptions(
              MIXED_SLIDESHOW_STEPS_SECONDS,
              wall.mixedSlideshowSeconds,
            )}
            onChange={(value) =>
              save({ wall: { mixedSlideshowSeconds: Number.parseInt(value, 10) } })
            }
          />
        </>
      ) : null}
      {/* Only meaningful once the guestbook is open, as on the settings page. */}
      <OptionCard
        art="guestbook"
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
  icon: 'layout',
  summary: (text, { wall }) =>
    [
      wall.layout === null
        ? text.admin.wallDisplay.layoutUnset
        : text.wall.layoutNames[wall.layout],
      text.wall.panel.summaryRhythm(
        wall.slideIntervalMs === null ? DEFAULT_RHYTHM_SECONDS : wall.slideIntervalMs / 1_000,
      ),
    ].join(' · '),
  Component: DisplaySection,
}
