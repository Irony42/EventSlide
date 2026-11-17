import type { WallResponse, WallRevealDto } from '../../lib/api/dto'

/**
 * The projected wall before the reveal of a disposable-camera evening (spec 23).
 *
 * **The server decides** whether the evening is revealed, with its own clock, and the wall never
 * recomputes it: `reveal.revealed` is the answer. What the wall owns is *when to ask again*, because
 * the hour announces nothing (no sweep, no signal): each screen arms one timer from the read it
 * holds and reads the playlist again, a little late on purpose.
 */

/** The longest a read waits after the hour, so 200 clients do not ask in the same second. */
export const REVEAL_JITTER_MAX_MS = 3_000

/** The longest a `setTimeout` can wait: a signed 32-bit number of milliseconds. */
export const MAX_TIMEOUT_MS = 2_147_483_647

/** Whether the room is looking at the waiting screen: the mode is on and the hour has not come. */
export const awaitsReveal = (reveal: WallRevealDto | undefined): reveal is WallRevealDto =>
  reveal !== undefined && reveal.enabled && !reveal.revealed

/**
 * How long this screen waits before it reads the playlist again: the hour minus **the server's**
 * clock as it was at the read, never this machine's. A projector whose clock is five minutes off
 * therefore reads at the same moment as one that is right. `null` with no hour (the host reveals
 * with the button, and `event.settingsChanged` is the signal for that), or when nothing waits.
 */
export const revealDelayMs = (reveal: WallRevealDto | undefined): number | null => {
  if (!awaitsReveal(reveal) || reveal.atMs === null) return null
  return Math.max(0, reveal.atMs - reveal.serverNowMs)
}

/** A delay in `[0, REVEAL_JITTER_MAX_MS)` from a uniform draw in `[0, 1)`. */
export const jitterMs = (draw: number): number =>
  Math.floor(Math.min(Math.max(draw, 0), 0.999999) * REVEAL_JITTER_MAX_MS)

/**
 * A read taken before the reveal, with what could announce a souvenir taken out.
 *
 * The server already sends no total before the reveal; this is the screen refusing to rely on it.
 * Without a total on the read before, the first read after the hour has nothing to be compared with
 * and announces nothing: the room sees the evening open, not "412 new photos" and a chime.
 */
export const silencedBeforeReveal = (response: WallResponse): WallResponse =>
  awaitsReveal(response.reveal) && response.souvenirCount !== undefined
    ? { ...response, souvenirCount: null }
    : response
