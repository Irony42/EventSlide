/**
 * The few measures of the book that are arithmetic rather than layout, in the PDF's own unit: points
 * on a square page of 210 mm. They mirror `drawBook.ts` (the polaroid frame and the tilt) and
 * `bookStyles.ts` (the hash of the tilt); `bookGeometry.test.ts` and the server's `bookStyles` /
 * `polaroidFrame` tests pin the same vectors, so a change on one side fails on the other.
 */

/** A page of the book, in points (210 mm). */
export const TRIM_PT = (210 * 72) / 25.4

export interface Box {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/** The tilt of a polaroid, -4 to +4 degrees, from a hash of the photograph's id (FNV-1a). */
export const polaroidRotation = (photoId: string): number => {
  let hash = 0x811c9dc5
  for (let i = 0; i < photoId.length; i += 1) {
    hash ^= photoId.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return (hash % 801) / 100 - 4
}

/** The part of `outer` a photograph of this aspect (width over height) fills when contained whole. */
export const containBox = (outer: Box, aspect: number): Box => {
  const scale = Math.min(outer.w, outer.h * aspect)
  const w = scale
  const h = scale / aspect
  return { x: outer.x + (outer.w - w) / 2, y: outer.y + (outer.h - h) / 2, w, h }
}

export interface PolaroidFrame {
  /** The white frame, in percent of the page. */
  readonly frame: Box
  /** The photograph inside it, in percent of the page. */
  readonly photo: Box
  /** The caption band under the photograph, in points. */
  readonly bandPt: number
  /** The border of the frame, in percent of the page. */
  readonly padPct: number
}

const pct = (box: Box): Box => ({
  x: (box.x / TRIM_PT) * 100,
  y: (box.y / TRIM_PT) * 100,
  w: (box.w / TRIM_PT) * 100,
  h: (box.h / TRIM_PT) * 100,
})

/**
 * The frame that hugs a photograph of this aspect inside a slot (percent of the page): the border is
 * the same on three sides, the band is under the photograph, and the whole is centred in the slot.
 */
export const polaroidFrame = (slot: Box, aspect: number): PolaroidFrame => {
  const s: Box = {
    x: (slot.x / 100) * TRIM_PT,
    y: (slot.y / 100) * TRIM_PT,
    w: (slot.w / 100) * TRIM_PT,
    h: (slot.h / 100) * TRIM_PT,
  }
  const pad = 0.04 * Math.min(s.w, s.h)
  const band = Math.max(22, 0.14 * s.h)
  const avail: Box = { x: s.x, y: s.y, w: s.w - 2 * pad, h: s.h - pad - band }
  const size = containBox(avail, aspect)
  const w = size.w + 2 * pad
  const h = size.h + pad + band
  const frame: Box = { x: s.x + (s.w - w) / 2, y: s.y + (s.h - h) / 2, w, h }
  const photo: Box = { x: frame.x + pad, y: frame.y + pad, w: size.w, h: size.h }
  return { frame: pct(frame), photo: pct(photo), bandPt: band, padPct: (pad / TRIM_PT) * 100 }
}

/**
 * A font size, in points, that lets `text` fit a box: the PDF shrinks a title until it fits, and a
 * browser has no such thing, so the same loop runs here on an estimate of the width of a glyph.
 */
export const fitSize = (
  text: string,
  box: { readonly w: number; readonly h: number },
  size: number,
  minSize: number,
): number => {
  const widthPt = (box.w / 100) * TRIM_PT
  const heightPt = (box.h / 100) * TRIM_PT
  let current = size
  const height = (s: number): number => {
    const perLine = Math.max(1, Math.floor(widthPt / (s * 0.5)))
    return Math.max(1, Math.ceil(text.length / perLine)) * s * 1.2
  }
  while (height(current) > heightPt && current > minSize) current -= 0.5
  return current
}

/** A length in points as a percent of the page. */
export const ptPct = (points: number): number => (points / TRIM_PT) * 100

/** The height, in percent of the page, a text takes at this size in a box of this width (an estimate). */
export const usedPct = (text: string, widthPct: number, size: number): number => {
  const perLine = Math.max(1, Math.floor(((widthPct / 100) * TRIM_PT) / (size * 0.5)))
  return ptPct(Math.max(1, Math.ceil(text.length / perLine)) * size * 1.2)
}
