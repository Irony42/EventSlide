import type { EventStatus } from '../../../lib/api/dto'

/**
 * The rules of the printed kit (spec 02): which sheets exist, how big the QR is on each,
 * when the code is too small to trust, and which events may print at all.
 *
 * Pure and DOM-free so a test can state each rule without React. Formats and sizes are
 * physical presentation, not business rules; only {@link availabilityOf} is a transcription
 * of the domain (as `eventLifecycle.ts` is) and `printKit.contract.test.ts` ties it to it.
 */

export type PrintFormat = 'a4' | 'a5' | 'card'

export const PRINT_FORMATS: readonly PrintFormat[] = ['card', 'a5', 'a4']
export const DEFAULT_PRINT_FORMAT: PrintFormat = 'card'

export interface PrintFormatSpec {
  /** Copies on one A4 sheet. */
  readonly perSheet: 1 | 2 | 4
  /** Side of the QR in millimetres, **quiet zone included**. */
  readonly qrMm: number
}

/**
 * The sides are the values of `--print-qr-*` in `tokens.css` (the stylesheet draws them, this
 * module judges them); `printKit.contract.test.ts` fails if the two copies diverge.
 */
export const PRINT_FORMAT_SPECS: Readonly<Record<PrintFormat, PrintFormatSpec>> = {
  a4: { perSheet: 1, qrMm: 120 },
  a5: { perSheet: 2, qrMm: 70 },
  card: { perSheet: 4, qrMm: 40 },
}

/** Modules of white paper round the code, drawn by the SVG's own margin and never by a fill. */
export const QUIET_ZONE_MODULES = 4

/** Smallest printed module a phone camera reads reliably, in millimetres. */
export const MIN_MODULE_MM = 0.6

/**
 * Size of one printed module, from the side of the QR and the module count **of the rendered
 * SVG** (its `viewBox` width, which already holds the quiet zone: N + 2 x 4).
 */
export const moduleMm = (qrMm: number, totalModules: number): number => qrMm / totalModules

/** The link is long enough that the code would print below the readable module size. */
export const isQrTooSmall = (format: PrintFormat, totalModules: number): boolean =>
  moduleMm(PRINT_FORMAT_SPECS[format].qrMm, totalModules) < MIN_MODULE_MM

/**
 * Reads the module count (quiet zone included) out of a rendered QR `<svg>`.
 *
 * `qrcode.react` exposes neither version nor size, only the `viewBox`; the shape is checked
 * and `null` is answered for anything else, so a library that changes it fails a test
 * instead of printing a wrong warning.
 */
export const totalModulesOf = (svg: Element | null): number | null => {
  const box = svg?.getAttribute('viewBox')?.trim().split(/\s+/)
  if (box === undefined || box.length !== 4) return null
  const [x, y, width, height] = box.map(Number)
  if (x !== 0 || y !== 0 || width === undefined || width !== height || !Number.isInteger(width)) {
    return null
  }
  return width
}

export type PrintAvailability = 'ready' | 'draft' | 'closed' | 'unavailable'

/**
 * What the print page shows for an event of this status.
 *
 * `archived` prints nothing: its code resolves nowhere and it never comes back
 * (`ALLOWED_TRANSITIONS.archived` is empty). `draft` and `closed` print with a notice:
 * a draft opens later with the same code, a closed evening may be reopened with it, and
 * until then a guest who scans is refused (`acceptsGuests` is true for `live` only).
 */
export const availabilityOf = (status: EventStatus): PrintAvailability => {
  switch (status) {
    case 'live':
      return 'ready'
    case 'draft':
      return 'draft'
    case 'closed':
      return 'closed'
    case 'archived':
      return 'unavailable'
  }
}
