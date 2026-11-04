/**
 * The mixed wall's phase rule, as the browser runs it (spec 09).
 *
 * The rule and its tests are `src/domain/slideshow/wallPhase.ts`; `web/` may not import
 * `src/domain`, so the same text sits below the marker line, and
 * `src/interface/http/presenters/wallPhaseContract.test.ts` fails when the two differ. Two
 * projectors that disagreed about the phase would be the defect the rule exists to prevent.
 */

/** The wall's own cross-fade between phases, whole: half to leave a scene, half to enter. */
export const PHASE_FADE_MS = 800

// ---------------------------------------------------------------- shared body ----

export type WallPhase = 'wall' | 'slideshow'

export interface WallPhaseSchedule {
  /** Server time (ms since the epoch) at which a "wall" phase last began. */
  readonly anchorMs: number
  readonly wallMs: number
  readonly slideshowMs: number
}

export interface WallPhaseState {
  readonly phase: WallPhase
  /** Milliseconds until the phase changes; always above zero. */
  readonly endsInMs: number
}

/**
 * Which phase `nowMs` falls in. A clock before the anchor (a screen running ahead of the
 * server's stamp) is read as the start of the first wall phase, never as a negative position.
 */
export const wallPhaseAt = (schedule: WallPhaseSchedule, nowMs: number): WallPhaseState => {
  const cycleMs = schedule.wallMs + schedule.slideshowMs
  if (nowMs < schedule.anchorMs) return { phase: 'wall', endsInMs: schedule.wallMs }
  const position = (nowMs - schedule.anchorMs) % cycleMs
  return position < schedule.wallMs
    ? { phase: 'wall', endsInMs: schedule.wallMs - position }
    : { phase: 'slideshow', endsInMs: cycleMs - position }
}
