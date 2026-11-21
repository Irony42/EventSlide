import { describe, expect, it } from 'vitest'
import { coverRect } from './coverRect'

const FRAME = { x: 10, y: 20, width: 100, height: 100 }

describe('coverRect', () => {
  it('draws a landscape picture as tall as the frame and keeps the focus of what overflows sideways', () => {
    // 400 x 200 covers 100 x 100 at 200 x 100: 100 overflows, 20 % of it is cut on the left.
    expect(coverRect({ width: 400, height: 200 }, FRAME, 20, 80)).toEqual({
      x: 10 - 20,
      y: 20,
      width: 200,
      height: 100,
    })
  })

  it('draws a portrait picture as wide as the frame and keeps the focus of what overflows downwards', () => {
    // 200 x 400 covers 100 x 100 at 100 x 200: 100 overflows, 80 % of it is cut above.
    expect(coverRect({ width: 200, height: 400 }, FRAME, 20, 80)).toEqual({
      x: 10,
      y: 20 - 80,
      width: 100,
      height: 200,
    })
  })

  it('puts the focus at the edges and the middle exactly, not in three buckets', () => {
    const wide = { width: 300, height: 100 }

    expect(coverRect(wide, FRAME, 0, 50).x).toBe(10)
    expect(coverRect(wide, FRAME, 100, 50).x).toBe(10 - 200)
    expect(coverRect(wide, FRAME, 50, 50).x).toBe(10 - 100)
    expect(coverRect(wide, FRAME, 33, 50).x).not.toBe(coverRect(wide, FRAME, 34, 50).x)
  })

  it('covers the frame whatever the ratio: no gap on any side', () => {
    for (const natural of [
      { width: 400, height: 200 },
      { width: 200, height: 400 },
      { width: 100, height: 100 },
      { width: 3, height: 7 },
    ]) {
      for (const focus of [0, 20, 50, 80, 100]) {
        const box = coverRect(natural, FRAME, focus, focus)
        expect(box.x).toBeLessThanOrEqual(FRAME.x + 1e-9)
        expect(box.y).toBeLessThanOrEqual(FRAME.y + 1e-9)
        expect(box.x + box.width).toBeGreaterThanOrEqual(FRAME.x + FRAME.width - 1e-9)
        expect(box.y + box.height).toBeGreaterThanOrEqual(FRAME.y + FRAME.height - 1e-9)
      }
    }
  })

  it('keeps the picture’s ratio', () => {
    const box = coverRect({ width: 640, height: 480 }, FRAME, 50, 50)

    expect(box.width / box.height).toBeCloseTo(640 / 480)
  })

  it('draws a picture of no known size at the frame', () => {
    expect(coverRect(null, FRAME, 20, 80)).toEqual(FRAME)
    expect(coverRect({ width: 0, height: 0 }, FRAME, 20, 80)).toEqual(FRAME)
  })
})
