import type { BookStyle } from './bookOptionsV2'
import type { PlanPage } from './bookPlan'
import { BOOK_STYLE_DEFS } from './bookStyles'
import { BOOK_TEMPLATES, pageCountOf, type TemplateId } from './bookTemplates'

/** The printer's version (spec 26, 4.8): 210 mm square, 3 mm of bleed on each edge. */
export const PRINT_TRIM_MM = 210
export const PRINT_BLEED_MM = 3
export const PRINT_PAGE_MM = PRINT_TRIM_MM + 2 * PRINT_BLEED_MM
/** Text stays this far from the cut edge. */
export const PRINT_SAFE_MM = 10
/** Photographs that are not full-page keep this far from the edge, binding side included. */
export const PRINT_BINDING_MM = 15
export const PRINT_MIN_PAGES = 24
export const PRINT_MAX_PAGES = 200

export type PrintPlan =
  | { readonly kind: 'ready'; readonly pages: readonly PlanPage[] }
  | { readonly kind: 'tooManyPages'; readonly pageCount: number }

/**
 * The page standing in for a `wide` photograph, which cannot print across a gutter:
 * `chapter` + `full` for a style that allows full bleed or polaroids, `chapter` + `single` otherwise.
 * Both fill the two pages `wide` covered, so parity never changes.
 */
const wideReplacement = (style: BookStyle): TemplateId =>
  BOOK_STYLE_DEFS[style].wide ? 'full' : 'single'

/**
 * The same plan for the printer: `wide` replaced, blanks added before `thanks` up to 24 pages,
 * and no version at all above 200 pages (the screen book is still made).
 * The plan always ends with `thanks` then `end`, `end` being last.
 */
export const planForPrint = (pages: readonly PlanPage[], style: BookStyle): PrintPlan => {
  const expanded = pages.flatMap((page): PlanPage[] =>
    page.template === 'wide'
      ? [
          { ...page, template: 'chapter', slots: [] },
          { ...page, template: wideReplacement(style) },
        ]
      : [page],
  )
  const count = pageCountOf(expanded)
  if (count > PRINT_MAX_PAGES) return { kind: 'tooManyPages', pageCount: count }
  const padding = Math.max(0, PRINT_MIN_PAGES - count)
  const blanks: PlanPage[] = Array.from({ length: padding }, () => ({
    template: 'blank',
    slots: [],
  }))
  const at = expanded.length - 2
  return { kind: 'ready', pages: [...expanded.slice(0, at), ...blanks, ...expanded.slice(at)] }
}

const mmOf = (pct: number): number => (pct / 100) * PRINT_TRIM_MM

interface Box {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/** Is a box closer than the given distance to one of the four cut edges of the 210 mm page? */
export const closeToEdge = (box: Box, minMm: number): boolean =>
  [mmOf(box.x), mmOf(box.y), mmOf(100 - box.x - box.w), mmOf(100 - box.y - box.h)].some(
    (distance) => distance < minMm,
  )

const indexesWhere = <T>(items: readonly T[], test: (item: T) => boolean): number[] =>
  [...items.keys()].filter((index) => test(items[index]!))

/** Text boxes closer than 10 mm to the cut edge, by template: empty for a safe template. */
export const unsafeTextBoxes = (template: TemplateId): number[] =>
  indexesWhere(BOOK_TEMPLATES[template].texts, (box) => closeToEdge(box, PRINT_SAFE_MM))

/** Photograph slots (other than full-page ones) closer than 15 mm to an edge. */
export const unsafePhotoSlots = (template: TemplateId): number[] =>
  indexesWhere(
    BOOK_TEMPLATES[template].slots,
    (slot) => !(slot.w === 100 && slot.h === 100) && closeToEdge(slot, PRINT_BINDING_MM),
  )
