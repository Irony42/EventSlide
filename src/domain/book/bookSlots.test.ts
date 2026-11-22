import { describe, expect, it } from 'vitest'
import { isContained, slotForStyle } from './bookSlots'
import { BOOK_STYLE_DEFS } from './bookStyles'
import { BOOK_TEMPLATES } from './bookTemplates'

const { classique, magazine, souvenir } = BOOK_STYLE_DEFS

describe('slotForStyle', () => {
  it('gives a full page the single slot in Classique and an inset one in Souvenir', () => {
    expect(slotForStyle(classique, 'full', 0)).toEqual(BOOK_TEMPLATES.single.slots[0])
    expect(slotForStyle(souvenir, 'full', 0)).toEqual({ x: 8, y: 8, w: 84, h: 84, role: 'hero' })
    expect(slotForStyle(magazine, 'full', 0)).toEqual(BOOK_TEMPLATES.full.slots[0])
  })

  it('leaves a lone photograph of a style that bleeds to the edge, and grows the cells of a grid', () => {
    expect(slotForStyle(magazine, 'wide', 0)).toEqual(BOOK_TEMPLATES.wide.slots[0])
    const cell = BOOK_TEMPLATES.grid4.slots[0]!
    expect(slotForStyle(magazine, 'grid4', 0)).toMatchObject({
      x: cell.x - 0.7,
      y: cell.y - 0.7,
      w: cell.w + 1.4,
      h: cell.h + 1.4,
    })
    expect(slotForStyle(classique, 'grid4', 0)).toEqual(cell)
  })

  it('never grows the cells of the favourites page, even in Magazine', () => {
    expect(slotForStyle(magazine, 'favourites', 1)).toEqual(BOOK_TEMPLATES.favourites.slots[1])
  })
})

describe('isContained', () => {
  it('contains a slot that says so, and a full page of Classique only', () => {
    expect(isContained(classique, 'single', BOOK_TEMPLATES.single.slots[0]!)).toBe(true)
    expect(isContained(classique, 'full', BOOK_TEMPLATES.single.slots[0]!)).toBe(true)
    expect(isContained(souvenir, 'full', slotForStyle(souvenir, 'full', 0))).toBe(false)
    expect(isContained(magazine, 'grid4', BOOK_TEMPLATES.grid4.slots[0]!)).toBe(false)
  })
})
