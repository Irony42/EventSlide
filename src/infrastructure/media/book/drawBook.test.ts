import { describe, expect, it } from 'vitest'
import { polaroidFrame, polaroidRoom } from './drawBook'

const slot = { x: 100, y: 50, w: 300, h: 400 }

describe('polaroidFrame', () => {
  it.each([
    ['a 3:4 portrait', 300, 400],
    ['a 4:3 landscape', 400, 300],
    ['a square', 500, 500],
    ['a panorama', 900, 300],
  ])('hugs %s: the photograph keeps its shape and the border is even on three sides', (_name, width, height) => {
    const { pad } = polaroidRoom(slot)

    const { frame, photo } = polaroidFrame(slot, { width, height })

    expect(photo.w / photo.h).toBeCloseTo(width / height, 6)
    expect(photo.x - frame.x).toBeCloseTo(pad, 6)
    expect(photo.y - frame.y).toBeCloseTo(pad, 6)
    expect(frame.x + frame.w - (photo.x + photo.w)).toBeCloseTo(pad, 6)
  })

  it('has no white band inside it: the frame is the photograph plus the border plus the caption band', () => {
    const { pad, band } = polaroidRoom(slot)

    const { frame, photo } = polaroidFrame(slot, { width: 300, height: 400 })

    expect(frame.w).toBeCloseTo(photo.w + 2 * pad, 6)
    expect(frame.h).toBeCloseTo(photo.h + pad + band, 6)
  })

  it('stays inside its slot and is centred in it', () => {
    for (const [width, height] of [
      [300, 400],
      [400, 300],
      [900, 300],
    ] as const) {
      const { frame } = polaroidFrame(slot, { width, height })

      expect(frame.x).toBeGreaterThanOrEqual(slot.x - 1e-6)
      expect(frame.y).toBeGreaterThanOrEqual(slot.y - 1e-6)
      expect(frame.x + frame.w).toBeLessThanOrEqual(slot.x + slot.w + 1e-6)
      expect(frame.y + frame.h).toBeLessThanOrEqual(slot.y + slot.h + 1e-6)
      expect(frame.x + frame.w / 2).toBeCloseTo(slot.x + slot.w / 2, 6)
      expect(frame.y + frame.h / 2).toBeCloseTo(slot.y + slot.h / 2, 6)
    }
  })

  it('leaves room for a caption: the band is at least 22 pt', () => {
    expect(polaroidRoom({ x: 0, y: 0, w: 100, h: 80 }).band).toBe(22)
    expect(polaroidRoom(slot).band).toBeCloseTo(56, 6)
  })
})
