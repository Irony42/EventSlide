import type { WallItemDto } from '../../lib/api/dto'

const MOSAIC_CELL_RATIO = 1.25
const MOSAIC_MIN_VISIBLE = 0.7

/**
 * Whether a mosaic cell may crop this photograph.
 *
 * The cells are about 5:4 (`.mosaic`). `cover` keeps `min(r, c) / max(r, c)` of the photograph, so
 * "at least 70 % visible" means a photo between 0.875 and 1.78 wide-to-tall: a phone portrait
 * (0.75) or a panorama is shown whole instead. Derived from the photo's own dimensions, so two
 * projectors agree (trap 7).
 */
export const mosaicFit = (item: Pick<WallItemDto, 'width' | 'height'>): 'cover' | 'contain' => {
  const ratio = item.width / item.height
  const visible = Math.min(ratio, MOSAIC_CELL_RATIO) / Math.max(ratio, MOSAIC_CELL_RATIO)
  return visible >= MOSAIC_MIN_VISIBLE ? 'cover' : 'contain'
}
