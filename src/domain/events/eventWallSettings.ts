import { DomainError } from '../shared/errors'
import { SlideInterval } from '../slideshow/slideInterval'
import { WALL_LAYOUTS, type WallLayout } from '../slideshow/wallLayout'
import {
  DEFAULT_WALL_QR_PLACEMENT,
  DEFAULT_WALL_QR_SCALE,
  isWallQrPlacement,
  isWallQrScale,
  type WallQrPlacement,
} from './wallJoinCard'
import {
  DEFAULT_WALL_SOUND,
  isWallSoundTone,
  isWallSoundVolume,
  readWallSound,
  type WallSoundTone,
} from './wallSound'

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
  /** The invitation card on a populated wall (spec 14). `false` hides it for good; `Q` stays temporary. */
  readonly qrVisible: boolean
  /** The card's scale, 0.8 to 1.5 in steps of 0.05; 1 is today's card (decision 14-6). */
  readonly qrScale: number
  readonly qrPlacement: WallQrPlacement
  /** Spec 12. Off by default, always: the wall plays nothing unless the host turned it on. */
  readonly soundEnabled: boolean
  readonly soundTone: WallSoundTone
  /** A whole number, 0 to 100. */
  readonly soundVolume: number
}

/**
 * Whether the wall's read must pay for the total of visible souvenirs (spec 11, shared with the
 * arrival sound of spec 12, whose switch is the third here). Off for every switch: no query.
 */
export const wallNeedsSouvenirCount = (wall: EventWallSettings): boolean =>
  wall.souvenirCounter || wall.newPhotoSignal || wall.soundEnabled

export type EventWallSettingsPatch = Partial<EventWallSettings>

export const DEFAULT_WALL_SETTINGS: EventWallSettings = {
  layout: null,
  slideIntervalMs: null,
  souvenirCounter: false,
  newPhotoSignal: false,
  qrVisible: true,
  qrScale: DEFAULT_WALL_QR_SCALE,
  qrPlacement: DEFAULT_WALL_QR_PLACEMENT,
  soundEnabled: DEFAULT_WALL_SOUND.enabled,
  soundTone: DEFAULT_WALL_SOUND.tone,
  soundVolume: DEFAULT_WALL_SOUND.volume,
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
  qrVisible: patch?.qrVisible === undefined ? base.qrVisible : patch.qrVisible,
  qrScale: patch?.qrScale === undefined ? base.qrScale : patch.qrScale,
  qrPlacement: patch?.qrPlacement === undefined ? base.qrPlacement : patch.qrPlacement,
  soundEnabled: patch?.soundEnabled === undefined ? base.soundEnabled : patch.soundEnabled,
  soundTone: patch?.soundTone === undefined ? base.soundTone : patch.soundTone,
  soundVolume: patch?.soundVolume === undefined ? base.soundVolume : patch.soundVolume,
})

/** The refusal of a host's choice, with the interval's own codes (`slideInterval.tooShort`, ...). */
export const wallSettingsViolation = (wall: EventWallSettings): DomainError | null => {
  if (wall.layout !== null && !isWallLayout(wall.layout)) {
    return DomainError.invalid('eventSettings.wallLayoutInvalid')
  }
  if (!isWallQrScale(wall.qrScale)) return DomainError.invalid('eventSettings.wallQrScaleInvalid')
  if (!isWallQrPlacement(wall.qrPlacement)) {
    return DomainError.invalid('eventSettings.wallQrPlacementInvalid')
  }
  if (!isWallSoundTone(wall.soundTone))
    return DomainError.invalid('eventSettings.wallSoundToneInvalid')
  if (!isWallSoundVolume(wall.soundVolume)) {
    return DomainError.invalid('eventSettings.wallSoundVolumeInvalid')
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
    qrVisible:
      typeof record['qrVisible'] === 'boolean'
        ? record['qrVisible']
        : DEFAULT_WALL_SETTINGS.qrVisible,
    qrScale: isWallQrScale(record['qrScale']) ? record['qrScale'] : DEFAULT_WALL_SETTINGS.qrScale,
    qrPlacement: isWallQrPlacement(record['qrPlacement'])
      ? record['qrPlacement']
      : DEFAULT_WALL_SETTINGS.qrPlacement,
    ...restoreSound(record),
  }
}

const restoreSound = (record: Record<string, unknown>) => {
  const sound = readWallSound(record)
  return { soundEnabled: sound.enabled, soundTone: sound.tone, soundVolume: sound.volume }
}
