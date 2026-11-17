import { isVisibleOnWall, PHOTO_STATUSES, type PhotoStatus } from '../photos/photoStatus'
import { DomainError } from '../shared/errors'

/**
 * The reveal gate of an "appareil jetable" event (spec 23): the guests photograph without
 * seeing the result, and everything is shown at once. One flat object in the `reveal` key of
 * `events.settings`, **merged field by field** like `wall` (spec 13): a save that names `film`
 * must not be able to forget the hour.
 *
 * **A gate on the event, not a state of a photo.** Moderation stays the gate per photo
 * (`published` or not); this one is in front of it, for every reader that is not a moderator:
 * a photo is visible to the public when it is `published` **and** the evening is revealed
 * ({@link visibleStatuses}). No photo status was added and the moderation machine is untouched
 * (docs/adr/0013-reveal-gate.md).
 *
 * **A function of the clock read at the request.** Nothing sweeps, nothing is scheduled and
 * nothing is stored on a photo: "revealed" is `isRevealed(reveal, now)` with the server's
 * clock, so a restart at 22:59 changes nothing at 23:00, and no migration exists. An event that
 * predates the field has no `reveal` key and reads as `enabled: false` (`settingsOf`).
 */
export interface EventRevealSettings {
  /** `false`: the event behaves as it always did, every photo is public once published. */
  readonly enabled: boolean
  /** `null`: no hour, the host reveals with the button (which writes `at = now`). */
  readonly at: Date | null
  /** The film look, an **on-screen** filter that never touches a byte (spec 23 rule 11). */
  readonly film: boolean
}

export type EventRevealSettingsPatch = Partial<EventRevealSettings>

export const DEFAULT_REVEAL_SETTINGS: EventRevealSettings = {
  enabled: false,
  at: null,
  film: false,
}

/** The stored object with the patch's own keys applied: an absent key leaves the stored one alone. */
export const mergeRevealSettings = (
  base: EventRevealSettings,
  patch: EventRevealSettingsPatch | undefined,
): EventRevealSettings => ({
  enabled: patch?.enabled === undefined ? base.enabled : patch.enabled,
  at: patch?.at === undefined ? base.at : patch.at,
  film: patch?.film === undefined ? base.film : patch.film,
})

const isRealInstant = (at: Date | null): boolean => at === null || Number.isFinite(at.getTime())

/** The shape of what is stored: a real instant, or none. Whether it may *move* is {@link revealChangeViolation}. */
export const revealSettingsViolation = (reveal: EventRevealSettings): DomainError | null =>
  isRealInstant(reveal.at) ? null : DomainError.invalid('eventSettings.revealInstantInvalid')

/**
 * Whether the evening has been revealed at `now`: **the one rule**, asked with the server's
 * clock (never a phone's). Off is revealed, no hour is not revealed, and the hour itself is
 * inclusive: at the exact instant it is revealed.
 */
export const isRevealed = (reveal: EventRevealSettings, now: Date): boolean =>
  !reveal.enabled || (reveal.at !== null && reveal.at.getTime() <= now.getTime())

/** What the public may be shown of a revealed evening: what the wall shows, `published`. */
const PUBLIC_STATUSES: readonly PhotoStatus[] = PHOTO_STATUSES.filter(isVisibleOnWall)

/**
 * The statuses a **public** reader (the wall, the guests' feed, the podium, the reactions, the
 * shared gallery, the media route for a non-moderator) may ask for at `now`: none before the
 * reveal, `published` after it. A reader asks this instead of holding a constant, so there is one
 * door and not eight; `publicReaders.guard.test.ts` fails on a use case that reads published
 * photographs without it.
 */
export const visibleStatuses = (reveal: EventRevealSettings, now: Date): readonly PhotoStatus[] =>
  isRevealed(reveal, now) ? PUBLIC_STATUSES : []

const sameInstant = (a: Date | null, b: Date | null): boolean =>
  a === null || b === null ? a === b : a.getTime() === b.getTime()

/**
 * The refusal of a host's **choice** of the hour, judged once, when it is made (spec 23 rules 3
 * and 4), and only when the hour changes: the same form sent back whole, with the hour it already
 * holds, passes whatever the clock says.
 *
 * - **One way.** Once the hour has gone by, it cannot be moved to the future or cleared
 *   (`eventSettings.revealDone`): a photograph the room has seen is not hidden again, and
 *   promising more would be dishonest. The host can still switch the mode off.
 * - **A future hour only** (`eventSettings.revealInPast`), as `scheduledCloseAt` is refused when
 *   it names a past minute. "Reveal now" is not a choice of hour: it writes `at = now` through
 *   {@link revealNow}, which is why it never meets this rule.
 */
export const revealChangeViolation = (
  before: EventRevealSettings,
  after: EventRevealSettings,
  now: Date,
): DomainError | null => {
  if (sameInstant(before.at, after.at)) return null

  const nowMs = now.getTime()
  const done = before.at !== null && before.at.getTime() <= nowMs
  if (done && (after.at === null || after.at.getTime() > nowMs)) {
    return DomainError.conflict('eventSettings.revealDone')
  }
  if (after.at !== null && after.at.getTime() <= nowMs) {
    return DomainError.invalid('eventSettings.revealInPast')
  }
  return null
}

/** The settings once "Révéler maintenant" was pressed: the hour is now. */
export const revealNow = (reveal: EventRevealSettings, now: Date): EventRevealSettings => ({
  ...reveal,
  at: new Date(now.getTime()),
})

/**
 * Reads the stored `reveal` value. `undefined` (an event that predates the field) is the default,
 * which is a **read, not a migration**; anything else must have exactly the stored shape, or
 * `null` says it has not. Strict on purpose, unlike the wall's display preferences: a gate that
 * defaults to "open" when it cannot be read would publish the evening, so a malformed value
 * refuses the read of the event (`corrupt`) instead.
 */
export const restoreRevealSettings = (raw: unknown): EventRevealSettings | null => {
  if (raw === undefined) return DEFAULT_REVEAL_SETTINGS
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null

  const record = raw as Record<string, unknown>
  const { enabled, film, at } = record
  if (typeof enabled !== 'boolean' || typeof film !== 'boolean') return null
  if (at === null) return { enabled, at: null, film }
  if (typeof at !== 'string') return null

  const instant = new Date(at)
  return Number.isFinite(instant.getTime()) ? { enabled, at: instant, film } : null
}
