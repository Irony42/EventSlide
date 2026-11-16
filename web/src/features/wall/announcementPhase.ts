/**
 * The phase of a scheduled announcement, as the browser runs it (spec 21, rule 5).
 *
 * The rule and its tests are `src/domain/announcements/announcementPhase.ts`; `web/` may not
 * import `src/domain`, so the same text sits below the marker line, and
 * `src/interface/http/presenters/announcementPhaseContract.test.ts` fails when the two differ.
 * Two projectors that disagreed about when the cake card starts would be the defect the rule
 * exists to prevent.
 */
import type { WallAnnouncementDto } from '../../lib/api/dto'

/**
 * The phase of a wall announcement at `nowMs`, **on the server's clock** (`serverNowFrom`): the
 * three integers the wall was sent, and nothing else. `at` is parsed here, once per call, from
 * the ISO instant the server wrote.
 */
export const wallAnnouncementPhaseAt = (
  announcement: Pick<WallAnnouncementDto, 'at' | 'durationSeconds' | 'countdownSeconds'>,
  nowMs: number,
): AnnouncementPhase =>
  announcementWindowPhaseAt(
    {
      atMs: Date.parse(announcement.at),
      durationSeconds: announcement.durationSeconds,
      countdownSeconds: announcement.countdownSeconds,
    },
    nowMs,
  )

// ---------------------------------------------------------------- shared body ----

/** What the phase needs of an announcement: the instant it appears (ms since the epoch) and two spans. */
export interface AnnouncementWindow {
  readonly atMs: number
  readonly durationSeconds: number
  readonly countdownSeconds: number
}

export type AnnouncementPhase =
  | { readonly phase: 'upcoming' }
  | { readonly phase: 'counting'; readonly remainingMs: number }
  | { readonly phase: 'showing'; readonly remainingMs: number }
  | { readonly phase: 'over' }

/**
 * `upcoming` before the countdown starts, `counting` from `at - countdown` to `at` (never, for a
 * zero countdown), `showing` from `at` for `duration`, `over` from `at + duration` on. Every
 * boundary belongs to the later phase.
 */
export const announcementWindowPhaseAt = (
  window: AnnouncementWindow,
  nowMs: number,
): AnnouncementPhase => {
  const countingFromMs = window.atMs - window.countdownSeconds * 1000
  const endsMs = window.atMs + window.durationSeconds * 1000

  if (nowMs < countingFromMs) return { phase: 'upcoming' }
  if (nowMs < window.atMs) return { phase: 'counting', remainingMs: window.atMs - nowMs }
  if (nowMs < endsMs) return { phase: 'showing', remainingMs: endsMs - nowMs }
  return { phase: 'over' }
}
