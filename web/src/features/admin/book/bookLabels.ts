import type { UiText } from '../../../lib/i18n/translations'
import type { Sheet, Spread } from './bookSpreads'

/** Under this width, in pixels, the viewer shows one face at a time. */
export const SINGLE_BELOW_PX = 560
/** Miniatures are drawn this many spreads around the open one; farther ones are numbered chips. */
export const STRIP_WINDOW = 20

const faceLabel = (text: UiText, sheet: Sheet | null): string => {
  if (sheet === null) return ''
  switch (sheet.kind) {
    case 'cover':
      return text.bookPage.cover
    case 'inside':
      return text.bookPage.inside
    case 'blank':
      return ''
    case 'back':
      return text.bookPage.backCover
    case 'page':
      return text.bookPage.pageNumber(sheet.number)
  }
}

/** What the two faces of a spread are called: "Pages 4 et 5", "Couverture"... */
export const spreadLabel = (text: UiText, spread: Spread): string => {
  const { left, right } = spread
  if (left?.kind === 'page' && right?.kind === 'page') {
    return text.bookPage.pageNumbers(left.number, right.number)
  }
  return [faceLabel(text, left), faceLabel(text, right)].filter((part) => part !== '').join(' · ')
}
