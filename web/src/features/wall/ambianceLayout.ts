import type { ThemeAmbiance, WallLayout } from '../../lib/api/dto'

/**
 * The layout an ambiance hangs its wall in when nobody has asked for another — ADR 0010.
 *
 * A suggestion made at the screen and not a setting of the event: the layout already
 * belongs to the projector (`?layout=`, the `L` key), the wall response names no layout of
 * the event's own, and `GET /wall` takes none. So the ambiance proposes and the room
 * disposes — the order `WallPage` resolves is the key, then the URL, then this, then the
 * wall response's default. A kiosk that names its layout keeps it, in every ambiance.
 *
 * `null` is "no opinion": the ambiance takes whatever the wall response carries. Keyed by the
 * closed vocabulary, so adding an ambiance fails the build here until it answers.
 */
export const AMBIANCE_LAYOUT: Readonly<Record<ThemeAmbiance, WallLayout | null>> = {
  // The default look since 28/10, so it suggests nothing: an unthemed wall keeps the response's
  // default (spotlight), and the clothesline stays one `L` press or `?layout=clothesline` away.
  guinguette: null,
  riviera: null,
  champs: null,
  bivouac: null,
  cabaret: null,
  noces: null,
}
