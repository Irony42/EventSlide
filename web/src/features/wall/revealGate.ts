import type { WallResponse } from '../../lib/api/dto'
import { awaitsReveal } from '../../lib/revealGate'

/**
 * The projected wall before the reveal of a disposable-camera evening (spec 23).
 *
 * The gate's arithmetic (the delay, the jitter, whether the evening waits) is shared with the
 * guest's phone and lives in `lib/revealGate.ts`; it is re-exported so the wall reads it from here
 * as it always did. What stays here is the wall's own part.
 */
export {
  MAX_TIMEOUT_MS,
  REVEAL_JITTER_MAX_MS,
  awaitsReveal,
  jitterMs,
  revealDelayMs,
} from '../../lib/revealGate'

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
