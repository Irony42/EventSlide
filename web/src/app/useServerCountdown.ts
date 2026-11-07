import { useEffect, useState } from 'react'
import { remainingMs } from '../lib/serverClock'

/** The part of a challenge a countdown needs: the same on the phone and on the wall. */
export interface CountdownChallenge {
  readonly id: string
  readonly endsAt: string
  readonly state: 'running' | 'ended'
}

export interface ServerCountdown {
  /** Milliseconds left on the server's clock, never negative. */
  readonly leftMs: number
  /** By the server's word (`ended`), or by the clock a moment before the server is asked again. */
  readonly over: boolean
}

/** This machine's clock. A named read, as `WallPage` keeps its own: the hook decides when to ask. */
const localNow = (): number => Date.now()

/**
 * Counts a challenge down against the server's clock, one render a second, and nothing once it
 * is over: the interval exists only while it counts and is cleared on unmount, so an eight-hour
 * evening accumulates nothing.
 *
 * The local `now` is re-read when the challenge **id** changes: while the countdown is over the
 * interval is stopped and `now` is frozen, so a challenge that replaced it would otherwise be
 * measured against that stale instant for up to a second.
 */
export const useServerCountdown = (
  challenge: CountdownChallenge,
  offsetMs: number,
): ServerCountdown => {
  const [clock, setClock] = useState(() => ({ id: challenge.id, now: localNow() }))
  let now = clock.now
  if (clock.id !== challenge.id) {
    // A new challenge: adjust state while rendering (one extra render, only on the change).
    now = localNow()
    setClock({ id: challenge.id, now })
  }

  const leftMs = remainingMs(Date.parse(challenge.endsAt), now, offsetMs)
  const over = challenge.state === 'ended' || leftMs === 0

  useEffect(() => {
    if (over) return undefined
    const timer = setInterval(() => setClock((c) => ({ id: c.id, now: localNow() })), 1000)
    return () => clearInterval(timer)
  }, [over])

  return { leftMs, over }
}

/**
 * `true` once `over` has been true for `ms` (the "Défi terminé" banner has had its say).
 * `onGone` runs once, from that timer. The timer is cleared if `over` goes away or on unmount.
 */
export const useGoneAfter = (over: boolean, ms: number, onGone?: () => void): boolean => {
  const [gone, setGone] = useState(false)

  useEffect(() => {
    if (!over) return undefined
    const timer = setTimeout(() => {
      setGone(true)
      onGone?.()
    }, ms)
    return () => clearTimeout(timer)
  }, [over, ms, onGone])

  return gone
}
