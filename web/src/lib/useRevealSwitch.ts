import { useEffect } from 'react'
import type { RevealDto } from './api/dto'
import { MAX_TIMEOUT_MS, jitterMs, revealDelayMs } from './revealGate'

/** Pause between two retries when the read at the hour still finds the evening waiting. */
export const REVEAL_RETRY_MS = 5_000
/** How many retries at most, so a wall that never reveals does not ask for ever (about a minute). */
export const REVEAL_RETRY_MAX = 12

/**
 * Reads again, on the wall or on a phone, when the reveal hour comes (spec 23).
 *
 * The hour announces nothing: there is no sweep and no signal, so every screen acts on its own
 * timer, which is `atMs - serverNowMs` of the read it holds, plus a draw of 0 to 3 seconds so a
 * room of projectors and two hundred phones do not all ask in the same millisecond. Replaced when
 * the answer's hour or reading moves (the host changed the hour), cleared on unmount, and never
 * armed for a screen with nothing to wait for. A reveal further than the longest timer fires
 * early, and the read it causes finds the evening still waiting: it is retried like any early read.
 *
 * `random` is a parameter so a test can name the draw; pass a stable function.
 */
export const useRevealSwitch = (
  reveal: RevealDto | undefined,
  read: () => void,
  random: () => number = Math.random,
): void => {
  const delay = revealDelayMs(reveal)
  const readAt = reveal?.serverNowMs

  useEffect(() => {
    if (delay === null) return undefined
    let timer: number
    let attempts = 0
    const fire = (): void => {
      read()
      // The answer can still say "waiting" (a timer a few ms early, a server clock a little behind):
      // the state then does not move and this effect would not re-arm. Ask again, a bounded number
      // of times. The next answer that changes anything clears this effect, and the retries with it.
      attempts += 1
      if (attempts <= REVEAL_RETRY_MAX) {
        timer = window.setTimeout(fire, REVEAL_RETRY_MS + jitterMs(random()))
      }
    }
    timer = window.setTimeout(fire, Math.min(delay + jitterMs(random()), MAX_TIMEOUT_MS))
    return () => window.clearTimeout(timer)
  }, [delay, readAt, read, random])
}
