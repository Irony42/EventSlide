import type { BookPreviewDto, BookPreviewPageDto } from '../../../lib/api/dto'

/**
 * One face of the book as the reader turns it. The screen PDF is the cover, the inside of the cover,
 * the plan's pages (a `wide` photograph is two faces) and, here only, the inside of the back cover and
 * the back cover: the file has neither, the printer version does.
 */
export type Sheet =
  | { readonly kind: 'cover' }
  | { readonly kind: 'inside' }
  | { readonly kind: 'blank' }
  | { readonly kind: 'back' }
  | {
      readonly kind: 'page'
      readonly page: BookPreviewPageDto
      /** Index in the plan's pages. */
      readonly index: number
      /** The half of a double-page photograph this face shows. */
      readonly half: 'left' | 'right' | null
      /** The page number the contents page and the plan use (the title page is 1). */
      readonly number: number
    }

/** What the reader sees at once: a left face and a right face, either of which may be absent. */
export interface Spread {
  /** The index, in the faces, of the first face it shows. */
  readonly at: number
  readonly left: Sheet | null
  readonly right: Sheet | null
}

/** Every face in reading order, from the cover to the back cover. */
export const sheetsOf = (preview: BookPreviewDto): readonly Sheet[] => {
  const sheets: Sheet[] = [{ kind: 'cover' }, { kind: 'inside' }]
  let number = 1
  preview.pages.forEach((page, index) => {
    if (page.span === 2) {
      sheets.push({ kind: 'page', page, index, half: 'left', number })
      sheets.push({ kind: 'page', page, index, half: 'right', number: number + 1 })
    } else {
      sheets.push({ kind: 'page', page, index, half: null, number })
    }
    number += page.span
  })
  // The plan has an even number of pages: the last one is a left page, so the inside of the back
  // cover faces it.
  sheets.push({ kind: 'blank' }, { kind: 'back' })
  return sheets
}

/**
 * The spreads of a book lying open: the cover alone on the right, then the faces two by two, then the
 * back cover alone on the left.
 */
export const spreadsOf = (sheets: readonly Sheet[]): readonly Spread[] => {
  const spreads: Spread[] = [{ at: 0, left: null, right: sheets[0] ?? null }]
  const last = sheets.length - 1
  for (let i = 1; i < last; i += 2) {
    spreads.push({ at: i, left: sheets[i] ?? null, right: sheets[i + 1] ?? null })
  }
  spreads.push({ at: last, left: sheets[last] ?? null, right: null })
  return spreads
}

/** One face at a time: what a phone shows. */
export const singlesOf = (sheets: readonly Sheet[]): readonly Spread[] =>
  sheets.map((sheet, at) => ({ at, left: sheet, right: null }))

/** The index of the first spread that holds a face satisfying `wanted`, or `null`. */
export const findSpread = (
  spreads: readonly Spread[],
  wanted: (sheet: Sheet) => boolean,
): number | null => {
  const at = spreads.findIndex(
    (spread) =>
      (spread.left !== null && wanted(spread.left)) ||
      (spread.right !== null && wanted(spread.right)),
  )
  return at < 0 ? null : at
}

/** The spread that shows a face: the last one that starts at or before it. */
export const spreadOfFace = (spreads: readonly Spread[], face: number): number => {
  let found = 0
  spreads.forEach((spread, index) => {
    if (spread.at <= face) found = index
  })
  return found
}
