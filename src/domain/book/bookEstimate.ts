import { PRINT_TRIM_MM } from './bookPrint'
import { BOOK_TEMPLATES, type TemplateId } from './bookTemplates'

/** Resolution of the screen book and of the printer version, at the size of the slot (spec 26, 4.8). */
export const BOOK_SCREEN_DPI = 150
export const BOOK_PRINT_DPI = 300

/**
 * Bytes a JPEG takes a pixel at the qualities the book uses (82 on screen, 90 for the printer).
 * Measured at the spike on noisy synthetic photographs, so an upper bound: 0.29 to 0.35, real
 * photographs sit lower. It replaces `BOOK_REDUCTION_RATIO`: a book that cannot fit is refused
 * before the most expensive minute of CPU of the event, not abandoned at 90 %.
 */
export const BOOK_BYTES_PER_PIXEL = 0.3

const MM_PER_INCH = 25.4

const pixels = (widthPct: number, heightPct: number, span: 1 | 2, dpi: number): number => {
  const widthPx = ((widthPct / 100) * span * PRINT_TRIM_MM * dpi) / MM_PER_INCH
  const heightPx = ((heightPct / 100) * PRINT_TRIM_MM * dpi) / MM_PER_INCH
  return widthPx * heightPx
}

/** The pixels a plan's pages draw at `dpi`: each filled slot, at its own size, plus the cover. */
export const estimatePlanPixels = (
  pages: readonly { readonly template: TemplateId; readonly slots: readonly unknown[] }[],
  dpi: number,
): number => {
  let total = pixels(100, 100, 1, dpi)
  for (const page of pages) {
    const { slots, span } = BOOK_TEMPLATES[page.template]
    for (const slot of slots.slice(0, page.slots.length)) {
      total += pixels(slot.w, slot.h, span, dpi)
    }
  }
  return total
}

/** The bytes of the screen book, or (at `BOOK_PRINT_DPI`) of the printer's interior, before it is drawn. */
export const estimatePlanBytes = (
  pages: readonly { readonly template: TemplateId; readonly slots: readonly unknown[] }[],
  dpi: number,
): number => Math.ceil(estimatePlanPixels(pages, dpi) * BOOK_BYTES_PER_PIXEL)
