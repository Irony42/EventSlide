import { describe, expect, it } from 'vitest'
import { framingAfterDrag } from './usePhotoFraming'

const centre = { focusX: 50, focusY: 50 }

describe('framing a photograph by dragging it', () => {
  it('moves the anchor the other way, in proportion to the room the picture has', () => {
    // A picture 100 px wider than its box: dragging it 25 px right shows 25 % more of its left side.
    expect(framingAfterDrag(centre, { dx: 25, dy: 0 }, { x: 100, y: 0 })).toEqual({
      focusX: 25,
      focusY: 50,
    })
    expect(framingAfterDrag(centre, { dx: 0, dy: -10 }, { x: 0, y: 40 })).toEqual({
      focusX: 50,
      focusY: 75,
    })
  })

  it('never leaves the picture: the anchor stays between 0 and 100', () => {
    expect(framingAfterDrag(centre, { dx: 900, dy: -900 }, { x: 100, y: 100 })).toEqual({
      focusX: 0,
      focusY: 100,
    })
  })

  it('leaves an axis alone when the picture exactly fills the box there', () => {
    expect(
      framingAfterDrag({ focusX: 30, focusY: 70 }, { dx: 80, dy: 80 }, { x: 0, y: 0 }),
    ).toEqual({
      focusX: 30,
      focusY: 70,
    })
  })

  it('keeps whole percents, as the stored preference requires', () => {
    const next = framingAfterDrag(centre, { dx: 7, dy: 0 }, { x: 90, y: 0 })
    expect(Number.isInteger(next.focusX)).toBe(true)
  })
})
