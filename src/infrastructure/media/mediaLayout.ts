import type { MediaVariant } from '../../application/ports/mediaStore'

/**
 * Where the media store lays an object down, and what it calls it: the one place.
 *
 *     <eventId>/<variant>/<ab>/<contentHash>.<ext>
 *
 * The filesystem store writes and reads it, and the backup archive walks the same paths to
 * check that every row's files are on the disk and every file on the disk is a row's. The
 * layout used to be written out in each, with a comment saying the second one named it "as
 * `fsMediaStore` does": nothing tied them, and a change to the store's layout would have had
 * the backup report every file missing while its own test, written against the same copy,
 * went on passing. `mediaLayout.test.ts` pins the literal paths, because the layout is also
 * what is already on every installed disk, and a change to it orphans an album.
 */

/**
 * The declared type of each rendition, indexed rather than assumed.
 *
 * This table used to be three entries all reading `image/jpeg`, with the extension a
 * single `const EXTENSION = 'jpg'` beside it — which was true while every byte in the
 * store was a JPEG and became a bug the moment one of them was not. A clip served
 * through that store would have reached the projector labelled `image/jpeg` inside a
 * file called `.jpg`, and with `X-Content-Type-Options: nosniff` on every media response
 * the browser would have believed the label and rendered nothing.
 */
export const CONTENT_TYPE: Readonly<Record<MediaVariant, string>> = {
  original: 'image/jpeg',
  display: 'image/jpeg',
  thumb: 'image/jpeg',
  video: 'video/mp4',
  poster: 'image/jpeg',
  // Never served (`source` is outside `SERVED_VARIANTS`), so the honest answer is "some
  // bytes" rather than a type that would invite something to open them.
  source: 'application/octet-stream',
  // A host's venue photograph, always re-encoded to WebP by `setVenuePhoto`.
  ground: 'image/webp',
  // A host's logo, always re-encoded to WebP (alpha kept) by `setEventLogo`.
  logo: 'image/webp',
}

export const EXTENSION: Readonly<Record<MediaVariant, string>> = {
  original: 'jpg',
  display: 'jpg',
  thumb: 'jpg',
  video: 'mp4',
  poster: 'jpg',
  source: 'bin',
  ground: 'webp',
  logo: 'webp',
}

/** The characters of the shard directory: the first two of the hash. */
const SHARD_LENGTH = 2

/**
 * The path of one object relative to the media root, with `/` as the separator.
 *
 * Pure text: it checks nothing. `fsMediaStore` validates the event id and the hash before it
 * calls this and proves the result is inside the root after. The backup archive uses the result
 * as an opaque key to match against the files it walked, and never opens it, so a row with an
 * odd id yields a string that matches nothing and is reported as a missing file.
 */
export const mediaObjectPath = (
  eventId: string,
  contentHash: string,
  variant: MediaVariant,
): string =>
  `${eventId}/${variant}/${contentHash.slice(0, SHARD_LENGTH)}/${contentHash}.${EXTENSION[variant]}`
