import { describe, expect, it } from 'vitest'
import { WALL_LAYOUTS, isWallLayout, wallLayoutSpec, type WallLayout } from './wallLayout'

const SLOT_COUNTS: [WallLayout, number][] = [
  ['spotlight', 1],
  ['mosaic', 6],
  ['polaroid', 3],
  ['filmstrip', 5],
]

describe('isWallLayout', () => {
  it.each([...WALL_LAYOUTS])('accepts %s, which a host can pick', (layout) => {
    expect(isWallLayout(layout)).toBe(true)
  })

  it('refuses a layout name the wall cannot render', () => {
    expect(isWallLayout('carousel')).toBe(false)
  })

  it('refuses a stored setting that is not a string', () => {
    expect(isWallLayout(3)).toBe(false)
  })

  it('refuses a missing setting', () => {
    expect(isWallLayout(null)).toBe(false)
  })
})

describe('wallLayoutSpec', () => {
  it.each(SLOT_COUNTS)('%s shows %i photos at once', (layout, slotCount) => {
    expect(wallLayoutSpec(layout).slotCount).toBe(slotCount)
  })

  it('never crops in any layout but the single-photo one', () => {
    const uncropped = WALL_LAYOUTS.filter((layout) => !wallLayoutSpec(layout).crops)

    expect(uncropped).toEqual(['spotlight'])
  })

  it('hides captions in the layouts too small to read them across the room', () => {
    const captioned = WALL_LAYOUTS.filter((layout) => wallLayoutSpec(layout).showsCaption)

    expect(captioned).toEqual(['spotlight', 'polaroid'])
  })

  it.each([...WALL_LAYOUTS])('credits the author in %s exactly when it shows a caption', (l) => {
    const spec = wallLayoutSpec(l)

    expect(spec.showsAuthor).toBe(spec.showsCaption)
  })
})
