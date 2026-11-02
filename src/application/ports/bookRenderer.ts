import type { BookLayout } from '../../domain/book/bookLayout'

/** One photograph of the book, its bytes already read. Texts are already safe to draw. */
export interface BookPhoto {
  /** The `display` rendition (a JPEG); the renderer may reduce it, it never reads anything else. */
  readonly bytes: Uint8Array
  /** `pdfSafeText` output, or `null` for no line under the photograph. */
  readonly caption: string | null
  /** `pdfSafeText` output, or `null` for no credit. */
  readonly author: string | null
}

export interface BookInput {
  readonly layout: BookLayout
  readonly cover: { readonly title: string; readonly subtitle: string }
  readonly closing: {
    readonly createdWith: string
    /** The line about clips left out, or `null` when there are none. */
    readonly videosNote: string | null
  }
  /**
   * The photographs, **pulled one at a time**: the renderer asks for the next only when it is
   * about to place it, so one page of bytes is in memory, never the album. It ends when the
   * iterable does; a failure in it (the event stopped being readable, shutdown) aborts the
   * render before the closing page.
   */
  readonly photos: AsyncIterable<BookPhoto>
}

/**
 * Draws the book as the bytes of a PDF, streamed. Nothing about storage or events lives here:
 * the use case decides what goes in and where the bytes land.
 */
export interface BookRenderer {
  render(input: BookInput): AsyncIterable<Uint8Array>
}
