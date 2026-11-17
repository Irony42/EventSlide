import type { RevealDto } from './api/dto'

/**
 * When a screen asks again about a disposable-camera evening that waits for its reveal (spec 23).
 *
 * **The server decides** whether the evening is revealed, with its own clock, and a client never
 * recomputes it: `reveal.revealed` is the answer. What a client owns is *when to ask again*, because
 * the hour announces nothing (no sweep, no signal): each screen arms one timer from the read it
 * holds and reads again, a little late on purpose. The wall and the guest's phone share it, so it
 * lives here and neither feature imports the other.
 */

/** The longest a read waits after the hour, so 200 clients do not ask in the same second. */
export const REVEAL_JITTER_MAX_MS = 3_000

/** The longest a `setTimeout` can wait: a signed 32-bit number of milliseconds. */
export const MAX_TIMEOUT_MS = 2_147_483_647

/** Whether the screen is looking at a held evening: the mode is on and the hour has not come. */
export const awaitsReveal = <T extends RevealDto>(reveal: T | undefined): reveal is T =>
  reveal !== undefined && reveal.enabled && !reveal.revealed

/**
 * How long this screen waits before it reads again: the hour minus **the server's** clock as it was
 * at the read, never this machine's. A projector whose clock is five minutes off therefore reads at
 * the same moment as one that is right. `null` with no hour (the host reveals with the button, and
 * `event.settingsChanged` is the signal for that), or when nothing waits.
 */
export const revealDelayMs = (reveal: RevealDto | undefined): number | null => {
  if (!awaitsReveal(reveal) || reveal.atMs === null) return null
  return Math.max(0, reveal.atMs - reveal.serverNowMs)
}

/** A delay in `[0, REVEAL_JITTER_MAX_MS)` from a uniform draw in `[0, 1)`. */
export const jitterMs = (draw: number): number =>
  Math.floor(Math.min(Math.max(draw, 0), 0.999999) * REVEAL_JITTER_MAX_MS)
