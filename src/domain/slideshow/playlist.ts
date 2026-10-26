import { DomainError } from '../shared/errors'
import { err, ok, type Result } from '../shared/result'
import type { PhotoId } from '../shared/ids'

/**
 * What the projector shows.
 *
 * It is derived from the photos themselves. 1.0 kept the slideshow index in
 * `sessionStorage`, so a second projector in the same room ran its own position and
 * the two walls disagreed all evening — and a refresh restarted the show from a photo
 * nobody had seen for hours. Here the playlist is a value with a fingerprint: two
 * displays handed the same photos compute the same items and the same revision. Where a
 * display is in it (the cursor, keeping the photo on screen when the list changes under it)
 * is the web client's, in `useSlideshow`, and is not modelled here.
 */

/**
 * Deliberately structural rather than the `Photo` entity: the wall needs an identity
 * and a timestamp, and depending on the entity would drag status, caption, dimensions
 * and a content hash into every ordering test.
 */
export interface PlaylistCandidate {
  readonly id: PhotoId
  readonly createdAt: Date
}

export interface Playlist {
  readonly items: readonly PhotoId[]
  /** Changes whenever the items change, in content or in order. */
  readonly revision: string
}

export interface PlaylistOptions {
  /**
   * Hard cap on how many photos stay in rotation. An event runs for eight hours and an
   * enthusiastic room sends thousands of photos; without a cap the list the projector
   * re-reads on every change grows all night, and the tail of it would not come round
   * again before the lights go up anyway.
   */
  readonly windowSize: number
  /**
   * `true` puts the newest photo first, which is what a live wall wants: a guest looks
   * up within a slide or two of uploading. `false` replays the same window oldest
   * first, for the end-of-evening pass that tells the story in order.
   */
  readonly freshFirst: boolean
}

const MIN_WINDOW_SIZE = 1

/** FNV-1a, 32-bit. */
const FNV_OFFSET_BASIS = 2_166_136_261
const FNV_PRIME = 16_777_619

/** A NUL code unit, which a generated id never contains. */
const ID_SEPARATOR = 0

/**
 * Newest first, ties broken by id.
 *
 * The tie-break is not cosmetic. Timestamps are only as fine as the clock that wrote
 * them, and a burst of uploads from one table lands inside the same tick; two
 * projectors sorting that burst differently would hold the same photos in a different
 * order and drift apart, which is the defect this module exists to prevent. Photo ids
 * are unique, so returning only -1 or 1 is total here: there is no pair for which both
 * orders could be claimed.
 */
const byNewestThenId = (a: PlaylistCandidate, b: PlaylistCandidate): number => {
  const byRecency = b.createdAt.getTime() - a.createdAt.getTime()
  if (byRecency !== 0) return byRecency
  return a.id < b.id ? -1 : 1
}

const mix = (hash: number, codeUnit: number): number => Math.imul(hash ^ codeUnit, FNV_PRIME) >>> 0

/**
 * An order-sensitive fingerprint of the item list.
 *
 * FNV-1a over the ids, seeded with the item count and separated by a code unit no id
 * contains, so `['ab', 'c']` and `['a', 'bc']` differ and so does any reordering of
 * the same photos. It is deliberately not a cryptographic digest: `node:crypto` is an
 * outer-layer dependency and this value guards nothing. It answers one question — "do
 * these two projectors hold the same playlist?" — and 32 bits in base 36 keeps the
 * answer short enough to put in every SSE frame.
 */
export const playlistRevision = (items: readonly PhotoId[]): string => {
  let hash = mix(FNV_OFFSET_BASIS, items.length)
  for (const id of items) {
    for (let index = 0; index < id.length; index += 1) {
      hash = mix(hash, id.charCodeAt(index))
    }
    hash = mix(hash, ID_SEPARATOR)
  }
  return hash.toString(36)
}

export const buildPlaylist = (
  candidates: readonly PlaylistCandidate[],
  { windowSize, freshFirst }: PlaylistOptions,
): Result<Playlist, DomainError> => {
  if (!Number.isInteger(windowSize)) {
    return err(DomainError.invalid('playlist.windowSizeNotInteger'))
  }
  if (windowSize < MIN_WINDOW_SIZE) {
    return err(DomainError.invalid('playlist.windowSizeTooSmall', { min: MIN_WINDOW_SIZE }))
  }

  // The window always keeps the *newest* candidates, whichever direction they are then
  // played in. Capping before the reversal is what stops a chronological wall from
  // spending the whole evening on the first hour of it.
  const newest = [...candidates].sort(byNewestThenId).slice(0, windowSize)
  const items = (freshFirst ? newest : newest.reverse()).map((candidate) => candidate.id)

  return ok({ items, revision: playlistRevision(items) })
}
