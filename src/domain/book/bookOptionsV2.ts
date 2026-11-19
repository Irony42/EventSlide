import type { EventLanguage } from '../events/eventLanguage'
import type { ThemeAmbiance } from '../events/eventTheme'
import type { BookLayout } from './bookLayout'
import { DEFAULT_BOOK_TIME_ZONE } from './bookTime'

/**
 * The look of a book (spec 26, 4.7). A closed list: adding "Nuit" later is one member here and
 * one entry in `bookStyles.ts`.
 */
export const BOOK_STYLES = ['classique', 'magazine', 'souvenir'] as const
export type BookStyle = (typeof BOOK_STYLES)[number]

/** The three lengths of a selection, in photographs (the host reads "environ 60 photos"). */
export const BOOK_SELECTION_TARGETS = [60, 120, 200] as const
export type BookSelectionTarget = (typeof BOOK_SELECTION_TARGETS)[number]

export type BookSelection =
  { readonly kind: 'all' } | { readonly kind: 'best'; readonly target: BookSelectionTarget }

/** What the host chose, version 2. The title and subtitle are the host's text, not a guest's. */
export interface BookOptionsV2 {
  readonly title: string
  readonly subtitle: string
  readonly language: EventLanguage
  readonly style: BookStyle
  readonly selection: BookSelection
  readonly showAuthors: boolean
  readonly showCaptions: boolean
  readonly includeGuestbook: boolean
  readonly printVersion: boolean
  /** IANA name, from the host's browser; see `normalizeTimeZone`. */
  readonly timeZone: string
}

/** The options a 3.14 client sends: A4, one or four photos a page, no story. */
export interface LegacyBookOptions {
  readonly title: string
  readonly subtitle: string
  readonly language: EventLanguage
  readonly layout: BookLayout
  readonly showAuthors: boolean
  readonly showCaptions: boolean
}

/**
 * The style an ambiance suggests, so the form opens on the book that looks like the wall.
 * The web keeps its own copy (it cannot import `src/`), pinned by a contract test.
 */
export const defaultBookStyle = (ambiance: ThemeAmbiance): BookStyle => {
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

/**
 * The v2 options of a v1 request: what the migration writes into every stored row, and what a
 * page left open across the update gets when it still sends `layout`. The layout is dropped:
 * a v1 book is a Classique book with every photograph and no guest book.
 */
export const legacyBookOptions = (legacy: LegacyBookOptions): BookOptionsV2 => ({
  title: legacy.title,
  subtitle: legacy.subtitle,
  language: legacy.language,
  style: 'classique',
  selection: { kind: 'all' },
  showAuthors: legacy.showAuthors,
  showCaptions: legacy.showCaptions,
  includeGuestbook: false,
  printVersion: false,
  timeZone: DEFAULT_BOOK_TIME_ZONE,
})
