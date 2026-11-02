import { once } from 'node:events'
import { join } from 'node:path'
import PDFDocument from 'pdfkit'
import sharp from 'sharp'
import type { BookInput, BookPhoto, BookRenderer } from '../../application/ports/bookRenderer'
import { PHOTOS_PER_PAGE, containInBox, pageOrientationFor } from '../../domain/book/bookLayout'
import { Dimensions } from '../../domain/photos/dimensions'

/**
 * `BookRenderer` on `pdfkit`: a streamed A4 PDF, one page at a time.
 *
 * **Pull-based, one page in memory.** The generator draws a page, hands over the bytes pdfkit has
 * produced so far, and only then asks `input.photos` for the next photograph. A consumer that stops
 * reading stops the drawing; nothing is drawn ahead. No headless browser, no HTML, no remote image:
 * the only decoder this opens is `sharp`, on JPEGs that the ingest pipeline re-encoded itself.
 *
 * Each photograph is **reduced** from the stored `display` rendition (2560 px) to what an A4 page
 * can show at about 150 dpi, one at a time (`sharp` is awaited per photograph). Nothing global is
 * set on `sharp` (`concurrency`, `cache`): those are process-wide and would slow the guests'
 * uploads that share the process.
 *
 * The fonts are Noto Sans and Noto Serif (SIL OFL 1.1, `fonts/OFL-Noto.txt`), embedded as subsets by
 * pdfkit. Latin, Greek and Cyrillic are covered; the text the use case hands over has already been
 * limited to that by `pdfSafeText`. Right-to-left scripts are not supported.
 */

const FONT_DIRECTORY = join(__dirname, 'fonts')
const FONTS = {
  serifBold: join(FONT_DIRECTORY, 'NotoSerif-Bold.ttf'),
  serif: join(FONT_DIRECTORY, 'NotoSerif-Regular.ttf'),
  sans: join(FONT_DIRECTORY, 'NotoSans-Regular.ttf'),
  sansBold: join(FONT_DIRECTORY, 'NotoSans-Bold.ttf'),
} as const

/** A4 in points, and the margin around every page. */
const A4 = { width: 595.28, height: 841.89 } as const
const MARGIN = 36
/** The most pixels a photograph keeps on its long edge, by layout (about 150 dpi at its size). */
const MAX_EDGE = { one: 1600, four: 1100 } as const
const JPEG_QUALITY = 82
const INK = '#111111'
const GREY = '#666666'

export interface PdfBookRendererOptions {
  /** `false` leaves the content streams readable: for the test that extracts text, never in production. */
  readonly compress?: boolean
}

interface Prepared {
  readonly jpeg: Buffer
  readonly dimensions: Dimensions
  readonly caption: string | null
  readonly author: string | null
}

const dimensionsOf = (width: number, height: number): Dimensions => {
  const created = Dimensions.create(width, height)
  if (!created.ok) throw new Error('book renderer: unusable photograph dimensions')
  return created.value
}

const prepare = async (photo: BookPhoto, layout: BookInput['layout']): Promise<Prepared> => {
  const edge = MAX_EDGE[layout]
  const { data, info } = await sharp(photo.bytes, { failOn: 'error' })
    .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer({ resolveWithObject: true })
  return {
    jpeg: data,
    dimensions: dimensionsOf(info.width, info.height),
    caption: photo.caption,
    author: photo.author,
  }
}

const centred = (doc: PDFKit.PDFDocument, text: string, y: number, width: number): number => {
  doc.text(text, MARGIN, y, { width, align: 'center' })
  return doc.y
}

const drawCover = (doc: PDFKit.PDFDocument, input: BookInput): void => {
  doc.addPage({ size: 'A4', margin: 0 })
  const width = A4.width - 2 * MARGIN
  doc.fillColor(INK).font('serifBold').fontSize(34)
  const titleHeight = doc.heightOfString(input.cover.title, { width, align: 'center' })
  const top = A4.height * 0.36 - titleHeight / 2
  const below = centred(doc, input.cover.title, top, width)
  if (input.cover.subtitle !== '') {
    doc.fillColor(GREY).font('serif').fontSize(16)
    centred(doc, input.cover.subtitle, below + 18, width)
  }
}

const drawClosing = (doc: PDFKit.PDFDocument, input: BookInput): void => {
  doc.addPage({ size: 'A4', margin: 0 })
  const width = A4.width - 2 * MARGIN
  if (input.closing.videosNote !== null) {
    doc.fillColor(INK).font('sans').fontSize(11)
    centred(doc, input.closing.videosNote, A4.height * 0.4, width)
  }
  doc.fillColor(GREY).font('sans').fontSize(9)
  centred(doc, input.closing.createdWith, A4.height - MARGIN - 14, width)
}

const captionBlock = (
  doc: PDFKit.PDFDocument,
  item: Prepared,
  x: number,
  y: number,
  width: number,
  size: number,
): void => {
  let cursor = y
  if (item.caption !== null) {
    doc.fillColor(INK).font('sans').fontSize(size)
    doc.text(item.caption, x, cursor, { width, align: 'center' })
    cursor = doc.y + 2
  }
  if (item.author !== null) {
    doc.fillColor(GREY).font('sansBold').fontSize(size - 2)
    doc.text(item.author, x, cursor, { width, align: 'center' })
  }
}

/** Room kept under a photograph for its caption (two lines at most) and its credit. */
const textHeight = (item: Prepared, size: number): number =>
  (item.caption === null ? 0 : size * 2.6) + (item.author === null ? 0 : size + 4)

const drawPhotoPage = (
  doc: PDFKit.PDFDocument,
  layout: BookInput['layout'],
  batch: readonly Prepared[],
): void => {
  if (layout === 'one') {
    const [item] = batch as readonly [Prepared]
    const orientation = pageOrientationFor('one', item.dimensions)
    doc.addPage({ size: 'A4', layout: orientation, margin: 0 })
    const page = orientation === 'landscape' ? { width: A4.height, height: A4.width } : A4
    const reserved = textHeight(item, 12)
    const cell = {
      width: page.width - 2 * MARGIN,
      height: page.height - 2 * MARGIN - (reserved === 0 ? 0 : reserved + 10),
    }
    const placed = containInBox(item.dimensions, cell)
    doc.image(item.jpeg, MARGIN + placed.x, MARGIN + placed.y, {
      width: placed.width,
      height: placed.height,
    })
    captionBlock(doc, item, MARGIN, MARGIN + cell.height + 10, page.width - 2 * MARGIN, 12)
    return
  }

  doc.addPage({ size: 'A4', margin: 0 })
  const gap = 18
  const cellWidth = (A4.width - 2 * MARGIN - gap) / 2
  const cellHeight = (A4.height - 2 * MARGIN - gap) / 2
  batch.forEach((item, index) => {
    const x = MARGIN + (index % 2) * (cellWidth + gap)
    const y = MARGIN + Math.floor(index / 2) * (cellHeight + gap)
    const reserved = textHeight(item, 9)
    const box = { width: cellWidth, height: cellHeight - (reserved === 0 ? 0 : reserved + 6) }
    const placed = containInBox(item.dimensions, box)
    doc.image(item.jpeg, x + placed.x, y + placed.y, { width: placed.width, height: placed.height })
    captionBlock(doc, item, x, y + box.height + 6, cellWidth, 9)
  })
}

export const createPdfBookRenderer = ({
  compress = true,
}: PdfBookRendererOptions = {}): BookRenderer => ({
  async *render(input: BookInput): AsyncIterable<Uint8Array> {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 0,
      autoFirstPage: false,
      compress,
      info: { Title: input.cover.title, Producer: 'EventSlide', Creator: 'EventSlide' },
    })
    const queue: Buffer[] = []
    doc.on('data', (chunk: Buffer) => queue.push(chunk))
    const drain = function* (): Generator<Uint8Array> {
      while (queue.length > 0) yield queue.shift() as Buffer
    }
    let finished = false
    // Registered once, so the font files are read once and embedded as subsets.
    doc.registerFont('serifBold', FONTS.serifBold)
    doc.registerFont('serif', FONTS.serif)
    doc.registerFont('sans', FONTS.sans)
    doc.registerFont('sansBold', FONTS.sansBold)

    try {
      drawCover(doc, input)
      yield* drain()

      const perPage = PHOTOS_PER_PAGE[input.layout]
      let batch: Prepared[] = []
      for await (const photo of input.photos) {
        batch.push(await prepare(photo, input.layout))
        if (batch.length === perPage) {
          drawPhotoPage(doc, input.layout, batch)
          batch = []
          // Yield to the event loop between pages, so the wall's SSE and the guests' uploads
          // on this same process are not starved by a long book.
          await new Promise<void>((resolve) => setImmediate(resolve))
          yield* drain()
        }
      }
      if (batch.length > 0) drawPhotoPage(doc, input.layout, batch)
      yield* drain()

      drawClosing(doc, input)
      finished = true
      const ended = once(doc, 'end')
      doc.end()
      await ended
      yield* drain()
    } finally {
      // A consumer that stopped early, or a failure, must not leave a document open.
      if (!finished) doc.end()
    }
  },
})
