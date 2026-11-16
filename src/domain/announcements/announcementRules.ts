import { DomainError } from '../shared/errors'
import { err, ok, type Result } from '../shared/result'

/**
 * The closed vocabulary and the numbers of a scheduled announcement (spec 21, rules 2 to 4, 14
 * and 18). Pure: every bound is a fact of the domain, never a setting of a host or an instance.
 */

export const ANNOUNCEMENT_KINDS = ['fullscreen', 'discreet'] as const

/**
 * `fullscreen`: a card in the middle of the wall for a few seconds, with an optional countdown
 * before it. `discreet`: a short text laid over the photographs while the slideshow goes on.
 */
export type AnnouncementKind = (typeof ANNOUNCEMENT_KINDS)[number]

export const DEFAULT_ANNOUNCEMENT_KIND: AnnouncementKind = 'fullscreen'

/** Absent means `fullscreen`, so a client that never heard of the kind keeps working. */
export const parseAnnouncementKind = (raw: unknown): Result<AnnouncementKind, DomainError> => {
  if (raw === undefined) return ok(DEFAULT_ANNOUNCEMENT_KIND)
  return (ANNOUNCEMENT_KINDS as readonly unknown[]).includes(raw)
    ? ok(raw as AnnouncementKind)
    : err(DomainError.invalid('announcement.kindInvalid'))
}

/**
 * How long an announcement stays on the wall, by kind. The 30 minutes of a discreet one is the
 * same fact as `MAX_CHALLENGE_SECONDS`: it is what stops a discreet announcement from becoming
 * an ornament (ADR 0010, principle 9).
 */
export const ANNOUNCEMENT_DURATION_SECONDS: Readonly<
  Record<
    AnnouncementKind,
    { readonly min: number; readonly max: number; readonly default: number }
  >
> = {
  fullscreen: { min: 10, max: 120, default: 30 },
  discreet: { min: 5 * 60, max: 30 * 60, default: 15 * 60 },
}

/** The countdowns a fullscreen announcement may carry, in seconds; the first is "none". */
export const ANNOUNCEMENT_COUNTDOWN_SECONDS: readonly number[] = [0, 60, 300, 600, 900]

/** The countdown of a scheduled fullscreen announcement the host did not choose. */
export const DEFAULT_SCHEDULED_COUNTDOWN_SECONDS = 300

/** The history ceiling. A compromised moderator account must not be able to fill the table. */
export const MAX_ANNOUNCEMENTS_PER_EVENT = 50

/** An hour typed to the minute ("22:00" at 22:00:30) is still accepted this long after. */
export const ANNOUNCEMENT_PAST_TOLERANCE_MS = 60_000

/** How far ahead an announcement may be scheduled. */
export const ANNOUNCEMENT_MAX_AHEAD_MS = 60 * 24 * 60 * 60 * 1000

/** Two discreet announcements are at least this far apart: the wall is bare again in between. */
export const DISCREET_GAP_MS = 60_000

/** Whether an event holding `existing` announcements may take one more (the ceiling is a count). */
export const hasRoomForAnnouncement = (existing: number, ceiling: number): boolean =>
  existing < ceiling

/**
 * Whole seconds, within the bounds **of the kind**. Anything else is a `400`, never clamped: 300
 * seconds for a fullscreen card, or 60 for a discreet one, is refused.
 */
export const parseAnnouncementDuration = (
  kind: AnnouncementKind,
  raw: unknown,
): Result<number, DomainError> => {
  const { min, max } = ANNOUNCEMENT_DURATION_SECONDS[kind]
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= min && raw <= max
    ? ok(raw)
    : err(DomainError.invalid('announcement.durationInvalid', { kind, min, max }))
}

/**
 * One of {@link ANNOUNCEMENT_COUNTDOWN_SECONDS}; a discreet announcement takes only 0, which the
 * domain imposes (and a `CHECK` repeats in the database): it already lasts, and waiting is not
 * what it says.
 */
export const parseAnnouncementCountdown = (
  kind: AnnouncementKind,
  raw: unknown,
): Result<number, DomainError> => {
  const allowed = kind === 'fullscreen' ? ANNOUNCEMENT_COUNTDOWN_SECONDS : [0]
  return typeof raw === 'number' && allowed.includes(raw)
    ? ok(raw)
    : err(DomainError.invalid('announcement.countdownInvalid', { kind, allowed: allowed.join(',') }))
}

/**
 * Whether `at` is a moment an announcement may be set to: a real date, **no more than 60
 * seconds in the past** and **no more than 60 days ahead**, both bounds inclusive.
 */
export const isAnnouncementInstant = (at: Date, now: Date): boolean => {
  const atMs = at.getTime()
  if (Number.isNaN(atMs)) return false
  const nowMs = now.getTime()
  return atMs >= nowMs - ANNOUNCEMENT_PAST_TOLERANCE_MS && atMs <= nowMs + ANNOUNCEMENT_MAX_AHEAD_MS
}

/** An ISO 8601 string as an instant the host may choose, or `400 announcement.atInvalid`. */
export const parseAnnouncementInstant = (raw: unknown, now: Date): Result<Date, DomainError> => {
  const invalid = (): DomainError =>
    DomainError.invalid('announcement.atInvalid', {
      pastToleranceSeconds: ANNOUNCEMENT_PAST_TOLERANCE_MS / 1000,
      maxDays: ANNOUNCEMENT_MAX_AHEAD_MS / (24 * 60 * 60 * 1000),
    })
  if (typeof raw !== 'string') return err(invalid())
  const at = new Date(raw)
  return isAnnouncementInstant(at, now) ? ok(at) : err(invalid())
}
