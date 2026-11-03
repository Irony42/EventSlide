import { DomainError } from '../shared/errors'
import { SlideInterval } from '../slideshow/slideInterval'
import { WALL_LAYOUTS, type WallLayout } from '../slideshow/wallLayout'

/**
 * What the host decides about how the projected wall behaves, for every screen of the event
 * (spec 13). One flat object, one level deep, in the `wall` key of `events.settings`.
 *
 * **Merged field by field, unlike `theme`.** The panel on the wall and the settings page write
 * at different moments, each sending only what it changed; replacing the object whole would let
 * a save from one erase a choice made on the other. `mergeWallSettings` is that rule.
 *
 * **Every default is today's behaviour**, for an event that exists and for a new one: `null` on
 * the layout is "the chain the wall already used" (the screen's own choice, the ambiance's
 * suggestion, then the default), `null` on the interval is the 8 s default. Nothing changes on a
 * wall until its host chooses.
 *
 * Later specs (09, 11, 12, 14) add their keys here, flat, each with a default of "as before".
 */
export interface EventWallSettings {
  /** `null`: nothing chosen for the event, the screen decides as it always did. */
  readonly layout: WallLayout | null
  /** `null`: the {@link SlideInterval} default. Otherwise 2 s to 10 min. Ken Burns stays derived. */
  readonly slideIntervalMs: number | null
  /* ---- Spec 11: the souvenir counter and the new-photo signal. Both off unless the host asks. ---- */
  /** Show « n souvenirs partagés » at the top centre of the wall. */
  readonly souvenirCounter: boolean
  /** Announce, briefly, that photos or clips have just become visible on the wall. */
  readonly newPhotoSignal: boolean
}

export type EventWallSettingsPatch = Partial<EventWallSettings>

export const DEFAULT_WALL_SETTINGS: EventWallSettings = {
  layout: null,
  slideIntervalMs: null,
  souvenirCounter: false,
  newPhotoSignal: false,
}

export const isWallLayout = (value: unknown): value is WallLayout =>
  typeof value === 'string' && (WALL_LAYOUTS as readonly string[]).includes(value)

/** The stored object with the patch's own keys applied: an absent key leaves the stored one alone. */
export const mergeWallSettings = (
  base: EventWallSettings,
  patch: EventWallSettingsPatch | undefined,
): EventWallSettings => ({
  layout: patch?.layout === undefined ? base.layout : patch.layout,
  slideIntervalMs:
    patch?.slideIntervalMs === undefined ? base.slideIntervalMs : patch.slideIntervalMs,
  souvenirCounter: patch?.souvenirCounter ?? base.souvenirCounter,
  newPhotoSignal: patch?.newPhotoSignal ?? base.newPhotoSignal,
})

/** The refusal of a host's choice, with the interval's own codes (`slideInterval.tooShort`, ...). */
export const wallSettingsViolation = (wall: EventWallSettings): DomainError | null => {
  if (wall.layout !== null && !isWallLayout(wall.layout)) {
    return DomainError.invalid('eventSettings.wallLayoutInvalid')
  }
  if (wall.slideIntervalMs === null) return null
  const interval = SlideInterval.create(wall.slideIntervalMs)
  return interval.ok ? null : interval.error
}

/**
 * Reads the stored `wall` object **tolerantly**: a field that is absent or unreadable takes its
 * default and nothing throws. A display preference must not be able to fail `findById` and take
 * the wall down, which is the principle `useLayoutParam` applies to a bad `?layout=`. The other
 * settings throw `corrupt` on purpose (a policy silently defaulted is a worse failure); this
 * group holds no policy.
 */
export const restoreWallSettings = (raw: unknown): EventWallSettings => {
  const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const layout = record['layout']
  const interval = record['slideIntervalMs']
  return {
    layout: isWallLayout(layout) ? layout : DEFAULT_WALL_SETTINGS.layout,
    slideIntervalMs:
      typeof interval === 'number' && SlideInterval.create(interval).ok
        ? interval
        : DEFAULT_WALL_SETTINGS.slideIntervalMs,
    // Only a stored `true` turns them on: absent or unreadable is off, as before spec 11.
    souvenirCounter: record['souvenirCounter'] === true,
    newPhotoSignal: record['newPhotoSignal'] === true,
  }
}
