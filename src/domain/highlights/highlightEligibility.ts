import type { MediaKind } from '../photos/mediaKind'
import type { PhotoStatus } from '../photos/photoStatus'

/**
 * The host's favourites (spec 08): the photographs a best-of is made from.
 *
 * Only a **published** photograph may carry the star. A best-of exists to be shown, so a
 * hidden or rejected photograph is neither starred nor exported, unlike the album ZIP
 * (`isInAlbum`), which keeps hidden ones. The predicate is asked here once: `Photo` clears
 * the star when it leaves `published`, the repository refuses to set it on anything else,
 * and the ZIP's query filters on the same status.
 */
export const isHighlightable = (status: PhotoStatus): boolean => status === 'published'

/** How many photographs "pre-select the most liked" stars when the host does not say. */
export const DEFAULT_PRESELECT_LIMIT = 20

/** The most the host may ask to pre-select at once. */
export const MAX_PRESELECT_LIMIT = 120

/**
 * Whether a photograph may appear in the montage: published, and a photograph. A clip can be
 * starred and is in the ZIP (a file), but the video is made of stills in v1. The ZIP and the
 * video share the first condition (isHighlightable), and a taken-down row is never read.
 */
export const isReelEligible = (status: PhotoStatus, kind: MediaKind): boolean =>
  isHighlightable(status) && kind === 'photo'
