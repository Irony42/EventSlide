import type { WallLayout } from '../../lib/api/dto'

/**
 * Where the invitation lives in each layout (the QR integration pass, after spec 14).
 *
 * Until this pass one card sat in a corner over every layout: it hid half a mosaic tile, cut two
 * frames of the filmstrip and pushed the split off centre. Each layout now gives it a place in its
 * own vocabulary instead, and only the spotlight keeps a corner:
 *
 * - `corner`: the spotlight's cartel, on the caption's baseline. The one slot the host's corner
 *   choice (spec 14) still moves, and the only one the layouts reserve room around.
 * - `tile`: a cell of the mosaic, a place left empty for a guest.
 * - `cell`: the collage's reserved block, "the next one is yours".
 * - `print`: one more print at the end of the polaroid pile, its window holding the QR.
 * - `tag`: a tag threaded on the clothesline, the one thing on the string that never sways.
 * - `band`: a ticket under the filmstrip, in the band the strip leaves empty.
 * - `seam`: a medallion in the split's middle column, so the two panes stay a symmetric pair.
 *
 * Whatever the slot, the QR itself is the same `JoinQr` at the same scale: the readability floor
 * of `joinCardScale.ts` is a promise about the code, and no slot may draw it smaller or crop it.
 */
export type JoinSlot = 'corner' | 'tile' | 'cell' | 'print' | 'tag' | 'band' | 'seam'

const SLOTS: Readonly<Record<WallLayout, JoinSlot>> = {
  spotlight: 'corner',
  mosaic: 'tile',
  collage: 'cell',
  polaroid: 'print',
  clothesline: 'tag',
  filmstrip: 'band',
  split: 'seam',
}

export const joinSlotOf = (layout: WallLayout): JoinSlot => SLOTS[layout]
