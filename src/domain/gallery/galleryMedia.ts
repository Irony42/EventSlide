import type { MediaKind } from '../photos/mediaKind'
import type { ServedVariant } from '../photos/mediaVariant'
import { isVisibleOnWall, type PhotoStatus } from '../photos/photoStatus'
import type { ShareLink } from './shareLink'

/**
 * What a shared gallery shows, and how its bytes are handed out.
 *
 * ## Which photographs
 *
 * **Exactly what the wall shows: `published`, and nothing else.** Not `hidden`, although
 * the host's own album export keeps hidden photographs — "take it off the wall" is the
 * host saying this one is not for the room, and a link forwarded to every guest and
 * beyond is a bigger room, not a smaller one. Never `pending` or `rejected`. A photograph
 * the host unpublishes after sending the link disappears from the gallery on the next
 * request, because the status is read on every request rather than snapshotted into the
 * link.
 *
 * ## Which renditions
 *
 * A table per kind rather than a branch, for the same reason `mediaVariant.ts` gives: a
 * conditional on `kind` would cost a photo test and a clip test at every call site.
 *
 * - `preview` fills the grid: the smallest file that still reads on a phone.
 * - `view` is the larger one the viewer opens.
 * - `download` is the full-resolution file, served as an attachment. For a photograph
 *   that is the stored `original` — which is already the pipeline's re-encode, with EXIF,
 *   GPS and the device serial stripped on ingest (`sharpImageProcessor.ts`), so the file a
 *   stranger downloads from a public link carries no coordinates of anybody's home. A
 *   clip has no original by design (`mediaVariant.ts`); its download is the transcode,
 *   which kept only the picture and the sound.
 */

export type GalleryRendition = 'preview' | 'view' | 'download'

export const GALLERY_RENDITIONS: Readonly<
  Record<MediaKind, Readonly<Record<GalleryRendition, ServedVariant>>>
> = {
  photo: { preview: 'thumb', view: 'display', download: 'original' },
  clip: { preview: 'poster', view: 'poster', download: 'video' },
}

/** The file extension a download is named with. The stored bytes decide it, per kind. */
export const DOWNLOAD_EXTENSION: Readonly<Record<MediaKind, string>> = {
  photo: 'jpg',
  clip: 'mp4',
}

/** Whether a gallery may serve this rendition of a row of this kind at all. */
export const isGalleryVariant = (kind: MediaKind, variant: ServedVariant): boolean =>
  Object.values(GALLERY_RENDITIONS[kind]).includes(variant)

/** Whether this rendition goes out as `Content-Disposition: attachment`. */
export const isGalleryDownload = (kind: MediaKind, variant: ServedVariant): boolean =>
  GALLERY_RENDITIONS[kind].download === variant

/** The one status a shared gallery shows. See the file comment. */
export const isInSharedGallery = (status: PhotoStatus): boolean => isVisibleOnWall(status)

/**
 * How long a signed media URL stays valid.
 *
 * An hour: long enough to scroll an album and download what you wanted from it, short
 * enough that a URL lifted out of an `<img>` and pasted into a chat has stopped working by
 * the time anybody opens it. It is not what makes revocation work — every request re-reads
 * the link, so a revoked link's URLs die at once — it is what stops a signed URL becoming
 * a second, unrevocable way into a gallery whose password somebody did not have.
 */
export const GALLERY_GRANT_TTL_MS = 60 * 60 * 1000

/**
 * How long entering the password lasts, before the viewer is asked again.
 *
 * Two hours covers a long look through a wedding and ends before the phone is lent to
 * somebody else. Short because it is a bearer credential in a cookie, and a password
 * typed once on a shared family laptop must not open the album for the rest of the week.
 */
export const GALLERY_UNLOCK_TTL_MS = 2 * 60 * 60 * 1000

/** Never later than the link itself: nothing outlives the thing it was granted under. */
const cappedByLink = (now: Date, ttlMs: number, link: ShareLink): Date =>
  new Date(Math.min(now.getTime() + ttlMs, link.expiresAt.getTime()))

/** When a signed media URL minted at `now` under `link` stops working. */
export const grantExpiresAt = (now: Date, link: ShareLink): Date =>
  cappedByLink(now, GALLERY_GRANT_TTL_MS, link)

/** When a password entered at `now` for `link` has to be entered again. */
export const unlockExpiresAt = (now: Date, link: ShareLink): Date =>
  cappedByLink(now, GALLERY_UNLOCK_TTL_MS, link)
