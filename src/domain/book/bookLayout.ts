import type { Dimensions, Orientation } from '../photos/dimensions'

export const BOOK_LAYOUTS = ['one', 'four'] as const
export type BookLayout = (typeof BOOK_LAYOUTS)[number]

export const isBookLayout = (value: unknown): value is BookLayout =>
  typeof value === 'string' && (BOOK_LAYOUTS as readonly string[]).includes(value)

export const PHOTOS_PER_PAGE: Readonly<Record<BookLayout, number>> = { one: 1, four: 4 }

/** Pages that carry photographs. The last one may be incomplete. */
export const photoPageCount = (layout: BookLayout, photoCount: number): number =>
  Math.ceil(photoCount / PHOTOS_PER_PAGE[layout])

/** Cover + photo pages + closing page; 0 for no photo (there is no book to estimate). */
export const estimatePageCount = (layout: BookLayout, photoCount: number): number =>
  photoCount < 1 ? 0 : photoPageCount(layout, photoCount) + 2

export type BookPage =
  | { readonly kind: 'cover' }
  | { readonly kind: 'photos'; readonly first: number; readonly count: number }
  | { readonly kind: 'end' }

/** The whole book as a list of pages, photographs addressed by their index in the listing. */
export const paginate = (layout: BookLayout, photoCount: number): readonly BookPage[] => {
  if (photoCount < 1) return []
  const perPage = PHOTOS_PER_PAGE[layout]
  const pages: BookPage[] = [{ kind: 'cover' }]
  for (let first = 0; first < photoCount; first += perPage) {
    pages.push({ kind: 'photos', first, count: Math.min(perPage, photoCount - first) })
  }
  pages.push({ kind: 'end' })
  return pages
}

export type PageOrientation = 'portrait' | 'landscape'

/**
 * The page a photograph sits on. One photo per page follows the photograph (a landscape shot
 * on a landscape page); the grid is always portrait.
 */
export const pageOrientationFor = (layout: BookLayout, photo: Dimensions): PageOrientation => {
  const orientation: Orientation = photo.orientation
  return layout === 'one' && orientation === 'landscape' ? 'landscape' : 'portrait'
}

export interface Box {
  readonly width: number
  readonly height: number
}

export interface Placement extends Box {
  readonly x: number
  readonly y: number
}

/**
 * The photograph **contained** in its cell: scaled to the largest size that fits whole,
 * centred. It is never cropped, and never distorted.
 */
export const containInBox = (photo: Dimensions, cell: Box): Placement => {
  const factor = Math.min(cell.width / photo.width, cell.height / photo.height)
  const width = photo.width * factor
  const height = photo.height * factor
  return { width, height, x: (cell.width - width) / 2, y: (cell.height - height) / 2 }
}
