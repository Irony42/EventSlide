import type { PhotoId } from '../../domain/shared/ids'
import type { BookChunk } from '../ports/bookFileStore'
import type { BookRenderInput, BookRenderer, PageTexts } from '../ports/bookRenderer'

/** What the renderer was handed, for a test of what went into the book. */
export interface RenderedBook {
  readonly input: Omit<BookRenderInput, 'photo' | 'pageTexts'>
  /** The photographs it pulled, in order. */
  readonly photos: PhotoId[]
  /** The words it pulled, one entry per page of the plan that has some. */
  readonly texts: PageTexts[]
  /** Printer-version chunks it wrote for photographs, and those it skipped because the store dropped the version. */
  printMarkers: number
  printMarkersSkipped: number
}

/**
 * A `BookRenderer` that pulls what a real one would, in the same order (the cover, then each page of
 * the plan: its photographs and its words), records it, and answers `%PDF-` followed by one marker
 * byte per photograph, as three files when a printer version is asked. Not a PDF library:
 * `pdfBookRenderer.test.ts` holds the real adapter to the same pulling behaviour.
 */
export class FakeBookRenderer implements BookRenderer {
  readonly books: RenderedBook[] = []
  /** Rejects after this many photographs were pulled, as a failing render would. */
  failsAfter: number | null = null
  failure: unknown = new Error('render failed')
  /** Bytes the screen book is padded with, to make a large file without a large fixture. */
  paddingBytes = 0
  /** The same for the printer interior (the cover stays small). */
  printPaddingBytes = 0

  async *render(input: BookRenderInput): AsyncIterable<BookChunk> {
    const { photo, pageTexts, ...rest } = input
    const book: RenderedBook = {
      input: rest,
      photos: [],
      texts: [],
      printMarkers: 0,
      printMarkersSkipped: 0,
    }
    this.books.push(book)
    const encode = (text: string): Uint8Array => new TextEncoder().encode(text)
    const pull = async (id: PhotoId): Promise<void> => {
      if (this.failsAfter !== null && book.photos.length >= this.failsAfter) throw this.failure
      await photo(id)
      book.photos.push(id)
    }

    yield { kind: 'screen', bytes: encode('%PDF-1.7\n') }
    if (input.printPages !== null) {
      yield { kind: 'printInterior', bytes: encode('%PDF-1.7\n') }
      yield { kind: 'printCover', bytes: encode('%PDF-1.7\n') }
    }
    // The printer interior's own padding comes first, so a ceiling can be hit before the pages.
    if (input.printPages !== null && this.printPaddingBytes > 0) {
      yield { kind: 'printInterior', bytes: new Uint8Array(this.printPaddingBytes) }
    }
    if (input.cover.photoId !== null) await pull(input.cover.photoId)
    for (const page of input.plan.pages) {
      for (const slot of page.slots) {
        await pull(slot.photoId)
        yield { kind: 'screen', bytes: Uint8Array.of(book.photos.length % 256) }
        if (input.printPages !== null) {
          if (input.printStopped?.() === true) book.printMarkersSkipped += 1
          else {
            book.printMarkers += 1
            yield { kind: 'printInterior', bytes: Uint8Array.of(book.photos.length % 256) }
          }
        }
      }
      if (page.slots.length > 0 || page.messageIds !== undefined || page.template === 'thanks') {
        book.texts.push(await pageTexts(page))
      }
    }
    if (this.paddingBytes > 0) yield { kind: 'screen', bytes: new Uint8Array(this.paddingBytes) }
    if (input.printPages !== null) {
      yield { kind: 'printInterior', bytes: encode('\n%%EOF') }
      yield { kind: 'printCover', bytes: encode('\n%%EOF') }
    }
    yield { kind: 'screen', bytes: encode('\n%%EOF') }
  }
}
