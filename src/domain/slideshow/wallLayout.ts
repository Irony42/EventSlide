/**
 * How the wall arranges the photos it is showing.
 *
 * A layout is a host setting, so each option is a closed value with a descriptor the
 * display reads. The room-facing consequences — how many photos are up at once,
 * whether a guest's photo may be cropped, whether text is legible at five metres — are
 * decided here, not rediscovered in a stylesheet.
 */

export const WALL_LAYOUTS = ['spotlight', 'mosaic', 'polaroid', 'filmstrip'] as const

export type WallLayout = (typeof WALL_LAYOUTS)[number]

export interface WallLayoutSpec {
  /** Photos visible at once. */
  readonly slotCount: number
  /** Whether the layout may crop a guest's photo to fill its slot. */
  readonly crops: boolean
  readonly showsCaption: boolean
  readonly showsAuthor: boolean
}

/**
 * `crops: false` on `spotlight` is a product promise rather than a style choice: the
 * primary layout shows the photo the guest actually took, letterboxed on black, so
 * nobody's head is cut off in front of two hundred people. The multi-slot layouts have
 * to fill a grid cell, and a host picking one is picking that trade.
 *
 * Caption and author travel together. Where a caption is too small to read across the
 * room so is a credit, and a name floating without the words it belongs to is worse
 * than no name at all.
 */
const SPECS: Readonly<Record<WallLayout, WallLayoutSpec>> = {
  spotlight: { slotCount: 1, crops: false, showsCaption: true, showsAuthor: true },
  mosaic: { slotCount: 6, crops: true, showsCaption: false, showsAuthor: false },
  polaroid: { slotCount: 3, crops: true, showsCaption: true, showsAuthor: true },
  filmstrip: { slotCount: 5, crops: true, showsCaption: false, showsAuthor: false },
}

export const isWallLayout = (value: unknown): value is WallLayout =>
  typeof value === 'string' && (WALL_LAYOUTS as readonly string[]).includes(value)

export const wallLayoutSpec = (layout: WallLayout): WallLayoutSpec => SPECS[layout]
