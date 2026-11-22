import type { AlbumBookPreviewInput } from '../../../lib/api/client'
import type { AlbumBookDto, AlbumBookSelection, AlbumBookStyle } from '../../../lib/api/dto'
import {
  BOOK_LENGTH_TARGET,
  BOOK_LENGTHS,
  defaultBookStyle,
  type BookLength,
} from '../../../lib/bookStyle'
import type { ThemeAmbiance } from '../../../lib/api/dto'
import type { Sheet } from './bookSpreads'

/**
 * What the host has chosen on the book page: the settings as the form holds them, which is not
 * quite what the API takes (a length and an "all" switch stand for one `selection`).
 */
export interface BookChoices {
  readonly title: string
  readonly subtitle: string
  readonly style: AlbumBookStyle
  /** Every photograph, when the album fits the book. */
  readonly all: boolean
  readonly length: BookLength
  readonly showAuthors: boolean
  readonly showCaptions: boolean
  readonly guestbook: boolean
  readonly print: boolean
}

export type StoredBook = Exclude<AlbumBookDto, { status: 'none' }>

/** The length a stored selection stands for, `medium` when it is not a selection. */
export const lengthOf = (selection: AlbumBookSelection | undefined): BookLength =>
  BOOK_LENGTHS.find(
    (length) => selection?.kind === 'best' && BOOK_LENGTH_TARGET[length] === selection.target,
  ) ?? 'medium'

/** The browser's own zone, which the book writes its dates in. `UTC` where it cannot be read. */
export const browserTimeZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/**
 * The choices the page opens on: the last book's own when there is one, otherwise what the event
 * suggests (its name, the style of its ambiance, every photograph when the book holds them).
 */
export const initialChoices = (
  last: StoredBook | null,
  event: { readonly name: string; readonly ambiance: ThemeAmbiance },
  albumPhotos: number,
  maxPhotos: number,
): BookChoices => {
  const options = last?.options
  return {
    title: options?.title ?? event.name,
    subtitle: options?.subtitle ?? '',
    style: options?.style ?? defaultBookStyle(event.ambiance),
    all: albumPhotos <= maxPhotos && (options === undefined || options.selection.kind === 'all'),
    length: lengthOf(options?.selection),
    showAuthors: options?.showAuthors ?? true,
    showCaptions: options?.showCaptions ?? true,
    guestbook: options?.includeGuestbook ?? true,
    print: options?.printVersion ?? false,
  }
}

/** What the box lets a book be, and what the album holds now: the choices that are really possible. */
export interface BookLimits {
  readonly photos: number
  readonly messages: number
  readonly maxPhotos: number
  readonly maxMessages: number
  readonly printOffered: boolean
}

/**
 * The options the server is asked about, for the preview and for the request alike: a choice that
 * stopped being possible (every photograph, once the album outgrew the book; the guest book of an
 * album with no message) is not the one sent.
 */
export const optionsOf = (
  choices: BookChoices,
  limits: BookLimits,
): AlbumBookPreviewInput & { readonly printVersion: boolean } => ({
  title: choices.title,
  subtitle: choices.subtitle,
  style: choices.style,
  selection:
    choices.all && limits.photos <= limits.maxPhotos
      ? { kind: 'all' }
      : { kind: 'best', target: BOOK_LENGTH_TARGET[choices.length] },
  showAuthors: choices.showAuthors,
  showCaptions: choices.showCaptions,
  includeGuestbook: limits.messages > 0 && choices.guestbook,
  printVersion: limits.printOffered && choices.print,
  timeZone: browserTimeZone(),
})

/** What a change of setting asks the preview to show: the cover for a title, the guest book... */
export type LookAt = 'cover' | 'messages' | 'captions' | 'authors'

export const SHEET_WANTED: Readonly<Record<LookAt, (sheet: Sheet) => boolean>> = {
  cover: (sheet) => sheet.kind === 'cover',
  messages: (sheet) => sheet.kind === 'page' && sheet.page.template === 'messages',
  captions: (sheet) =>
    sheet.kind === 'page' && sheet.page.photos.some((photo) => photo.caption !== null),
  authors: (sheet) =>
    sheet.kind === 'page' && sheet.page.photos.some((photo) => photo.author !== null),
}
