import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

export interface TimingOverrides {
  /** Milliseconds per slide, or `null` to use the server's interval. */
  readonly intervalMs: number | null
  /** Crossfade length, or `null` to use `--duration-slow`. `0` means cut. */
  readonly transitionMs: number | null
  /** Both phases of the mixed wall last this long, or `null` for the event's durations. */
  readonly phaseMs: number | null
}

/**
 * The server's own bounds for these two parameters (`wallQuery`, requestSchemas.ts): a link
 * sent to a host must not put the projector in a 1 ms slide loop, nor past the 32-bit limit
 * of `setTimeout` (which fires at once). `0` stays valid for both: it is the suites' "no
 * clock" and "cut" (CLAUDE.md §9 trap 10), and an out-of-range value is treated as absent.
 */
const INTERVAL_RANGE = { min: 50, max: 600_000 } as const
const TRANSITION_RANGE = { min: 0, max: 10_000 } as const

const readMs = (
  raw: string | null,
  range: { readonly min: number; readonly max: number } | null = null,
): number | null => {
  if (raw === null) return null
  const parsed = Number(raw)
  // A negative or unparseable value is ignored rather than clamped: a typo in a query
  // string must not silently reconfigure the room's screen.
  if (!Number.isFinite(parsed) || parsed < 0) return null
  if (range !== null && parsed !== 0 && (parsed < range.min || parsed > range.max)) return null
  return Math.trunc(parsed)
}

/**
 * The timing hooks the end-to-end suite drives the wall with.
 *
 * `?e2e_interval=250&e2e_transition=0` (and `?e2e_phase_ms=` for the mixed wall) is what makes a projector journey assertable in
 * a second instead of forty: without them a Playwright test would have to wait real
 * slide intervals, and the alternative — mocking the clock inside the browser — would
 * stop testing the thing that actually runs at the venue.
 *
 * Reading them here rather than in each component keeps one parser. They are read in the
 * browser, from the display address, by the same bundle production serves: a projector
 * opened on `?e2e_interval=50` is sped up in production too, and only the screen that
 * opened that address is affected (`docs/API.md` §9.5).
 */
export const useTimingOverrides = (): TimingOverrides => {
  const [params] = useSearchParams()
  const interval = params.get('e2e_interval')
  const transition = params.get('e2e_transition')
  const phase = params.get('e2e_phase_ms')

  return useMemo(
    () => ({
      intervalMs: readMs(interval, INTERVAL_RANGE),
      transitionMs: readMs(transition, TRANSITION_RANGE),
      // Zero would be a boundary every millisecond: refused like any unusable value.
      phaseMs: ((ms) => (ms === 0 ? null : ms))(readMs(phase)),
    }),
    [interval, transition, phase],
  )
}
