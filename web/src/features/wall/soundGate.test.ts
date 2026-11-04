import { describe, expect, it } from 'vitest'
import { WALL_SOUND_MIN_GAP_MS } from '../../lib/wallSoundPlayer'
import { NO_ARRIVALS } from './arrivals'
import { INITIAL_SOUND_GATE, decideRing } from './soundGate'

const one = { photos: 1, clips: 0 }

describe('the sound gate (spec 12)', () => {
  it('stays silent when nothing arrived', () => {
    expect(decideRing(INITIAL_SOUND_GATE, NO_ARRIVALS, 1_000).ring).toBe(false)
  })

  it('rings for a new photo, and for a new clip', () => {
    expect(decideRing(INITIAL_SOUND_GATE, one, 1_000).ring).toBe(true)
    expect(decideRing(INITIAL_SOUND_GATE, { photos: 0, clips: 1 }, 1_000).ring).toBe(true)
  })

  it('rings once for a burst of twenty', () => {
    const burst = decideRing(INITIAL_SOUND_GATE, { photos: 20, clips: 0 }, 1_000)
    expect(burst.ring).toBe(true)
    expect(decideRing(burst.gate, one, 1_001).ring).toBe(false)
  })

  it('drops a second arrival inside the 5 s window and rings again after it', () => {
    const first = decideRing(INITIAL_SOUND_GATE, one, 10_000)
    const early = decideRing(first.gate, one, 10_000 + WALL_SOUND_MIN_GAP_MS - 1)
    expect(early.ring).toBe(false)
    // The dropped one does not open a window of its own.
    expect(early.gate).toBe(first.gate)
    expect(decideRing(first.gate, one, 10_000 + WALL_SOUND_MIN_GAP_MS).ring).toBe(true)
  })

  it('does not queue: a silent moment after a dropped arrival stays silent', () => {
    const first = decideRing(INITIAL_SOUND_GATE, one, 0)
    const dropped = decideRing(first.gate, one, 1_000)
    expect(decideRing(dropped.gate, NO_ARRIVALS, 6_000).ring).toBe(false)
  })
})
