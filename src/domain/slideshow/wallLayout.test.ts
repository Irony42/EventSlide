import { describe, expect, it } from 'vitest'
import { WALL_LAYOUTS, isWallLayout, wallLayoutSpec, type WallLayout } from './wallLayout'

const SLOT_COUNTS: [WallLayout, number][] = [
  ['spotlight', 1],
  ['mosaic', 6],
  ['polaroid', 3],
  ['filmstrip', 5],
  ['collage', 12],
  ['split', 2],
]

/**
 * Twelve photos on a 1080p frame is about 480x270 each before the gap, which is the
 * point at which a face stops being a face from five metres. It is also the ceiling on
 * how many `<img>` elements a layout may hold at once, and that is what keeps an
 * eight-hour run's node count flat.
 */
const MAX_SLOTS = 12

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

  it('crops only where a slot is too small to hold a phone photo whole', () => {
    const uncropped = WALL_LAYOUTS.filter((layout) => !wallLayoutSpec(layout).crops)

    // A full screen and a half screen are both bigger than the photo a phone took, so
    // neither has to cut anybody's head off to fill its slot. Everything below that
    // tessellates, and a host picking one of those is picking the trade.
    expect(uncropped).toEqual(['spotlight', 'split'])
  })

  it('hides captions in the layouts too small to read them across the room', () => {
    const captioned = WALL_LAYOUTS.filter((layout) => wallLayoutSpec(layout).showsCaption)

    expect(captioned).toEqual(['spotlight', 'polaroid', 'split'])
  })

  it.each([...WALL_LAYOUTS])('keeps %s within the number of photos a room can read', (layout) => {
    // The spec is also the cap on how many <img> elements the layout may hold, so this
    // is the line between "a busy wall" and a projector whose node count grows over an
    // evening until the venue's mini PC drops frames.
    const { slotCount } = wallLayoutSpec(layout)

    expect(slotCount).toBeGreaterThanOrEqual(1)
    expect(slotCount).toBeLessThanOrEqual(MAX_SLOTS)
  })

  it.each([...WALL_LAYOUTS])('credits the author in %s exactly when it shows a caption', (l) => {
    const spec = wallLayoutSpec(l)

    expect(spec.showsAuthor).toBe(spec.showsCaption)
  })
})
