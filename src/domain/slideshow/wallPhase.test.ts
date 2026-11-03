import { describe, expect, it } from 'vitest'
import { mixedWallLayout, wallPhaseAt } from './wallPhase'

const schedule = { anchorMs: 1_000_000, wallMs: 180_000, slideshowMs: 60_000 }

describe('wallPhaseAt', () => {
  it('starts on the wall phase at the anchor', () => {
    expect(wallPhaseAt(schedule, 1_000_000)).toEqual({ phase: 'wall', endsInMs: 180_000 })
  })

  it('stays on the wall phase until the last millisecond, then switches on the boundary', () => {
    expect(wallPhaseAt(schedule, 1_000_000 + 179_999)).toEqual({ phase: 'wall', endsInMs: 1 })
    expect(wallPhaseAt(schedule, 1_000_000 + 180_000)).toEqual({
      phase: 'slideshow',
      endsInMs: 60_000,
    })
  })

  it('ends the slideshow phase and starts the next cycle on the wall phase', () => {
    expect(wallPhaseAt(schedule, 1_000_000 + 239_999)).toEqual({ phase: 'slideshow', endsInMs: 1 })
    expect(wallPhaseAt(schedule, 1_000_000 + 240_000)).toEqual({ phase: 'wall', endsInMs: 180_000 })
  })

  it('loops for hours without drifting', () => {
    const eightHours = 8 * 3_600_000
    expect(wallPhaseAt(schedule, 1_000_000 + eightHours).phase).toBe('wall')
    expect(wallPhaseAt(schedule, 1_000_000 + eightHours + 200_000).phase).toBe('slideshow')
  })

  it('reads a clock before the anchor as the start of the first wall phase', () => {
    expect(wallPhaseAt(schedule, 999_999)).toEqual({ phase: 'wall', endsInMs: 180_000 })
    expect(wallPhaseAt(schedule, 0)).toEqual({ phase: 'wall', endsInMs: 180_000 })
  })

  it('never answers a zero wait, so a timer on endsInMs always moves forward', () => {
    for (let at = 0; at < 480_000; at += 7_919) {
      expect(wallPhaseAt(schedule, 1_000_000 + at).endsInMs).toBeGreaterThan(0)
    }
  })
})

describe('mixedWallLayout', () => {
  it('uses the event layout when there is one', () => {
    expect(mixedWallLayout('collage')).toBe('collage')
    expect(mixedWallLayout('polaroid')).toBe('polaroid')
  })

  it('falls back to the overview when none is chosen', () => {
    expect(mixedWallLayout(null)).toBe('mosaic')
  })

  it('does not alternate the slideshow with itself: spotlight becomes the overview', () => {
    expect(mixedWallLayout('spotlight')).toBe('mosaic')
  })
})
