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

/**
 * How many slots a layout may hold and still play video in every one of them.
 *
 * Two, because that is what a venue mini-PC already driving a 1080p projector decodes
 * without dropping frames. Twelve simultaneous decodes is not a slower wall, it is a
 * stuttering one, for eight hours, with nobody in the room able to fix it.
 */
const MAX_PLAYING_SLOTS = 2

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

  it('plays a clip only in the two layouts a projector can decode', () => {
    const playing = WALL_LAYOUTS.filter((layout) => wallLayoutSpec(layout).playsVideo)

    // Named rather than counted, because this is the decision itself and not a property
    // of it: the four grid layouts show a clip's poster frame, which costs them nothing
    // — `displayUrl` already points at it.
    expect(playing).toEqual(['spotlight', 'split'])
  })

  it('keeps every layout that plays inside the projector’s decode budget', () => {
    // The reason for the list above, stated as the rule behind it. A venue mini-PC is
    // already driving the wall; a layout that plays one video per slot is affordable at
    // two slots and is dropped frames at twelve, so a seventh layout may only be given
    // `playsVideo` if it is small enough to pay for it.
    //
    // Written as a filter rather than as a per-layout `if`: parameterising over all six
    // and skipping four of them inside the body is four cases that assert nothing while
    // the report says they passed.
    const budgets = WALL_LAYOUTS.filter((layout) => wallLayoutSpec(layout).playsVideo).map(
      (layout) => wallLayoutSpec(layout).slotCount,
    )

    expect(budgets.length).toBeGreaterThan(0)
    for (const slotCount of budgets) expect(slotCount).toBeLessThanOrEqual(MAX_PLAYING_SLOTS)
  })
})
