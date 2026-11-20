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
  /** Width of one portrait card in millimetres: A6, A5 or A4, all at the ratio 1 : √2. */
  readonly cardMm: number
  /** Two A5 portraits stand side by side on an A4 turned landscape. */
  readonly landscape: boolean
}

/**
 * Every card is portrait since spec 28. The widths are `--print-card-w` and its multiples in
 * `tokens.css`; `printKit.contract.test.ts` fails if the two copies diverge.
 */
export const PRINT_FORMAT_SPECS: Readonly<Record<PrintFormat, PrintFormatSpec>> = {
  a4: { perSheet: 1, cardMm: 210, landscape: false },
  a5: { perSheet: 2, cardMm: 148.5, landscape: true },
  card: { perSheet: 4, cardMm: 105, landscape: false },
}

/**
 * Side of the printed QR in millimetres, quiet zone included: the design's share of the card's
 * width (`printDesigns.qrShareOf`, the very number its stylesheet draws with) times that width.
 */
export const qrMmOf = (format: PrintFormat, qrShare: number): number =>
  PRINT_FORMAT_SPECS[format].cardMm * qrShare

export type PrintInk = 'black' | 'event'

export const PRINT_INKS: readonly PrintInk[] = ['black', 'event']
export const DEFAULT_PRINT_INK: PrintInk = 'black'

/**
 * The QR ink of "the event's colour": the event's hue at a lightness and chroma fixed here, so the
 * ink is dark by construction and a hue can never make it pale. A second copy of
 * `--print-ink-accent` in `tokens.css`, which is what paper actually gets:
 * `printKit.contract.test.ts` fails when the two differ.
 */
export const INK_LIGHTNESS = 0.3
export const INK_CHROMA = 0.1

/** The least ink/paper contrast (WCAG ratio), against white paper, a pale printer's margin included. */
export const MIN_INK_CONTRAST = 7

/** Modules of white paper round the code, drawn by the SVG's own margin and never by a fill. */
export const QUIET_ZONE_MODULES = 4

/**
 * Error correction of the printed QR: M as on the wall, H as soon as a logo covers the centre
 * (H restores up to 30 % of the modules, which is what the logo and its cleared zone take).
 */
export type QrLevel = 'M' | 'H'
export const qrLevelOf = (hasLogo: boolean): QrLevel => (hasLogo ? 'H' : 'M')

/** The logo's side at most, as a share of the QR's side (4 % of its area). */
export const LOGO_MAX_SHARE = 0.2

/** Smallest printed module a phone camera reads reliably, in millimetres. */
export const MIN_MODULE_MM = 0.6

/**
 * Size of one printed module, from the side of the QR and the module count **of the rendered
 * SVG** (its `viewBox` width, which already holds the quiet zone: N + 2 x 4).
 */
export const moduleMm = (qrMm: number, totalModules: number): number => qrMm / totalModules

/** The link is long enough that the code would print below the readable module size. */
export const isQrTooSmall = (format: PrintFormat, qrShare: number, totalModules: number): boolean =>
  moduleMm(qrMmOf(format, qrShare), totalModules) < MIN_MODULE_MM

/**
 * The hue (oklch degrees, 0-359) of a colour written `#rrggbb`: what the event's own hue is to
 * the rest of the kit. The QR ink and the darker and paler shades of a design are drawn from it at
 * fixed lightness and chroma, so a pale colour picked by the host never makes them pale.
 * `null` for anything that is not six hex digits.
 */
export const hueOfHex = (hex: string): number | null => {
  const found = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (found === null) return null
  const [r, g, b] = [found[1], found[2], found[3]].map((part) => {
    const c = parseInt(part ?? '0', 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  const degrees = (Math.atan2(bb, a) * 180) / Math.PI
  return Math.round((degrees + 360) % 360) % 360
}

/** Six hex digits, the only colour the kit accepts from the host's picker or from storage. */
export const isHexColour = (value: unknown): value is string =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)

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
