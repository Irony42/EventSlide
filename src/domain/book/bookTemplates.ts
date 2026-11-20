/**
 * The pages a book is made of, as geometry in percent of a square page (spec 26, 4.5).
 * The geometry is common to every style; a style adds margins, frames and rotations.
 */
export const TEMPLATE_IDS = [
  'full',
  'single',
  'twoStack',
  'twoSide',
  'heroTwo',
  'grid4',
  'strip6',
  'portraitHero',
  'threePortraits',
  'grid4Portrait',
  'wide',
  'chapter',
  'quote',
  'messages',
  'title',
  'contents',
  'stats',
  'favourites',
  'thanks',
  'end',
  'blank',
] as const
export type TemplateId = (typeof TEMPLATE_IDS)[number]

export interface TemplateSlot {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly role: 'hero' | 'photo'
  /** Contained whole instead of filling the slot: never cropped. */
  readonly contain?: true
}

export interface TemplateText {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

export interface BookTemplate {
  readonly id: TemplateId
  /** How many page widths the template covers: `wide` runs over a double page. */
  readonly span: 1 | 2
  readonly slots: readonly TemplateSlot[]
  readonly texts: readonly TemplateText[]
}

const photo = (x: number, y: number, w: number, h: number): TemplateSlot => ({
  x,
  y,
  w,
  h,
  role: 'photo',
})
const hero = (x: number, y: number, w: number, h: number): TemplateSlot => ({
  x,
  y,
  w,
  h,
  role: 'hero',
})

export const BOOK_TEMPLATES: Readonly<Record<TemplateId, BookTemplate>> = {
  full: { id: 'full', span: 1, slots: [hero(0, 0, 100, 100)], texts: [] },
  single: {
    id: 'single',
    span: 1,
    slots: [{ x: 12, y: 10, w: 76, h: 66, role: 'hero', contain: true }],
    texts: [{ x: 12, y: 80, w: 76, h: 6 }],
  },
  twoStack: {
    id: 'twoStack',
    span: 1,
    slots: [photo(17, 8, 66, 41), photo(17, 51, 66, 41)],
    texts: [],
  },
  twoSide: {
    id: 'twoSide',
    span: 1,
    slots: [photo(8, 17, 41, 66), photo(51, 17, 41, 66)],
    texts: [],
  },
  heroTwo: {
    id: 'heroTwo',
    span: 1,
    slots: [hero(8, 8, 84, 52), photo(8, 63, 41, 29), photo(51, 63, 41, 29)],
    texts: [],
  },
  grid4: {
    id: 'grid4',
    span: 1,
    slots: [photo(8, 8, 41, 41), photo(51, 8, 41, 41), photo(8, 51, 41, 41), photo(51, 51, 41, 41)],
    texts: [],
  },
  strip6: {
    id: 'strip6',
    span: 1,
    slots: [0, 1, 2, 3, 4, 5].map((i) =>
      photo(8 + (i % 3) * 28.75, 19 + Math.floor(i / 3) * 32, 26.5, 30),
    ),
    texts: [],
  },
  // The phone portrait (3:4) is what most guests send: a tall hero and two squarer photographs
  // (`threePortraits` is the same page mirrored, so the two alternate), and four cells of 3:4.
  portraitHero: {
    id: 'portraitHero',
    span: 1,
    slots: [hero(8, 8, 51, 84), photo(61, 12, 31, 37), photo(61, 51, 31, 37)],
    texts: [],
  },
  threePortraits: {
    id: 'threePortraits',
    span: 1,
    slots: [photo(8, 12, 31, 37), photo(8, 51, 31, 37), hero(41, 8, 51, 84)],
    texts: [],
  },
  grid4Portrait: {
    id: 'grid4Portrait',
    span: 1,
    slots: [
      photo(12, 8, 36, 41),
      photo(52, 8, 36, 41),
      photo(12, 51, 36, 41),
      photo(52, 51, 36, 41),
    ],
    texts: [],
  },
  wide: { id: 'wide', span: 2, slots: [hero(0, 0, 100, 100)], texts: [] },
  chapter: { id: 'chapter', span: 1, slots: [], texts: [{ x: 20, y: 34, w: 60, h: 32 }] },
  quote: { id: 'quote', span: 1, slots: [], texts: [{ x: 16, y: 38, w: 68, h: 24 }] },
  messages: {
    id: 'messages',
    span: 1,
    slots: [],
    texts: [
      { x: 11, y: 15, w: 36, h: 20 },
      { x: 53, y: 15, w: 36, h: 20 },
      { x: 11, y: 42, w: 36, h: 20 },
      { x: 53, y: 42, w: 36, h: 20 },
      { x: 11, y: 69, w: 36, h: 20 },
      { x: 53, y: 69, w: 36, h: 20 },
    ],
  },
  title: { id: 'title', span: 1, slots: [], texts: [{ x: 20, y: 36, w: 60, h: 22 }] },
  contents: {
    id: 'contents',
    span: 1,
    slots: [],
    texts: [
      { x: 15, y: 12, w: 70, h: 8 },
      { x: 15, y: 30, w: 70, h: 44 },
    ],
  },
  stats: {
    id: 'stats',
    span: 1,
    slots: [],
    texts: [
      { x: 15, y: 26, w: 32, h: 20 },
      { x: 53, y: 26, w: 32, h: 20 },
      { x: 15, y: 54, w: 32, h: 20 },
      { x: 53, y: 54, w: 32, h: 20 },
    ],
  },
  // A reminder of loved photographs already in the book: contained, never cropped.
  favourites: {
    id: 'favourites',
    span: 1,
    slots: [
      { x: 8, y: 8, w: 56, h: 56, role: 'hero', contain: true },
      { x: 67, y: 8, w: 25, h: 26, role: 'photo', contain: true },
      { x: 67, y: 38, w: 25, h: 26, role: 'photo', contain: true },
      { x: 8, y: 67, w: 41, h: 25, role: 'photo', contain: true },
      { x: 51, y: 67, w: 41, h: 25, role: 'photo', contain: true },
    ],
    texts: [],
  },
  thanks: {
    id: 'thanks',
    span: 1,
    slots: [],
    texts: [
      { x: 15, y: 12, w: 70, h: 8 },
      { x: 13, y: 30, w: 74, h: 50 },
    ],
  },
  end: {
    id: 'end',
    span: 1,
    slots: [],
    texts: [
      { x: 15, y: 40, w: 70, h: 10 },
      { x: 25, y: 86, w: 50, h: 4 },
    ],
  },
  blank: { id: 'blank', span: 1, slots: [], texts: [] },
}

/** Pages that carry the chapters' photographs, by how many photographs they hold. */
export const PHOTO_PAGE_TEMPLATES: Readonly<Record<number, readonly TemplateId[]>> = {
  2: ['twoStack', 'twoSide'],
  3: ['heroTwo', 'portraitHero', 'threePortraits'],
  4: ['grid4', 'grid4Portrait'],
  6: ['strip6'],
}

/** The most a photograph may be cropped by the slot it fills (20 %). */
export const BOOK_MAX_CROP = 0.2

/**
 * The share of a photograph lost when it fills `slot`, 0 for a contained one:
 * `1 - visible area / photo area`. A square page is assumed; `span` widens it for a double page.
 */
export const cropLoss = (
  photoSize: { readonly width: number; readonly height: number },
  slot: TemplateSlot,
  span: 1 | 2,
): number => {
  if (slot.contain === true) return 0
  const slotAspect = (slot.w * span) / slot.h
  const photoAspect = photoSize.width / photoSize.height
  return 1 - Math.min(slotAspect, photoAspect) / Math.max(slotAspect, photoAspect)
}

/**
 * What a photograph on a full-bleed page may lose (Magazine's `full`): a 3:4 portrait on a square
 * page loses 25 %, and a page that runs to the edge is drawn to be bold.
 */
export const BOOK_MAX_CROP_FULL_BLEED = 0.3

/** The ceiling that applies to a template in a style that does, or does not, bleed. */
export const cropCeilingFor = (template: TemplateId, fullBleed: boolean): number =>
  fullBleed && template === 'full' ? BOOK_MAX_CROP_FULL_BLEED : BOOK_MAX_CROP

/** A tolerance for the arithmetic of a ratio sitting exactly on the ceiling. */
const EPSILON = 1e-9

export const withinCropCeiling = (loss: number, ceiling: number = BOOK_MAX_CROP): boolean =>
  loss <= ceiling + EPSILON

/** Pages a template list occupies: `wide` counts for two. */
export const pageCountOf = (pages: readonly { readonly template: TemplateId }[]): number =>
  pages.reduce((total, page) => total + BOOK_TEMPLATES[page.template].span, 0)
