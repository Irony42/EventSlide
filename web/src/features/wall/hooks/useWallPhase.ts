import { useEffect, useState } from 'react'
import type { WallResponse } from '../../../lib/api/dto'
import { PHASE_FADE_MS, wallPhaseAt, type WallPhase } from '../wallPhase'

export interface WallPhaseView {
  /** The phase the room is looking at; `null` when the wall is not alternating. */
  readonly phase: WallPhase | null
  /**
   * True while the scene is dark between two phases: the old layout has gone out, the new one
   * has not come in yet. Only ever true when the change is faded (see `instant`).
   */
  readonly fading: boolean
}

export interface WallPhaseOptions {
  readonly mixed: WallResponse['mixed']
  /** The server's time now, in milliseconds: this machine's clock plus the offset measured at the last read. */
  readonly now: () => number
  /** Space, or a hidden tab: the phase holds where it was, and catches up on resume. */
  readonly paused: boolean
  /** Reduced motion, or a budget with no cross-fade left: a hard cut, no dark gap. */
  readonly instant: boolean
  /** Whole fade, in ms; `null` is the stylesheet's. `0` is a cut. */
  readonly fadeMs: number | null
  /** `?e2e_phase_ms=`: both phases last this long (the anchor stays the server's). */
  readonly phaseMsOverride: number | null
}

/**
 * Which half of the mixed wall the room is on (spec 09, rules 4 to 10, 15).
 *
 * **The phase is derived from the server's clock on every render** ({@link wallPhaseAt}), never
 * counted: a timer here only makes sure a render happens at the next boundary. It is one
 * `setTimeout`, replaced each time (an eight-hour wall never accumulates a `setInterval`).
 *
 * A change of phase fades the whole scene through black: half of `fadeMs` out, the layout
 * switches while dark, half in. `shown` is what is mounted; **only one layout is ever mounted**.
 * With `instant` the switch is the same render as the boundary.
 */
export const useWallPhase = ({
  mixed,
  now,
  paused,
  instant,
  fadeMs,
  phaseMsOverride,
}: WallPhaseOptions): WallPhaseView => {
  const [, setTick] = useState(0)
  const [held, setHeld] = useState<WallPhase | null>(null)
  const [shown, setShown] = useState<WallPhase | null>(null)

  const alternating = mixed != null
  const current =
    mixed == null
      ? null
      : wallPhaseAt(
          {
            anchorMs: mixed.anchorMs,
            wallMs: phaseMsOverride ?? mixed.wallMs,
            slideshowMs: phaseMsOverride ?? mixed.slideshowMs,
          },
          now(),
        )

  // A pause holds the phase where it was; the resume reads the clock again (rule 15). Adjusted
  // while rendering, like the other hooks of this page, not in an effect.
  const wanted = current === null ? null : paused ? (held ?? current.phase) : current.phase
  if (paused && held === null && current !== null) setHeld(current.phase)
  if (!paused && held !== null) setHeld(null)

  // What is mounted: the first phase at once, then the new one only once the old has faded out.
  // With `instant` there is no dark gap, so it is always the wanted one.
  const cut = instant || fadeMs === 0
  if (wanted === null && shown !== null) setShown(null)
  if (wanted !== null && (shown === null || (cut && shown !== wanted))) setShown(wanted)
  const showing = wanted === null ? null : cut ? wanted : (shown ?? wanted)
  const fading = wanted !== null && showing !== wanted

  // One timer, replaced at each render: the next boundary.
  const endsInMs = current?.endsInMs ?? null
  useEffect(() => {
    if (paused || endsInMs === null) return undefined
    const timer = window.setTimeout(() => setTick((tick) => tick + 1), endsInMs)
    return () => window.clearTimeout(timer)
  }, [paused, endsInMs])

  // The other: the layout changes once the scene has gone dark.
  const halfMs = (fadeMs ?? PHASE_FADE_MS) / 2
  useEffect(() => {
    if (!fading || wanted === null) return undefined
    const timer = window.setTimeout(() => setShown(wanted), halfMs)
    return () => window.clearTimeout(timer)
  }, [fading, wanted, halfMs])

  // Back in the foreground the clock has moved on without us: read it again.
  useEffect(() => {
    if (!alternating) return undefined
    const onVisible = () => {
      if (document.visibilityState === 'visible') setTick((tick) => tick + 1)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [alternating])

  return { phase: showing, fading }
}
