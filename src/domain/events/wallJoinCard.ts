/**
 * The wall's invitation card: whether it shows, how big it is, in which corner (spec 14).
 *
 * **The size is a scale, not three sizes** (Pierre, decision 14-6): a number between a readable
 * floor and a ceiling, in steps of 0.05, so a host can tune the card to the room. Small, medium
 * and large survive only as marks on the slider ({@link WALL_QR_SCALE_MARKS}). 1 is the card as
 * it has always been, so a wall nobody touched is unchanged.
 *
 * Pure: the readability floor of a given link (it depends on the QR's module count, known only
 * where the link is drawn) is the rule {@link effectiveQrScale}, applied at render.
 */
export const WALL_QR_SCALE_MIN = 0.8
export const WALL_QR_SCALE_MAX = 1.5
export const WALL_QR_SCALE_STEP = 0.05
export const DEFAULT_WALL_QR_SCALE = 1

/** The three sizes the first version of the spec proposed, now the marks under the slider. */
export const WALL_QR_SCALE_MARKS = { small: 0.8, medium: 1, large: 1.3 } as const

/** Positions are logical (start/end), so they follow a reversed reading direction. */
export const WALL_QR_PLACEMENTS = ['bottom-end', 'bottom-start', 'top-end', 'top-start'] as const
export type WallQrPlacement = (typeof WALL_QR_PLACEMENTS)[number]
export const DEFAULT_WALL_QR_PLACEMENT: WallQrPlacement = 'bottom-end'

export const isWallQrPlacement = (value: unknown): value is WallQrPlacement =>
  typeof value === 'string' && (WALL_QR_PLACEMENTS as readonly string[]).includes(value)

/** A finite number inside the range and on the 0.05 grid (so a stored 1.2999999 is refused). */
export const isWallQrScale = (value: unknown): value is number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false
  if (value < WALL_QR_SCALE_MIN || value > WALL_QR_SCALE_MAX) return false
  const steps = value / WALL_QR_SCALE_STEP
  return Math.abs(steps - Math.round(steps)) < 1e-9
}

/**
 * Smallest scale at which a module still measures 4.3 px on a 1920 x 1080 wall: a module is
 * `200 x scale / (N + 8)` px (200 px is the plate's inside, N the data modules, 8 the quiet
 * zone). A long link has a larger N and pushes the floor up, to at most 1 (the card as it is).
 */
export const smallScaleFloor = (moduleCount: number): number =>
  Math.min(1, Math.max(WALL_QR_SCALE_MIN, (4.3 * (moduleCount + 8)) / 200))

/** The scale actually drawn: the host's choice, never below the floor of this link. */
export const effectiveQrScale = (scale: number, moduleCount: number): number =>
  Math.max(scale, smallScaleFloor(moduleCount))
