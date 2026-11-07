import { describe, expect, it } from 'vitest'
import { Dimensions } from '../photos/dimensions'
import {
  containInBox,
  estimatePageCount,
  pageOrientationFor,
  photoPageCount,
} from './bookLayout'

const dims = (w: number, h: number): Dimensions => {
  const r = Dimensions.create(w, h)
  if (!r.ok) throw new Error('bad dimensions')
  return r.value
}

describe('book layout', () => {
  it('counts photo pages, the last one incomplete', () => {
    expect(photoPageCount('one', 5)).toBe(5)
    expect(photoPageCount('four', 8)).toBe(2)
    expect(photoPageCount('four', 9)).toBe(3)
  })
  it('estimates cover + photo pages + closing page, and zero for no photo', () => {
    expect(estimatePageCount('four', 9)).toBe(5)
    expect(estimatePageCount('one', 1)).toBe(3)
    expect(estimatePageCount('one', 0)).toBe(0)
  })
  it('puts a landscape photo on a landscape page only when alone on it', () => {
    expect(pageOrientationFor('one', dims(400, 300))).toBe('landscape')
    expect(pageOrientationFor('one', dims(300, 400))).toBe('portrait')
    expect(pageOrientationFor('one', dims(300, 300))).toBe('portrait')
    expect(pageOrientationFor('four', dims(400, 300))).toBe('portrait')
  })
  it('contains a photo in its cell, centred, never cropped or distorted', () => {
    const wide = containInBox(dims(400, 200), { width: 100, height: 100 })
    expect(wide).toEqual({ width: 100, height: 50, x: 0, y: 25 })
    const tall = containInBox(dims(200, 400), { width: 100, height: 100 })
    expect(tall).toEqual({ width: 50, height: 100, x: 25, y: 0 })
  })
})
