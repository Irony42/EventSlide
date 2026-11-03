import type { WallLayout } from './wallLayout'

/**
 * The mixed wall (spec 09): the projector alternates between the event's wall layout and a
 * single large photo, on a schedule every screen of the event reads the same way.
 *
 * **The phase is derived, never counted.** It is a pure function of a server-set anchor and the
 * server's clock, so two projectors on the same event agree to within a second or two and a
 * reload or a paused tab lands on the right phase. No timer owns it (traps 6 and 7).
 *
 * `web/src/features/wall/wallPhase.ts` holds a guarded copy of {@link wallPhaseAt}, because the
 * client does not import from `src/`; `wallPhaseContract.test.ts` keeps the two equal.
 */

/** The wall phase lasts 30 s to 60 min, the slideshow phase 15 s to 30 min (whole seconds). */
export const MIXED_WALL_SECONDS = { min: 30, max: 3600, default: 180 } as const
export const MIXED_SLIDESHOW_SECONDS = { min: 15, max: 1800, default: 60 } as const

/**
 * The layout of the "wall" phase: the event's own choice, or the overview (`mosaic`) when there
 * is none or when it is `spotlight`, which is the other phase: the wall cannot alternate with
 * itself, and a host who chose `spotlight` for the event is not blocked, only given the overview.
 */
export const mixedWallLayout = (eventLayout: WallLayout | null): WallLayout =>
  eventLayout === null || eventLayout === 'spotlight' ? 'mosaic' : eventLayout

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
