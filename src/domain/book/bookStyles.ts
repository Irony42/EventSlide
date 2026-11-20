import { accentPalette } from '../events/eventTheme'
import { legibleAccent, oklchToHex } from './bookColours'
import type { BookStyle } from './bookOptionsV2'

/**
 * A style is data (spec 26, 4.7): the renderer reads it and decides nothing. The accent is not
 * here: it comes from the event's theme, see `resolveBookColours`.
 */
export interface BookStyleDef {
  readonly id: BookStyle
  readonly paper: string
  readonly ink: string
  readonly titleFont: string
  readonly bodyFont: string
  /** The family a guest's text falls back to when the style's own face lacks a glyph. */
  readonly fallbackFont: 'Noto Sans' | 'Noto Serif'
  /** Margin around photographs, in percent of the page. */
  readonly photoMarginPct: number
  /** May a photograph run to the edge of the page (full, wide)? */
  readonly fullBleed: boolean
  /** May a chapter open on a double-page photograph? */
  readonly wide: boolean
  /** Polaroid frames, tilted by the hash of the photograph's id. */
  readonly polaroid: boolean
  /**
   * The smallest size, in points at 21 cm, of the text of a story page (stats labels, dates, subtitles,
   * contents entries, thanks, closing notes). A handwriting face reads smaller at the same size: Caveat
   * has a small x-height, so Souvenir asks for 11, the others for 9.
   */
  readonly minBodySize: number
}

export const BOOK_STYLE_DEFS: Readonly<Record<BookStyle, BookStyleDef>> = {
  classique: {
    id: 'classique',
    paper: '#f8f5ef',
    ink: '#2b2622',
    titleFont: 'Cormorant Garamond',
    bodyFont: 'Cormorant Garamond',
    fallbackFont: 'Noto Serif',
    photoMarginPct: 10,
    fullBleed: false,
    wide: false,
    polaroid: false,
    minBodySize: 9,
  },
  magazine: {
    id: 'magazine',
    paper: '#ffffff',
    ink: '#111111',
    titleFont: 'Fraunces',
    bodyFont: 'Inter',
    fallbackFont: 'Noto Sans',
    photoMarginPct: 8,
    fullBleed: true,
    wide: true,
    polaroid: false,
    minBodySize: 9,
  },
  souvenir: {
    id: 'souvenir',
    paper: '#d8c3a0',
    ink: '#3a2c1d',
    titleFont: 'Caveat',
    bodyFont: 'Caveat',
    fallbackFont: 'Noto Sans',
    photoMarginPct: 8,
    fullBleed: false,
    wide: true,
    polaroid: true,
    minBodySize: 11,
  },
}

export interface BookColours {
  readonly paper: string
  readonly ink: string
  /** The light tone: rules, tape, badges. */
  readonly accent: string
  /** The accent as text on this paper: at least 4.5:1. */
  readonly accentText: string
  readonly accentStrong: string
  readonly accentInk: string
}

/** The style's colours with the theme's accent as the browser would compute it, in sRGB hex. */
export const resolveBookColours = (style: BookStyle, accentHue: number): BookColours => {
  const palette = accentPalette(accentHue)
  const def = BOOK_STYLE_DEFS[style]
  return {
    paper: def.paper,
    ink: def.ink,
    accent: oklchToHex(palette.accent),
    accentText: legibleAccent(accentHue, def.paper, palette.accent.c),
    accentStrong: oklchToHex(palette.strong),
    accentInk: oklchToHex(palette.ink),
  }
}

/**
 * The tilt of a polaroid, in degrees from -4 to +4, from a hash of the photograph's id (FNV-1a):
 * the same photograph is always tilted the same way, and no clock or random number is involved.
 */
export const polaroidRotation = (photoId: string): number => {
  let hash = 0x811c9dc5
  for (let i = 0; i < photoId.length; i += 1) {
    hash ^= photoId.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return (hash % 801) / 100 - 4
}
