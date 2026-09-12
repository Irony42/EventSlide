import { describe, expect, it } from 'vitest'
import { CROSSFADE_MS, kenBurnsDisabled, kenBurnsDurationMs, kenBurnsScale } from './kenBurns'
import { SlideInterval } from './slideInterval'

const intervalOf = (ms: number): SlideInterval => {
  const result = SlideInterval.create(ms)
  if (!result.ok) throw result.error
  return result.value
}

/** The three intervals the 1.0 snap has to be impossible at: both bounds and the default. */
const BOUNDARY_INTERVALS: number[] = [
  SlideInterval.minMs,
  SlideInterval.defaultMs,
  SlideInterval.maxMs,
]

describe('kenBurnsDurationMs', () => {
  it.each(BOUNDARY_INTERVALS)('is still running when a %ims slide ends', (ms) => {
    const interval = intervalOf(ms)

    expect(kenBurnsDurationMs(interval)).toBeGreaterThan(interval.ms)
  })

  it('outlasts the slide by exactly the crossfade, so the zoom is still moving as the next photo fades in', () => {
    expect(kenBurnsDurationMs(intervalOf(10_000))).toBe(10_000 + CROSSFADE_MS)
  })

  it('is derived from the interval, so changing the interval changes the zoom with it', () => {
    const slow = kenBurnsDurationMs(intervalOf(20_000))
    const quick = kenBurnsDurationMs(intervalOf(4_000))

    expect(slow - quick).toBe(16_000)
  })
})

describe('CROSSFADE_MS', () => {
  it('takes up only part of even the shortest slide', () => {
    expect(CROSSFADE_MS).toBeLessThan(SlideInterval.minMs)
  })
})

describe('kenBurnsScale', () => {
  it('starts at the photo natural size, so nothing is cropped on arrival', () => {
    expect(kenBurnsScale().from).toBe(1)
  })

  it('zooms in rather than out', () => {
    const scale = kenBurnsScale()

    expect(scale.to).toBeGreaterThan(scale.from)
  })

  it('keeps the zoom subtle enough for a phone photo on a projector', () => {
    expect(kenBurnsScale().to).toBeLessThanOrEqual(1.2)
  })
})

describe('kenBurnsDisabled', () => {
  it('runs no animation at all under prefers-reduced-motion', () => {
    expect(kenBurnsDisabled().durationMs).toBe(0)
  })

  it('holds the photo still rather than zooming faster', () => {
    const { scale } = kenBurnsDisabled()

    expect(scale.to).toBe(scale.from)
  })

  it('holds it at its natural size, not frozen at the end of the zoom', () => {
    expect(kenBurnsDisabled().scale.from).toBe(1)
  })
})
