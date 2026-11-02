import type { BookInput, BookPhoto, BookRenderer } from '../ports/bookRenderer'

/** What the renderer was handed, for a test of what went into the book. */
export interface RenderedBook {
  readonly input: Omit<BookInput, 'photos'>
  readonly photos: readonly BookPhoto[]
}

/**
 * A `BookRenderer` that pulls the photographs one at a time, as the real one does, records
 * them, and answers `%PDF-` followed by one marker byte per photograph. Not a PDF library:
 * `pdfBookRenderer.test.ts` holds the real adapter to the same pulling behaviour.
 */
export class FakeBookRenderer implements BookRenderer {
  readonly books: RenderedBook[] = []
  /** Rejects after this many photographs were pulled, as a failing render would. */
  failsAfter: number | null = null
  failure: unknown = new Error('render failed')
  /** Bytes the book is padded with, to make a large file without a large fixture. */
  paddingBytes = 0

  async *render(input: BookInput): AsyncIterable<Uint8Array> {
    const { photos, ...rest } = input
    const pulled: BookPhoto[] = []
    this.books.push({ input: rest, photos: pulled })
    yield new TextEncoder().encode('%PDF-1.7\n')
    for await (const photo of photos) {
      if (this.failsAfter !== null && pulled.length >= this.failsAfter) throw this.failure
      pulled.push(photo)
      yield Uint8Array.of(pulled.length % 256)
    }
    if (this.paddingBytes > 0) yield new Uint8Array(this.paddingBytes)
    yield new TextEncoder().encode('\n%%EOF')
  }
}
