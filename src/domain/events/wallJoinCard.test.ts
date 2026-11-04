import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WALL_QR_SCALE,
  WALL_QR_SCALE_MARKS,
  WALL_QR_SCALE_MAX,
  WALL_QR_SCALE_MIN,
  effectiveQrScale,
  isWallQrPlacement,
  isWallQrScale,
  qrModuleCount,
  smallScaleFloor,
} from './wallJoinCard'

describe('the wall invitation card (spec 14)', () => {
  it('defaults to today’s card and has the three old sizes as marks', () => {
    expect(DEFAULT_WALL_QR_SCALE).toBe(1)
    expect(WALL_QR_SCALE_MARKS).toEqual({ small: 0.8, medium: 1, large: 1.3 })
    expect(Object.values(WALL_QR_SCALE_MARKS).every(isWallQrScale)).toBe(true)
  })

  it('accepts the whole 0.05 grid from the minimum to the maximum and nothing else', () => {
    for (let i = 0; i <= 14; i += 1) {
      expect(isWallQrScale(Math.round((WALL_QR_SCALE_MIN + i * 0.05) * 100) / 100)).toBe(true)
    }
    expect(isWallQrScale(WALL_QR_SCALE_MIN - 0.05)).toBe(false)
    expect(isWallQrScale(WALL_QR_SCALE_MAX + 0.05)).toBe(false)
    expect(isWallQrScale(1.01)).toBe(false)
    expect(isWallQrScale('1')).toBe(false)
    expect(isWallQrScale(Number.POSITIVE_INFINITY)).toBe(false)
  })

  it('knows the four corners', () => {
    expect(isWallQrPlacement('top-start')).toBe(true)
    expect(isWallQrPlacement('left')).toBe(false)
    expect(isWallQrPlacement(null)).toBe(false)
  })

  it('floors the scale at 0.8 for a short link and lifts it toward 1 for a long one', () => {
    expect(smallScaleFloor(29)).toBe(0.8)
    expect(smallScaleFloor(33)).toBeCloseTo(0.8815, 4)
    expect(smallScaleFloor(37)).toBeCloseTo(0.9675, 4)
    expect(smallScaleFloor(41)).toBe(1)
    expect(smallScaleFloor(80)).toBe(1)
  })

  it('draws the larger of the host’s scale and the floor of this link', () => {
    expect(effectiveQrScale(0.8, 29)).toBe(0.8)
    expect(effectiveQrScale(0.8, 37)).toBeCloseTo(0.9675, 4)
    expect(effectiveQrScale(1.2, 37)).toBe(1.2)
    expect(effectiveQrScale(1, 29)).toBe(1)
  })
})

describe('the module count of a link (spec 14)', () => {
  it.each([
    [1, 21],
    [14, 21],
    [15, 25],
    [34, 29],
    [42, 29],
    [43, 33],
    [50, 33],
    [62, 33],
    [63, 37],
    [84, 37],
    [85, 41],
    [106, 41],
    [107, 45],
    [500, 45],
  ])('%i bytes need %i modules', (bytes, modules) => {
    expect(qrModuleCount(bytes)).toBe(modules)
  })
})
