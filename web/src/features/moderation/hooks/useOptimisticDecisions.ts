import { useCallback, useRef, useState } from 'react'
import type { PhotoStatus } from '../../../lib/api/dto'
import {
  forgetInFlight,
  overlayInFlight,
  type DecidableRow,
  type InFlight,
  type Overlaid,
} from '../lib/optimisticOverlay'

/**
 * The bookkeeping of decisions that are out and not yet answered, shared by the photo queue
 * and the guestbook queue (WEB-HOST-05). The rules are in `lib/optimisticOverlay.ts`; this is
 * the part that needs React: the ref holding what is in flight, the read counter, and the busy
 * count (a count, not a flag: with two decisions out, the first to answer must not clear it).
 */
export interface OptimisticDecisions {
  /** A decision is in flight. */
  readonly busy: boolean
  /** A read is about to start: its number, to hand to `overlay` and to compare answers against. */
  readonly startRead: () => number
  /** How many reads have started so far. */
  readonly readsStarted: () => number
  /** Start remembering decisions that are about to be sent. */
  readonly send: (statuses: ReadonlyMap<string, PhotoStatus>) => ReadonlyMap<string, InFlight>
  /** The server answered. Rows in `refused` were put back by hand and are forgotten now. */
  readonly answer: (sent: ReadonlyMap<string, InFlight>, refused?: readonly string[]) => void
  /** The request failed and the rows went back where they were: nothing to write over. */
  readonly fail: (sent: ReadonlyMap<string, InFlight>) => void
  /** The server's rows with what is still being decided written over them. */
  readonly overlay: <T extends DecidableRow>(rows: readonly T[], startedAt: number) => Overlaid<T>
  /** Mark the start and the end of a request, for `busy`. */
  readonly beginBusy: () => void
  readonly endBusy: () => void
}

export const useOptimisticDecisions = (): OptimisticDecisions => {
  const inFlightRef = useRef(new Map<string, InFlight>())
  const readsStartedRef = useRef(0)
  const [busyCount, setBusyCount] = useState(0)

  const startRead = useCallback(() => {
    readsStartedRef.current += 1
    return readsStartedRef.current
  }, [])
  const readsStarted = useCallback(() => readsStartedRef.current, [])

  const send = useCallback((statuses: ReadonlyMap<string, PhotoStatus>) => {
    const sent = new Map<string, InFlight>()
    for (const [id, status] of statuses) {
      const decision: InFlight = { status, settledAfterRead: null }
      inFlightRef.current.set(id, decision)
      sent.set(id, decision)
    }
    return sent
  }, [])

  const answer = useCallback(
    (sent: ReadonlyMap<string, InFlight>, refused: readonly string[] = []) => {
      for (const [id, decision] of sent) {
        if (refused.includes(id)) forgetInFlight(inFlightRef.current, id, decision)
        else decision.settledAfterRead = readsStartedRef.current
      }
    },
    [],
  )

  const fail = useCallback((sent: ReadonlyMap<string, InFlight>) => {
    for (const [id, decision] of sent) forgetInFlight(inFlightRef.current, id, decision)
  }, [])

  const overlay = useCallback(
    <T extends DecidableRow>(rows: readonly T[], startedAt: number): Overlaid<T> => {
      const result = overlayInFlight(rows, inFlightRef.current, startedAt)
      for (const id of result.expired) inFlightRef.current.delete(id)
      return result
    },
    [],
  )

  const beginBusy = useCallback(() => setBusyCount((count) => count + 1), [])
  const endBusy = useCallback(() => setBusyCount((count) => count - 1), [])

  return {
    busy: busyCount > 0,
    startRead,
    readsStarted,
    send,
    answer,
    fail,
    overlay,
    beginBusy,
    endBusy,
  }
}
