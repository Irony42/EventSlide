import { describe, expect, it } from 'vitest'
import { TRIM_PT, containBox, fitSize, polaroidFrame, polaroidRotation } from './bookGeometry'

describe('polaroidRotation', () => {
  it('tilts a photograph the same way every time, within four degrees', () => {
    // The same two vectors are pinned by the server's `bookColours.test.ts`: one hash, two implementations.
    expect(polaroidRotation('photo-1')).toBe(polaroidRotation('photo-1'))
    expect(polaroidRotation('photo-1')).toBeCloseTo(-1.54, 2)
    expect(polaroidRotation('photo-2')).toBeCloseTo(2.27, 2)
    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      expect(Math.abs(polaroidRotation(id))).toBeLessThanOrEqual(4)
    }
  })
})

describe('containBox', () => {
  it('keeps the shape of the photograph and centres it', () => {
    const box = containBox({ x: 0, y: 0, w: 100, h: 100 }, 2)
    expect(box).toEqual({ x: 0, y: 25, w: 100, h: 50 })
    expect(containBox({ x: 0, y: 0, w: 100, h: 100 }, 0.5)).toEqual({ x: 25, y: 0, w: 50, h: 100 })
  })
})

describe('polaroidFrame', () => {
  it('hugs the photograph: a border on three sides and a band under it, centred in the slot', () => {
    const { frame, photo, bandPt, padPct } = polaroidFrame({ x: 17, y: 8, w: 66, h: 62 }, 4 / 3)
    expect(photo.w / photo.h).toBeCloseTo(4 / 3, 5)
    expect(frame.x + frame.w / 2).toBeCloseTo(17 + 33, 5)
    expect(frame.y + frame.h / 2).toBeCloseTo(8 + 31, 5)
    expect(photo.x - frame.x).toBeCloseTo(padPct, 5)
    expect(frame.x + frame.w - (photo.x + photo.w)).toBeCloseTo(padPct, 5)
    expect(frame.y + frame.h - (photo.y + photo.h)).toBeCloseTo((bandPt / TRIM_PT) * 100, 5)
  })

  it('has the measures drawBook computes for a square slot', () => {
    // Slot 40 % x 40 % of 595.28 pt: pad 9.52 pt, band max(22, 33.3) = 33.3 pt.
    const { bandPt, padPct } = polaroidFrame({ x: 10, y: 10, w: 40, h: 40 }, 1)
    expect(bandPt).toBeCloseTo(33.33, 1)
    expect(padPct).toBeCloseTo(1.6, 3)
  })
})

describe('fitSize', () => {
  it('keeps the size a short title asks for, and shrinks a long one down to the floor', () => {
    const box = { w: 60, h: 22 }
    expect(fitSize('Camille & Sacha', box, 34, 16)).toBe(34)
    const long = fitSize('x'.repeat(80), box, 34, 16)
    expect(long).toBeLessThan(34)
    expect(long).toBeGreaterThanOrEqual(16)
    expect(fitSize('x'.repeat(4000), box, 34, 16)).toBe(16)
  })
})
