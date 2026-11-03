import { DomainError } from '../shared/errors'
import { SlideInterval } from '../slideshow/slideInterval'
import { WALL_LAYOUTS, type WallLayout } from '../slideshow/wallLayout'
import { MIXED_SLIDESHOW_SECONDS, MIXED_WALL_SECONDS } from '../slideshow/wallPhase'

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
  /**
   * The mixed wall (spec 09): the projector alternates the event's layout with one large photo.
   * Off until the host turns it on, for a new event as for an existing one.
   */
  readonly mixedEnabled: boolean
  /** Seconds on the wall layout, 30 to 3600. */
  readonly mixedWallSeconds: number
  /** Seconds on the single large photo, 15 to 1800. */
  readonly mixedSlideshowSeconds: number
  /**
   * Server time at which the phases were last restarted. **Written by `updateEventSettings`
   * only**: no route schema carries it, so a request cannot choose the phase.
   */
  readonly mixedAnchorMs: number | null
}

export type EventWallSettingsPatch = Partial<EventWallSettings>

export const DEFAULT_WALL_SETTINGS: EventWallSettings = {
  layout: null,
  slideIntervalMs: null,
  mixedEnabled: false,
  mixedWallSeconds: MIXED_WALL_SECONDS.default,
  mixedSlideshowSeconds: MIXED_SLIDESHOW_SECONDS.default,
  mixedAnchorMs: null,
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
  mixedEnabled: patch?.mixedEnabled === undefined ? base.mixedEnabled : patch.mixedEnabled,
  mixedWallSeconds:
    patch?.mixedWallSeconds === undefined ? base.mixedWallSeconds : patch.mixedWallSeconds,
  mixedSlideshowSeconds:
    patch?.mixedSlideshowSeconds === undefined
      ? base.mixedSlideshowSeconds
      : patch.mixedSlideshowSeconds,
  mixedAnchorMs: patch?.mixedAnchorMs === undefined ? base.mixedAnchorMs : patch.mixedAnchorMs,
})

const outside = (value: number, bounds: { min: number; max: number }): 'short' | 'long' | null =>
  !Number.isInteger(value) || value < bounds.min ? 'short' : value > bounds.max ? 'long' : null

/** The mixed wall's bounds hold even while it is off, so a stored value is always sound. */
const mixedViolation = (wall: EventWallSettings): DomainError | null => {
  const wallSide = outside(wall.mixedWallSeconds, MIXED_WALL_SECONDS)
  if (wallSide !== null) {
    return DomainError.invalid(
      wallSide === 'short' ? 'wallMixed.wallTooShort' : 'wallMixed.wallTooLong',
    )
  }
  const slideshowSide = outside(wall.mixedSlideshowSeconds, MIXED_SLIDESHOW_SECONDS)
  if (slideshowSide !== null) {
    return DomainError.invalid(
      slideshowSide === 'short' ? 'wallMixed.slideshowTooShort' : 'wallMixed.slideshowTooLong',
    )
  }
  return null
}

/** The refusal of a host's choice, with the interval's own codes (`slideInterval.tooShort`, ...). */
export const wallSettingsViolation = (wall: EventWallSettings): DomainError | null => {
  if (wall.layout !== null && !isWallLayout(wall.layout)) {
    return DomainError.invalid('eventSettings.wallLayoutInvalid')
  }
  const mixed = mixedViolation(wall)
  if (mixed !== null) return mixed
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
  const wallSeconds = record['mixedWallSeconds']
  const slideshowSeconds = record['mixedSlideshowSeconds']
  const anchor = record['mixedAnchorMs']
  return {
    layout: isWallLayout(layout) ? layout : DEFAULT_WALL_SETTINGS.layout,
    slideIntervalMs:
      typeof interval === 'number' && SlideInterval.create(interval).ok
        ? interval
        : DEFAULT_WALL_SETTINGS.slideIntervalMs,
    // An absent key reads "off": an event saved by 3.5.0 keeps the wall it had.
    mixedEnabled: record['mixedEnabled'] === true,
    mixedWallSeconds:
      typeof wallSeconds === 'number' && outside(wallSeconds, MIXED_WALL_SECONDS) === null
        ? wallSeconds
        : DEFAULT_WALL_SETTINGS.mixedWallSeconds,
    mixedSlideshowSeconds:
      typeof slideshowSeconds === 'number' &&
      outside(slideshowSeconds, MIXED_SLIDESHOW_SECONDS) === null
        ? slideshowSeconds
        : DEFAULT_WALL_SETTINGS.mixedSlideshowSeconds,
    mixedAnchorMs:
      typeof anchor === 'number' && Number.isFinite(anchor)
        ? anchor
        : DEFAULT_WALL_SETTINGS.mixedAnchorMs,
  }
}
