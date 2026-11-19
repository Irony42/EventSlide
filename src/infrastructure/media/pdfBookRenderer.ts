import { once } from 'node:events'
import PDFDocument from 'pdfkit'
import type { BookChunk, BookFileKind } from '../../application/ports/bookFileStore'
import type {
  BookRenderInput,
  BookRenderer,
  PageTexts,
} from '../../application/ports/bookRenderer'
import type { PlanPage } from '../../domain/book/bookPlan'
import type { PhotoId } from '../../domain/shared/ids'
import { facesOf } from './book/bookFonts'
import {
  BLEED_PT,
  TRIM_PT,
  drawBackCover,
  drawFrontCover,
  drawPage,
  type DrawContext,
  type Mode,
} from './book/drawBook'
import { setPageBoxes, setPageLayout } from './book/pdfkitBoxes'
import type { Prepared } from './book/bookImages'

/**
 * `BookRenderer` on `pdfkit` (spec 26, section 6): the book as up to three streamed PDFs, drawn
 * from the plan and from nothing else, square pages of 21 cm.
 *
 * - **Screen**: the cover alone, an inside-cover blank (so that plan page 1 is a right-hand page of
 *   the `TwoPageRight` layout and the double pages are the plan's own), then the plan's pages;
 *   a `wide` photograph is drawn in two halves.
 * - **Printer interior**: the same pages on 216 mm with 3 mm of bleed (`TrimBox`, `BleedBox`),
 *   `wide` replaced and the padding blanks inserted by the plan (`planForPrint`).
 * - **Printer cover**: two pages of 216 mm, the back then the front. No spine: its thickness is the
 *   printer's.
 *
 * **Pull-based, one page in memory.** The generator draws a plan page (all its files), hands over the
 * bytes pdfkit produced so far, and only then asks for the next page's photographs. A consumer that
 * stops reading stops the drawing. A photograph is decoded and cropped once at printer resolution,
 * the screen copy being a reduction of it. Nothing global is set on `sharp`.
 *
 * Fonts: `book/bookFonts.ts` (a designed face when shipped, Noto otherwise). The text the use case
 * hands over has been through `pdfSafeText`; right-to-left scripts are not supported.
 */

export interface PdfBookRendererOptions {
  /** `false` leaves the content streams readable: for the test that extracts text, never in production. */
  readonly compress?: boolean
}

const EMPTY_TEXTS: PageTexts = {
  captions: [],
  authors: [],
  missions: [],
  messages: [],
  photographers: [],
}

interface Sink {
  readonly kind: BookFileKind
  readonly doc: PDFKit.PDFDocument
  readonly queue: Buffer[]
  readonly mode: Mode
  finished: boolean
}

const openSink = (
  kind: BookFileKind,
  mode: Mode,
  title: string,
  compress: boolean,
  layout: boolean,
): Sink => {
  const doc = new PDFDocument({
    size: [TRIM_PT, TRIM_PT],
    margin: 0,
    autoFirstPage: false,
    compress,
    info: { Title: title, Producer: 'EventSlide', Creator: 'EventSlide' },
  })
  const queue: Buffer[] = []
  doc.on('data', (chunk: Buffer) => queue.push(chunk))
  if (layout) setPageLayout(doc, 'TwoPageRight')
  return { kind, doc, queue, mode, finished: false }
}

const addPage = (sink: Sink): void => {
  const size = sink.mode === 'print' ? TRIM_PT + 2 * BLEED_PT : TRIM_PT
  sink.doc.addPage({ size: [size, size], margin: 0 })
  if (sink.mode === 'print') {
    setPageBoxes(
      sink.doc,
      [BLEED_PT, BLEED_PT, BLEED_PT + TRIM_PT, BLEED_PT + TRIM_PT],
      [0, 0, size, size],
    )
  }
}

export const createPdfBookRenderer = ({
  compress = true,
}: PdfBookRendererOptions = {}): BookRenderer => ({
  async *render(input: BookRenderInput): AsyncIterable<BookChunk> {
    const printPages = input.printPages
    const withPrint = printPages !== null
    const title = input.cover.title
    const screen = openSink('screen', 'screen', title, compress, true)
    const interior = withPrint ? openSink('printInterior', 'print', title, compress, false) : null
    const cover = withPrint ? openSink('printCover', 'print', title, compress, false) : null
    const sinks = [screen, interior, cover].filter((sink): sink is Sink => sink !== null)
    const faces = facesOf(input.style)

    const drain = function* (): Generator<BookChunk> {
      for (const sink of sinks) {
        while (sink.queue.length > 0) yield { kind: sink.kind, bytes: sink.queue.shift() as Buffer }
      }
    }

    const contextFor = (
      sink: Sink,
      bytes: ReadonlyMap<PhotoId, Uint8Array>,
      prepared: Map<string, Prepared>,
      texts: PageTexts,
    ): DrawContext => ({
      doc: sink.doc,
      mode: sink.mode,
      withPrint,
      input,
      faces,
      bytes,
      prepared,
      texts,
    })

    let finished = false
    try {
      // ---------------------------------------------------------------- covers --
      const coverBytes = new Map<PhotoId, Uint8Array>()
      if (input.cover.photoId !== null) {
        coverBytes.set(input.cover.photoId, await input.photo(input.cover.photoId))
      }
      const coverPrepared = new Map<string, Prepared>()
      addPage(screen)
      await drawFrontCover(contextFor(screen, coverBytes, coverPrepared, EMPTY_TEXTS))
      addPage(screen) // the inside of the cover
      await drawPage(contextFor(screen, new Map(), new Map(), EMPTY_TEXTS), blankPage, {
        firstMessages: false,
      })
      if (cover !== null) {
        addPage(cover)
        await drawBackCover(contextFor(cover, coverBytes, coverPrepared, EMPTY_TEXTS))
        addPage(cover)
        await drawFrontCover(contextFor(cover, coverBytes, coverPrepared, EMPTY_TEXTS))
      }
      yield* drain()

      // ----------------------------------------------------------------- pages --
      const wides = input.plan.pages.filter((page) => page.template === 'wide').length
      const padding =
        printPages === null ? 0 : printPages.length - (input.plan.pages.length + wides)
      let printAt = 0
      let firstMessages = true
      for (const page of input.plan.pages) {
        const texts =
          page.slots.length > 0 || page.messageIds !== undefined || page.template === 'thanks'
            ? await input.pageTexts(page)
            : EMPTY_TEXTS
        const bytes = new Map<PhotoId, Uint8Array>()
        for (const slot of page.slots) {
          if (!bytes.has(slot.photoId)) bytes.set(slot.photoId, await input.photo(slot.photoId))
        }
        const prepared = new Map<string, Prepared>()
        const isMessages = page.template === 'messages'

        if (page.template === 'wide') {
          for (const half of ['left', 'right'] as const) {
            addPage(screen)
            await drawPage(contextFor(screen, bytes, prepared, texts), page, {
              firstMessages: false,
              half,
            })
          }
        } else {
          addPage(screen)
          await drawPage(contextFor(screen, bytes, prepared, texts), page, { firstMessages })
        }

        if (interior !== null && printPages !== null) {
          // The printer pages that stand for this plan page: a `wide` is a chapter page and a
          // photograph, `thanks` comes after the padding blanks.
          const count = page.template === 'wide' ? 2 : page.template === 'thanks' ? padding + 1 : 1
          for (const printed of printPages.slice(printAt, printAt + count)) {
            addPage(interior)
            await drawPage(contextFor(interior, bytes, prepared, texts), printed, {
              firstMessages,
            })
          }
          printAt += count
        }
        if (isMessages) firstMessages = false

        // Between two pages, so the wall's SSE and the guests' uploads on this same process are
        // not starved by a long book.
        await new Promise<void>((resolve) => setImmediate(resolve))
        yield* drain()
      }

      finished = true
      const ended = sinks.map((sink) => once(sink.doc, 'end'))
      for (const sink of sinks) sink.doc.end()
      await Promise.all(ended)
      yield* drain()
    } finally {
      // A consumer that stopped early, or a failure, must not leave a document open.
      if (!finished) for (const sink of sinks) sink.doc.end()
    }
  },
})

const blankPage: PlanPage = { template: 'blank', slots: [] }
