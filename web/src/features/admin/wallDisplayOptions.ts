import type { EventSettingsDto, WallLayout } from '../../lib/api/dto'
import type { UiText } from '../../lib/i18n/translations'
import type { SelectOption } from './components/SelectField'

/**
 * The wall group of an event's settings, as the settings page and the wall's own panel (spec 13)
 * both read and write it: same options, same labels, so a host sees one vocabulary.
 */
export type WallSettingsDto = EventSettingsDto['wall']

/** The empty option of both selects: nothing chosen for the event, the screen decides as before. */
export const WALL_UNSET = ''

/** Steps offered for the rhythm, in seconds. 8 is the default and is the `null` option. */
export const RHYTHM_STEPS_SECONDS: readonly number[] = [4, 6, 12, 20, 30]

export const wallLayoutOptions = (text: UiText): readonly SelectOption[] => [
  { value: WALL_UNSET, label: text.admin.wallDisplay.layoutUnset },
  // The table's own keys, which `satisfies Record<WallLayout, string>` keeps equal to the layouts.
  ...(Object.keys(text.wall.layoutNames) as WallLayout[]).map((layout) => ({
    value: layout,
    label: text.wall.layoutNames[layout],
  })),
]

/** A rhythm the server already holds that is not one of the steps is shown as it is, never rewritten. */
export const wallRhythmOptions = (
  text: UiText,
  current: number | null,
): readonly SelectOption[] => {
  const steps = RHYTHM_STEPS_SECONDS.map((seconds) => ({
    value: String(seconds * 1_000),
    label: text.admin.wallDisplay.intervalSeconds(seconds),
  }))
  const known = current === null || steps.some((step) => step.value === String(current))
  return [
    { value: WALL_UNSET, label: text.admin.wallDisplay.intervalDefault },
    ...steps,
    ...(known
      ? []
      : [
          {
            value: String(current),
            label: text.admin.wallDisplay.intervalSeconds(current / 1_000),
          },
        ]),
  ]
}

/** Whole seconds as a person reads them: "45 s", "3 min". The same abbreviations in the five languages. */
const durationLabel = (seconds: number): string =>
  seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds} s`

/** Steps for the time on the wall (30 s to 60 min) and on the slideshow (15 s to 30 min). */
export const MIXED_WALL_STEPS_SECONDS: readonly number[] = [
  30, 60, 120, 180, 300, 600, 900, 1_800, 3_600,
]
export const MIXED_SLIDESHOW_STEPS_SECONDS: readonly number[] = [
  15, 30, 60, 120, 180, 300, 600, 1_800,
]

/**
 * A closed list of durations, every one inside the server's bounds. A value the server already
 * holds that is not a step (set through the API) is shown as it is, never rewritten.
 */
export const mixedDurationOptions = (
  steps: readonly number[],
  current: number,
): readonly SelectOption[] =>
  [...new Set([...steps, current])]
    .sort((a, b) => a - b)
    .map((seconds) => ({ value: String(seconds), label: durationLabel(seconds) }))

/**
 * Only the `wall` keys that differ from what the page loaded. The panel on the wall writes the
 * same group at other moments, and sending the whole object would erase what it changed in
 * between (the server merges per key, so the page must send per key). `undefined` when nothing
 * changed: the patch then carries no `wall` at all.
 */
export const wallChanges = (
  draft: WallSettingsDto,
  loaded: WallSettingsDto,
): Partial<WallSettingsDto> | undefined => {
  const changes: { -readonly [K in keyof WallSettingsDto]?: WallSettingsDto[K] } = {}
  if (draft.layout !== loaded.layout) changes.layout = draft.layout
  if (draft.slideIntervalMs !== loaded.slideIntervalMs) {
    changes.slideIntervalMs = draft.slideIntervalMs
  }
  if (draft.mixedEnabled !== loaded.mixedEnabled) changes.mixedEnabled = draft.mixedEnabled
  if (draft.mixedWallSeconds !== loaded.mixedWallSeconds) {
    changes.mixedWallSeconds = draft.mixedWallSeconds
  }
  if (draft.mixedSlideshowSeconds !== loaded.mixedSlideshowSeconds) {
    changes.mixedSlideshowSeconds = draft.mixedSlideshowSeconds
  }
  if (draft.souvenirCounter !== loaded.souvenirCounter) {
    changes.souvenirCounter = draft.souvenirCounter
  }
  if (draft.newPhotoSignal !== loaded.newPhotoSignal) changes.newPhotoSignal = draft.newPhotoSignal
  if (draft.freshLane !== loaded.freshLane) changes.freshLane = draft.freshLane
  if (draft.tilt !== loaded.tilt) changes.tilt = draft.tilt
  if (draft.showTime !== loaded.showTime) changes.showTime = draft.showTime
  return Object.keys(changes).length === 0 ? undefined : changes
}
