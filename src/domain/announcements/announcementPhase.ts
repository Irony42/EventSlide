/**
 * The phase rule of an announcement, in the one form the browser can run too (spec 21, rule 5).
 *
 * An announcement is in time and nothing else: `upcoming`, `counting` down to `at`, `showing`,
 * `over`. The rule is a pure function of three integers and the server's clock, so two
 * projectors whose own clocks are minutes apart still change phase on the same server second.
 *
 * `web/src/features/wall/announcementPhase.ts` holds a guarded copy of everything below the
 * marker line, because the client does not import from `src/`;
 * `announcementPhaseContract.test.ts` fails when the two texts differ. Everything the domain
 * wraps around it (the aggregate's `Date`, the kinds, the visibility window) stays above the line.
 */

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
