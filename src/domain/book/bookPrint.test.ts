import { describe, expect, it } from 'vitest'
import { asPhotoId } from '../shared/ids'
import type { PlanPage } from './bookPlan'
import {
  PRINT_MAX_PAGES,
  PRINT_MIN_PAGES,
  PRINT_PAGE_MM,
  closeToEdge,
  planForPrint,
  unsafePhotoSlots,
  unsafeTextBoxes,
} from './bookPrint'
import { TEMPLATE_IDS, pageCountOf, type TemplateId } from './bookTemplates'

const page = (template: TemplateId): PlanPage => ({ template, slots: [] })
const photoPage = (template: TemplateId, id: string): PlanPage => ({
  template,
  slots: [{ photoId: asPhotoId(id) }],
  chapter: 0,
})
const ending = [page('thanks'), page('end')]

describe('planForPrint', () => {
  it('has a page 216 mm wide: 210 plus 3 mm of bleed on each edge', () => {
    expect(PRINT_PAGE_MM).toBe(216)
  })

  it('replaces a wide opening by chapter + full for a full-bleed style, keeping the page count', () => {
    const pages = [page('title'), page('stats'), photoPage('wide', 'a'), ...ending]
    const plan = planForPrint(pages, 'magazine')
    if (plan.kind !== 'ready') throw new Error('expected a printer version')
    expect(plan.pages.some((p) => p.template === 'wide')).toBe(false)
    const at = plan.pages.findIndex((p) => p.template === 'chapter')
    expect(plan.pages[at + 1]).toMatchObject({ template: 'full', chapter: 0 })
    expect(plan.pages[at + 1]!.slots).toEqual([{ photoId: 'a' }])
    expect(plan.pages[at]!.slots).toEqual([])
    const unpadded = pageCountOf(pages)
    expect(pageCountOf(pages)).toBe(unpadded)
  })

  it('uses chapter + single for a style that is never full bleed', () => {
    const plan = planForPrint([photoPage('wide', 'a'), ...ending], 'classique')
    if (plan.kind !== 'ready') throw new Error('expected a printer version')
    expect(plan.pages.find((p) => p.template === 'single')).toBeDefined()
    expect(plan.pages.find((p) => p.template === 'full')).toBeUndefined()
  })

  it('pads with blanks before thanks up to 24 pages, and ends with thanks then end', () => {
    const plan = planForPrint([page('title'), page('stats'), ...ending], 'souvenir')
    if (plan.kind !== 'ready') throw new Error('expected a printer version')
    expect(pageCountOf(plan.pages)).toBe(PRINT_MIN_PAGES)
    expect(plan.pages.slice(-2).map((p) => p.template)).toEqual(['thanks', 'end'])
    expect(plan.pages.slice(2, -2).every((p) => p.template === 'blank')).toBe(true)
    expect(plan.pages).toHaveLength(24)
  })

  it('adds nothing to a book that already has 24 pages', () => {
    const pages = [...Array.from({ length: 22 }, () => page('single')), ...ending]
    const plan = planForPrint(pages, 'classique')
    expect(plan).toEqual({ kind: 'ready', pages })
  })

  it('accepts 200 pages and refuses 202 (the screen book is still made)', () => {
    const make = (count: number): PlanPage[] => [
      ...Array.from({ length: count - 2 }, () => page('single')),
      ...ending,
    ]
    expect(planForPrint(make(PRINT_MAX_PAGES), 'classique').kind).toBe('ready')
    expect(planForPrint(make(PRINT_MAX_PAGES + 2), 'classique')).toEqual({
      kind: 'tooManyPages',
      pageCount: 202,
    })
  })
})

describe('safe zone', () => {
  it('keeps the text of every template 10 mm from the cut edge', () => {
    for (const id of TEMPLATE_IDS) expect(unsafeTextBoxes(id), id).toEqual([])
  })

  it('keeps every photograph that is not full page 15 mm from the edges', () => {
    for (const id of TEMPLATE_IDS) expect(unsafePhotoSlots(id), id).toEqual([])
  })

  it('does notice a box too close to an edge, on each of the four sides', () => {
    expect(closeToEdge({ x: 4, y: 20, w: 50, h: 10 }, 10)).toBe(true)
    expect(closeToEdge({ x: 20, y: 4, w: 50, h: 10 }, 10)).toBe(true)
    expect(closeToEdge({ x: 20, y: 20, w: 77, h: 10 }, 10)).toBe(true)
    expect(closeToEdge({ x: 20, y: 20, w: 50, h: 77 }, 10)).toBe(true)
    expect(closeToEdge({ x: 5, y: 5, w: 90, h: 90 }, 10)).toBe(false)
  })
})
