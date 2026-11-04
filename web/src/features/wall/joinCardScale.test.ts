import { describe, expect, it } from 'vitest'
import { joinCardScale, qrModuleCount, smallScaleFloor } from './joinCardScale'

describe('the invitation card scale floor (spec 14)', () => {
  it('counts the modules of a level-M QR from the byte length', () => {
    expect([14, 15, 42, 43, 62, 63, 84, 85, 106, 107].map(qrModuleCount)).toEqual([
      21, 25, 29, 33, 33, 37, 37, 41, 41, 45,
    ])
  })

  it('floors the scale at 0.8 for a short link and at 1 from 41 modules', () => {
    expect(smallScaleFloor(29)).toBe(0.8)
    expect(smallScaleFloor(33)).toBeCloseTo(0.8815, 4)
    expect(smallScaleFloor(37)).toBeCloseTo(0.9675, 4)
    expect(smallScaleFloor(41)).toBe(1)
  })

  it('lets a short link go down to 0.8 and lifts a long one', () => {
    const short = 'https://app.eventslide.fr/join/ABC234'
    const long = `https://app.eventslide.fr/join/${'x'.repeat(60)}`

    expect(joinCardScale(0.8, short)).toBe(0.8)
    expect(joinCardScale(0.8, long)).toBeGreaterThan(0.95)
    expect(joinCardScale(1.4, long)).toBe(1.4)
  })
})
