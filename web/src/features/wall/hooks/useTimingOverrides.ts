import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

export interface TimingOverrides {
  /** Milliseconds per slide, or `null` to use the server's interval. */
  readonly intervalMs: number | null
  /** Crossfade length, or `null` to use `--duration-slow`. `0` means cut. */
  readonly transitionMs: number | null
}

const readMs = (raw: string | null): number | null => {
  if (raw === null) return null
  const parsed = Number(raw)
  // A negative or unparseable value is ignored rather than clamped: a typo in a query
  // string must not silently reconfigure the room's screen.
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return Math.trunc(parsed)
}

/**
 * The two timing hooks the end-to-end suite drives the wall with.
 *
 * `?e2e_interval=250&e2e_transition=0` is what makes a projector journey assertable in
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

  return useMemo(
    () => ({ intervalMs: readMs(interval), transitionMs: readMs(transition) }),
    [interval, transition],
  )
}
