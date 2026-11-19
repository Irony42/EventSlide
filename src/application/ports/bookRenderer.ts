import type { PlanPage, BookPlan } from '../../domain/book/bookPlan'
import type { BookColours, BookStyleDef } from '../../domain/book/bookStyles'
import type { BookTexts } from '../../domain/book/bookTexts'
import type { EventLanguage } from '../../domain/events/eventLanguage'
import type { PhotoId } from '../../domain/shared/ids'
import type { BookChunk } from './bookFileStore'

/** The words one page needs, read again at render time and already safe to draw (`pdfSafeText`). */
export interface PageTexts {
  /** One per photograph slot of the page, in slot order; `null` for no line. */
  readonly captions: readonly (string | null)[]
  /** One per photograph slot: the first name, `null` when authors are off or the guest has none. */
  readonly authors: readonly (string | null)[]
  /** One per photograph slot: the host's mission prompt, `null` when the photograph answers none. */
  readonly missions: readonly (string | null)[]
  /** The messages of a `quote` or `messages` page, in the order of `messageIds`. */
  readonly messages: readonly { readonly text: string; readonly author: string | null }[]
  /** The `thanks` page: who took how many photographs of the book; empty when authors are off. */
  readonly photographers: readonly { readonly name: string; readonly photoCount: number }[]
}

/**
 * Everything the renderer needs to draw a book and nothing else: **it decides nothing**. The plan
 * says what goes where; the style and the colours say how it looks; the texts and the bytes are
 * pulled when a page needs them, so one double page is in memory, never the album.
 */
export interface BookRenderInput {
  readonly plan: BookPlan
  /** The printer version's pages (`planForPrint`), or `null` for a screen book alone. */
  readonly printPages: readonly PlanPage[] | null
  readonly style: BookStyleDef
  readonly colours: BookColours
  readonly language: EventLanguage
  /** The host's zone: the hours of a chapter's subtitle are read in it. */
  readonly timeZone: string
  readonly texts: BookTexts
  readonly cover: {
    /** Already `pdfSafeText`; the date of the first photograph when the host left the subtitle empty. */
    readonly title: string
    readonly subtitle: string
    readonly photoId: PhotoId | null
  }
  /** The event's logo (a PNG or JPEG the pipeline re-encoded), or `null`. */
  readonly logo: Uint8Array | null
  /** The `display` rendition (a JPEG), on demand. A photograph that cannot be read ends the render. */
  photo(id: PhotoId): Promise<Uint8Array>
  /** The words of one page of the plan (of the printer version too: they are the same photographs). */
  pageTexts(page: PlanPage): Promise<PageTexts>
  /** Counts the book's closing page speaks of. */
  readonly closing: {
    readonly videosNote: string | null
    readonly voicesNote: string | null
    readonly extraMessagesNote: string | null
  }
}

/**
 * Draws the book as the interleaved bytes of up to three PDFs (screen, printer interior, printer
 * cover), streamed. Nothing about storage or events lives here: the use case decides what goes in
 * and where the bytes land (`BookFileStore.writeSet`).
 */
export interface BookRenderer {
  render(input: BookRenderInput): AsyncIterable<BookChunk>
}
