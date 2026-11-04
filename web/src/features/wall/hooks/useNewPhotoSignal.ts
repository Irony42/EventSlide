import { useCallback, useEffect, useRef, useState } from 'react'
import type { WallResponse } from '../../../lib/api/dto'
import {
  INITIAL_SIGNAL,
  NO_ARRIVALS,
  detectArrivals,
  nextWakeMs,
  reduceSignal,
  type Bubble,
  type SignalEvent,
  type SignalState,
  type WallSnapshot,
} from '../arrivals'

export interface NewPhotoSignal {
  /** The one bubble on screen, or `null`. */
  readonly bubble: Bubble | null
  /** Fed with every successful read of the wall, changed or not. Stable. */
  readonly observe: (response: WallResponse) => void
}

/**
 * Wires the pure arrival logic to the wall's reads (spec 11). Holds the previous read in a ref,
 * never a growing set, and one timer that is cleared on unmount: eight hours accumulate nothing.
 */
export const useNewPhotoSignal = (): NewPhotoSignal => {
  const [bubble, setBubble] = useState<Bubble | null>(null)
  const snapshot = useRef<WallSnapshot | null>(null)
  const engine = useRef<SignalState>(INITIAL_SIGNAL)
  const timer = useRef<number | null>(null)
  // The timer calls back into `run`, which is declared below: through a ref, not a closure.
  const runRef = useRef<(event: SignalEvent) => void>(() => undefined)

  const run = useCallback((event: SignalEvent) => {
    const now = Date.now()
    engine.current = reduceSignal(engine.current, event, now)
    // The reducer keeps the bubble's identity while it is up, so React bails out.
    setBubble(engine.current.visible)
    if (timer.current !== null) window.clearTimeout(timer.current)
    const wake = nextWakeMs(engine.current, now)
    timer.current =
      wake === null
        ? null
        : window.setTimeout(() => runRef.current({ type: 'tick' }), Math.max(wake, 0))
  }, [])

  useEffect(() => {
    runRef.current = run
  }, [run])

  const observe = useCallback(
    (response: WallResponse) => {
      const taken: WallSnapshot = {
        items: response.items.map((item) => ({ id: item.id, kind: item.kind })),
        total: response.souvenirCount ?? null,
        at: Date.now(),
      }
      const enabled = response.newPhotoSignal === true
      const arrivals = enabled ? detectArrivals(snapshot.current, taken) : NO_ARRIVALS
      snapshot.current = taken

      if (!enabled) {
        if (engine.current !== INITIAL_SIGNAL) run({ type: 'reset' })
        return
      }
      if (arrivals.photos + arrivals.clips > 0) run({ type: 'arrive', arrivals })
    },
    [run],
  )

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    [],
  )

  return { bubble, observe }
}
