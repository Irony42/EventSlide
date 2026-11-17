import { useEffect } from 'react'
import type { WallRevealDto } from '../../../lib/api/dto'
import { MAX_TIMEOUT_MS, jitterMs, revealDelayMs } from '../revealGate'

/**
 * Reads the wall again when the reveal hour comes (spec 23).
 *
 * The hour announces nothing: there is no sweep and no signal, so every screen acts on its own
 * timer, which is `atMs - serverNowMs` of the read it holds, plus a draw of 0 to 3 seconds so a
 * room of projectors and two hundred phones do not all ask in the same millisecond. Replaced when
 * the answer's hour or reading moves (the host changed the hour), cleared on unmount, and never
 * armed for a screen with nothing to wait for. A reveal further than the longest timer fires
 * early, and the read it causes finds the evening still waiting.
 *
 * `random` is a parameter so a test can name the draw; pass a stable function.
 */
export const useRevealSwitch = (
  reveal: WallRevealDto | undefined,
  read: () => void,
  random: () => number = Math.random,
): void => {
  const delay = revealDelayMs(reveal)
  const readAt = reveal?.serverNowMs

  useEffect(() => {
    if (delay === null) return undefined
    const timer = window.setTimeout(read, Math.min(delay + jitterMs(random()), MAX_TIMEOUT_MS))
    return () => window.clearTimeout(timer)
  }, [delay, readAt, read, random])
}
