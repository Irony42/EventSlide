import type { MediaKind } from './mediaKind'
import type { ServedVariant } from './mediaVariant'

/**
 * What a guest may keep of a photograph from the feed (spec 24), and under what name.
 *
 * ## Which rendition: `display`, never `original`
 *
 * A guest saving a photo gets the 2560 px rendition the wall already serves to anyone who holds
 * its address (docs/SECURITY.md section 12), and **never** the `original`, which only a
 * moderator and the host's shared gallery read. Giving it to every guest would turn each phone in
 * the room into a door to the full-resolution file of the whole album, and a file two to three
 * times heavier is a download that fails on a venue's Wi-Fi.
 *
 * A table per kind rather than a branch, for the reason `mediaVariant.ts` and `GALLERY_RENDITIONS`
 * give: a conditional on `kind` costs a photo test and a clip test at every call site, and this
 * way a clip (or any later rendition) is a value here and not an `if` elsewhere.
 *
 * `null` is "this kind is not saved from the feed": a clip is not, in this version, because a
 * transcoded video weighs far more than a still and the gallery already hands out the transcode.
 */
export const GUEST_SAVE_RENDITION: Readonly<Record<MediaKind, ServedVariant | null>> = {
  photo: 'display',
  clip: null,
}

/** The extension a saved file is named with. The stored bytes decide it, per kind. */
export const GUEST_SAVE_EXTENSION: Readonly<Record<MediaKind, string>> = {
  photo: 'jpg',
  clip: 'mp4',
}
