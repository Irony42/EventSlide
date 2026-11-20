
/**
 * The few things a PDF needs that `pdfkit` has no public option for: the `TrimBox` and `BleedBox` of a
 * page (the printer reads them to know where the book is cut) and the `PageLayout` of the document
 * (two pages side by side, the cover alone). They live in the page's dictionary and in the root of
 * the document, which `pdfkit` exposes only as internals, so this is the one place that touches them
 * and `pdfkitBoxes.test.ts` reads the PDF it produced to prove they landed.
 */

interface Internals {
  readonly page: { readonly dictionary: { readonly data: Record<string, unknown> } }
  readonly _root: { readonly data: Record<string, unknown> }
}

export type Box = readonly [number, number, number, number]

/** On the page being drawn: the cut and the bleed rectangles, in points from the bottom left. */
export const setPageBoxes = (doc: PDFKit.PDFDocument, trim: Box, bleed: Box): void => {
  const { data } = (doc as unknown as Internals).page.dictionary
  data['TrimBox'] = [...trim]
  data['BleedBox'] = [...bleed]
}

export type PageLayout = 'SinglePage' | 'TwoPageRight' | 'TwoPageLeft'

export const setPageLayout = (doc: PDFKit.PDFDocument, layout: PageLayout): void => {
  ;(doc as unknown as Internals)._root.data['PageLayout'] = layout
}
