import type { MediaKind } from './mediaKind'

/**
 * The renditions one wall row is stored as.
 *
 * This used to live on the `MediaStore` port, which read as a storage concern and is
 * not one: which renditions exist is product policy — a 4K projector and a moderation
 * grid cannot be served by one file — and the domain is where a `Photo` has to be able
 * to say which of them address its own bytes. The port re-exports every name here, so
 * nothing outside this file had to change.
 *
 * **The three sets are deliberately separate tuples, not one widened list.**
 * `VARIANT_SPECS` in guest photo ingest is an exhaustive `Record<PhotoVariant,
 * RenderSpec>` describing how a still is rendered — a `poster` member added to that
 * tuple would not compile until somebody invented a poster for a photograph, and a
 * `video` member until somebody invented a JPEG quality for an mp4. A clip is not a
 * fourth size of a photo; it is a different set of renditions for the same row.
 */

/** A still photograph: the album original, the projected image, the grid tile. */
export const MEDIA_VARIANTS = ['original', 'display', 'thumb'] as const

export type PhotoVariant = (typeof MEDIA_VARIANTS)[number]

/**
 * A clip: the transcoded H.264/AAC file, and the still frame everything that cannot play
 * a video renders instead — the moderation grid, the album index, the wall while the
 * clip is loading, and the ZIP export.
 *
 * There is no `original`. The stored bytes are always the pipeline's output; a clip's
 * upload is never kept, because keeping it would keep the GPS atom, the gyroscope track
 * and whatever else the phone wrote into the container.
 */
export const CLIP_VARIANTS = ['video', 'poster'] as const

export type ClipVariant = (typeof CLIP_VARIANTS)[number]

/**
 * The guest's upload, on its way to the transcoder. **Never served to anybody.**
 *
 * It is a variant so that it lands inside `<MEDIA_ROOT>/<eventId>/`, where the event's
 * purge, the media reconciliation figure and the container's writable volume already
 * reach it — a scratch directory somewhere else would be a second place for a guest's
 * bytes to be forgotten. It is outside {@link SERVED_VARIANTS} so that it is
 * *structurally* unservable: the media use case takes a `ServedVariant`, so there is no
 * value a route could parse that would hand a stranger a guest's un-stripped original
 * with its location metadata intact.
 */
export const STAGED_SOURCE = 'source'

export const SERVED_VARIANTS = [...MEDIA_VARIANTS, ...CLIP_VARIANTS] as const

export type ServedVariant = PhotoVariant | ClipVariant

export type MediaVariant = ServedVariant | typeof STAGED_SOURCE

/** Everything the store can hold, for the operations that must cover all of it. */
export const ALL_MEDIA_VARIANTS = [...SERVED_VARIANTS, STAGED_SOURCE] as const

/**
 * Which renditions a row of each kind actually has.
 *
 * A branch-free index rather than an `if (kind === 'clip')`, which is the rule for
 * everything mechanical about a clip: domain and application are gated at 100% branches,
 * so a conditional here would cost a photo test and a clip test at every call site for
 * the rest of the project, while a lookup costs neither.
 */
export const VARIANTS_BY_KIND: Readonly<Record<MediaKind, readonly ServedVariant[]>> = {
  photo: MEDIA_VARIANTS,
  clip: CLIP_VARIANTS,
}

export const isServedVariant = (value: unknown): value is ServedVariant =>
  typeof value === 'string' && (SERVED_VARIANTS as readonly string[]).includes(value)

/** Whether this rendition belongs to a row of this kind. */
export const hasVariant = (kind: MediaKind, variant: ServedVariant): boolean =>
  VARIANTS_BY_KIND[kind].includes(variant)
