/**
 * The readability floor of the invitation card (spec 14, rule 4), mirrored from
 * `src/domain/events/wallJoinCard.ts` — the web never imports the server's domain, so the two
 * functions live in both places and `joinCardScale.test.ts` pins the same numbers.
 *
 * A module of the QR measures `200 x scale / (N + 8)` px on a 1920 x 1080 wall and must keep 4.3 px:
 * a long link (a larger N) lifts the floor from 0.8 toward 1, and the host's smaller choice yields.
 */
const SCALE_MIN = 0.8
const BYTE_CAPACITY_M = [14, 26, 42, 62, 84, 106] as const

/** Data modules per side of a level-M QR holding `byteLength` bytes (45 stands for "past v6"). */
export const qrModuleCount = (byteLength: number): number => {
  const index = BYTE_CAPACITY_M.findIndex((capacity) => byteLength <= capacity)
  return index === -1 ? 45 : 17 + 4 * (index + 1)
}

export const smallScaleFloor = (moduleCount: number): number =>
  Math.min(1, Math.max(SCALE_MIN, (4.3 * (moduleCount + 8)) / 200))

/** The scale actually drawn for this link: the host's choice, never under the floor. */
export const joinCardScale = (scale: number, url: string): number =>
  Math.max(scale, smallScaleFloor(qrModuleCount(new TextEncoder().encode(url).length)))
