import { describe, expect, it } from 'vitest'
import {
  BOOK_MAX_CROP,
  BOOK_TEMPLATES,
  PHOTO_PAGE_TEMPLATES,
  TEMPLATE_IDS,
  cropCeilingFor,
  cropLoss,
  pageCountOf,
  withinCropCeiling,
  type TemplateId,
  type TemplateSlot,
} from './bookTemplates'

const slotOf = (w: number, h: number, contain = false): TemplateSlot => ({
  x: 0,
  y: 0,
  w,
  h,
  role: 'photo',
  ...(contain ? { contain: true as const } : {}),
})

describe('templates', () => {
  it('describe every id, each under its own key', () => {
    for (const id of TEMPLATE_IDS) expect(BOOK_TEMPLATES[id].id).toBe(id)
  })

  it('keep every slot and text box inside the page', () => {
    for (const template of Object.values(BOOK_TEMPLATES)) {
      for (const box of [...template.slots, ...template.texts]) {
        expect(box.x).toBeGreaterThanOrEqual(0)
        expect(box.y).toBeGreaterThanOrEqual(0)
        expect(box.x + box.w).toBeLessThanOrEqual(100)
        expect(box.y + box.h).toBeLessThanOrEqual(100)
        expect(box.w).toBeGreaterThan(0)
        expect(box.h).toBeGreaterThan(0)
      }
    }
  })

  it('never overlap two photograph slots of one page', () => {
    for (const { id, slots } of Object.values(BOOK_TEMPLATES)) {
      slots.forEach((a, i) =>
        slots.slice(i + 1).forEach((b) => {
          const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y
          expect(apart, `${id} slots ${i} overlap`).toBe(true)
        }),
      )
    }
  })

  it('give each page of several photographs exactly as many slots as its key says', () => {
    for (const [count, ids] of Object.entries(PHOTO_PAGE_TEMPLATES)) {
      for (const id of ids) expect(BOOK_TEMPLATES[id].slots).toHaveLength(Number(count))
    }
  })

  it('give the heroes a slot only where the mock-up has one', () => {
    const withHero = TEMPLATE_IDS.filter((id) =>
      BOOK_TEMPLATES[id].slots.some((s) => s.role === 'hero'),
    )
    expect(withHero).toEqual([
      'full',
      'single',
      'heroTwo',
      'portraitHero',
      'threePortraits',
      'wide',
      'favourites',
    ])
  })

  it('make only `wide` span a double page, and only single and favourites contain', () => {
    expect(TEMPLATE_IDS.filter((id) => BOOK_TEMPLATES[id].span === 2)).toEqual(['wide'])
    expect(
      TEMPLATE_IDS.filter((id) => BOOK_TEMPLATES[id].slots.some((s) => s.contain === true)),
    ).toEqual(['single', 'favourites'])
  })
})

describe('how much of the page the photographs take', () => {
  const share = (id: TemplateId): number =>
    BOOK_TEMPLATES[id].slots.reduce((sum, slot) => sum + slot.w * slot.h, 0) / 100

  // A page of photographs that leaves most of itself empty is a page nobody keeps: a floor per
  // number of photographs, each one the least its templates reach with every photograph inside the
  // 20 % crop ceiling. Two photographs cannot take more than about 54 % of a square page at the
  // shapes phones make, six cells (the burst page) about 48 %, three or four 59 to 68 %.
  const FLOORS: Readonly<Record<string, number>> = { '2': 50, '3': 60, '4': 55, '6': 45 }

  it.each(Object.entries(PHOTO_PAGE_TEMPLATES))(
    'keeps the %s-photograph templates above their floor',
    (count, ids) => {
      for (const id of ids) {
        expect(share(id), id).toBeGreaterThanOrEqual(FLOORS[count] as number)
      }
    },
  )

  it('keeps the margins of the page: nothing nearer than 7 % to an edge', () => {
    for (const id of Object.values(PHOTO_PAGE_TEMPLATES).flat()) {
      for (const slot of BOOK_TEMPLATES[id].slots) {
        expect(
          Math.min(slot.x, slot.y, 100 - slot.x - slot.w, 100 - slot.y - slot.h),
          id,
        ).toBeGreaterThanOrEqual(7.14)
      }
    }
  })
})

describe('cropLoss', () => {
  it('is nothing for a photograph that has the shape of its slot', () => {
    expect(cropLoss({ width: 300, height: 200 }, slotOf(60, 40), 1)).toBeCloseTo(0, 12)
  })
  it('is 1 minus visible over total area, for a wider or a taller photograph alike', () => {
    expect(cropLoss({ width: 200, height: 100 }, slotOf(50, 50), 1)).toBeCloseTo(0.5, 12)
    expect(cropLoss({ width: 100, height: 200 }, slotOf(50, 50), 1)).toBeCloseTo(0.5, 12)
  })
  it('is nothing for a contained slot, however different the shapes', () => {
    expect(cropLoss({ width: 100, height: 900 }, slotOf(76, 66, true), 1)).toBe(0)
  })
  it('counts a double page as twice as wide', () => {
    expect(cropLoss({ width: 200, height: 100 }, slotOf(100, 100), 2)).toBeCloseTo(0, 12)
    expect(cropLoss({ width: 200, height: 100 }, slotOf(100, 100), 1)).toBeCloseTo(0.5, 12)
  })
  it('accepts exactly 20 % and refuses 21 %', () => {
    expect(BOOK_MAX_CROP).toBe(0.2)
    expect(withinCropCeiling(cropLoss({ width: 80, height: 100 }, slotOf(50, 50), 1))).toBe(true)
    expect(withinCropCeiling(cropLoss({ width: 79, height: 100 }, slotOf(50, 50), 1))).toBe(false)
  })
})

describe('cropCeilingFor', () => {
  it('lets only a full-bleed full page lose 30 %', () => {
    expect(cropCeilingFor('full', true)).toBe(0.3)
    expect(cropCeilingFor('full', false)).toBe(0.2)
    expect(cropCeilingFor('heroTwo', true)).toBe(0.2)
    expect(withinCropCeiling(0.25, cropCeilingFor('full', true))).toBe(true)
    expect(withinCropCeiling(0.31, cropCeilingFor('full', true))).toBe(false)
  })
})

describe('pageCountOf', () => {
  it('counts a wide page for two', () => {
    expect(pageCountOf([{ template: 'wide' }, { template: 'single' }])).toBe(3)
  })
})
