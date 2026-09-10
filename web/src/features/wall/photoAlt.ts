import type { WallItemDto } from '../../lib/api/dto'
import { fr } from '../../lib/i18n/fr'

/**
 * A guest photo's alternative text: its caption and who sent it.
 *
 * 1.0 used the stored filename, so a screen reader read out `IMG_4821.jpg`. The author
 * is always named even when the caption carries the meaning, because "who sent this"
 * is the part a listener cannot get from the picture.
 */
export const photoAlt = (item: WallItemDto): string => {
  const author =
    item.authorName === null || item.authorName === ''
      ? fr.wall.photoByAnonymous
      : fr.wall.photoBy(item.authorName)

  return item.caption === null || item.caption === '' ? author : `${item.caption} — ${author}`
}

/**
 * The absolute join link a phone camera can act on.
 *
 * Read once at import: a page's origin cannot change while it is open, and reading a
 * global during render is exactly what the React lint rules forbid.
 *
 * A path, never a query string. 1.0's QR page emitted `?partyname=` while the upload
 * page read `?party`, so every guest who scanned silently uploaded to the default
 * event; the code now travels as a path segment that the server resolves.
 */
const ORIGIN = window.location.origin

export const joinUrlFor = (joinCode: string): string =>
  `${ORIGIN}/join/${encodeURIComponent(joinCode)}`
