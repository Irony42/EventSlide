import { WALL_SOUND_MIN_GAP_MS } from '../../lib/wallSoundPlayer'
import type { Arrivals } from './arrivals'

/**
 * When the wall may ring (spec 12, rules 2 to 5). Pure: the clock is an argument, there is no
 * timer. What counts as an arrival is {@link detectArrivals}'s verdict (spec 11), computed on two
 * successive reads of the *published* playlist, never on a stream signal: a photo waiting for
 * moderation, a refusal, a reaction or a mission therefore never ring.
 *
 * Rising edge, no queue: the first arrival rings, the ones that follow inside the window are
 * dropped and not replayed later (a sound for a photo that already left is worse than none).
 */
export interface SoundGate {
  /** When the last sound was started; `null` before the first one. */
  readonly lastRingAt: number | null
}

export const INITIAL_SOUND_GATE: SoundGate = { lastRingAt: null }

export interface RingDecision {
  readonly ring: boolean
  readonly gate: SoundGate
}

export const decideRing = (gate: SoundGate, arrivals: Arrivals, now: number): RingDecision => {
  const arrived = arrivals.photos + arrivals.clips > 0
  const open = gate.lastRingAt === null || now - gate.lastRingAt >= WALL_SOUND_MIN_GAP_MS
  return arrived && open ? { ring: true, gate: { lastRingAt: now } } : { ring: false, gate }
}
