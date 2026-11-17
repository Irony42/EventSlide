import { useEffect, useState } from 'react'
import { serverNowFrom } from './serverClock'

/** How often a countdown in days is worked out again: a day count moves slowly, a minute is plenty. */
export const SERVER_NOW_TICK_MS = 60_000

/** This machine's clock. A named read, as `useServerCountdown` keeps its own. */
const localNow = (): number => Date.now()

/**
 * The server's clock, now, refreshed once a minute: this machine's clock plus the offset measured
 * at the last read (`serverOffsetMs`), so a phone set to the wrong day does not misstate the day an
 * album is deleted.
 *
 * The interval exists for as long as the component and is cleared with it: a host leaving the page
 * open all evening accumulates nothing. The local reading is taken again when the offset changes, or
 * the new offset would be applied to a reading up to a minute old.
 */
export const useServerNow = (offsetMs: number): number => {
  const [clock, setClock] = useState(() => ({ offsetMs, local: localNow() }))
  let local = clock.local
  if (clock.offsetMs !== offsetMs) {
    // A new measurement: adjust state while rendering (one extra render, only on the change).
    local = localNow()
    setClock({ offsetMs, local })
  }

  useEffect(() => {
    const timer = setInterval(
      () => setClock((current) => ({ offsetMs: current.offsetMs, local: localNow() })),
      SERVER_NOW_TICK_MS,
    )
    return () => clearInterval(timer)
  }, [])

  return serverNowFrom(local, offsetMs)
}
