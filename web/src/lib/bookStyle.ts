import type { AlbumBookStyle, ThemeAmbiance } from './api/dto'

/**
 * The style an ambiance suggests, so the photo book's form opens on the book that looks like the
 * wall (spec 26). A copy of `defaultBookStyle` in `src/domain/book/bookOptionsV2.ts`, which the web
 * app cannot import; `bookStyle.test.ts` reads that file and fails when the two disagree.
 */
export const defaultBookStyle = (ambiance: ThemeAmbiance): AlbumBookStyle => {
  switch (ambiance) {
    case 'riviera':
    case 'cabaret':
      return 'magazine'
    case 'guinguette':
    case 'bivouac':
      return 'souvenir'
    case 'eventslide':
    case 'champs':
    case 'noces':
    case 'custom':
      return 'classique'
  }
}

/** The styles, in the order the cards are laid out. */
export const BOOK_STYLES: readonly AlbumBookStyle[] = ['classique', 'magazine', 'souvenir']

/** The lengths of a selection and the photographs each aims at (`BOOK_SELECTION_TARGETS` on the server). */
export const BOOK_LENGTHS = ['short', 'medium', 'long'] as const
export type BookLength = (typeof BOOK_LENGTHS)[number]
export const BOOK_LENGTH_TARGET: Readonly<Record<BookLength, 60 | 120 | 200>> = {
  short: 60,
  medium: 120,
  long: 200,
}

/** The most pages a printer accepts (`PRINT_MAX_PAGES` on the server). */
export const BOOK_PRINT_MAX_PAGES = 200
