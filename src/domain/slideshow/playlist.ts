import { DomainError } from '../shared/errors'
import { err, ok, type Result } from '../shared/result'
import type { PhotoId } from '../shared/ids'

/**
 * What the projector shows, and where it is in the sequence.
 *
 * Both are derived from the photos themselves. 1.0 kept the slideshow index in
 * `sessionStorage`, so a second projector in the same room ran its own position and
 * the two walls disagreed all evening — and a refresh restarted the show from a photo
 * nobody had seen for hours. Here the playlist is a value with a fingerprint and the
 * cursor is an integer over it: two displays handed the same photos compute the same
 * items, the same revision and therefore the same slide.
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

/** Where a running wall is: the playlist it holds, and the slot it is currently on. */
export interface PlaylistPosition {
  readonly playlist: Playlist
  readonly cursor: number
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

/** A cursor is any integer and the playlist is a ring, so negative steps wrap back. */
const wrapIndex = (index: number, length: number): number => ((index % length) + length) % length

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

/**
 * Which photos occupy the visible slots at `cursor`, wrapping past the end.
 *
 * When the playlist holds fewer photos than the layout has slots the result is short
 * too, and the layout renders empty cells. Repeating an id to fill the grid was the
 * alternative and it is worse: the same face twice on one wall reads as a bug to the
 * room, and the moment it would happen — three photos in, ten minutes after the doors
 * open — is when the host is watching the screen hardest.
 */
export const slotsAt = (
  playlist: Playlist,
  cursor: number,
  slotCount: number,
): readonly PhotoId[] => {
  const length = playlist.items.length
  if (length === 0 || slotCount < 1) return []

  const count = Math.min(slotCount, length)
  const start = wrapIndex(cursor, length)
  const head = playlist.items.slice(start, start + count)
  // Ran off the end: the front of the playlist follows the back, so the last slide is
  // succeeded by the first rather than by a gap.
  return head.length === count ? head : [...head, ...playlist.items.slice(0, count - head.length)]
}

/**
 * The next cursor. Wrapping and never negative, so the wall can run for eight hours
 * off a single incrementing counter without ever addressing a slot that has no photo.
 */
export const advance = (playlist: Playlist, cursor: number, step: number): number => {
  const length = playlist.items.length
  // Nothing to show. Park at the start rather than let the timer drift the cursor into
  // a position that would be meaningless once photos arrive.
  if (length === 0) return 0
  return wrapIndex(cursor + step, length)
}

/**
 * Where the cursor lands when the playlist changes under a running wall.
 *
 * Keep the photo that is on screen on screen — find its index in the new list — and
 * only fall back to a clamped position when it has genuinely gone: rejected, hidden,
 * or pushed out of the window. Without this the wall jumps to whatever now sits at the
 * old index every time a guest uploads, which is why 1.0's display appeared to shuffle
 * itself whenever the room got busy.
 */
export const cursorForRevision = (playlist: Playlist, previous: PlaylistPosition): number => {
  const length = playlist.items.length
  if (length === 0) return 0

  const showing = slotsAt(previous.playlist, previous.cursor, 1)[0]
  if (showing !== undefined) {
    const kept = playlist.items.indexOf(showing)
    if (kept !== -1) return kept
  }
  return Math.min(Math.max(previous.cursor, 0), length - 1)
}

/**
 * Where to splice a just-published photo so the room sees it next — or `null` when it
 * is already in rotation and there is nothing to splice.
 *
 * Immediately after the current slide: the guest who sent it is still holding their
 * phone, and "it will come round in a few minutes" is not the promise this product
 * makes. The index is `items.length` when the wall is on the last slide, i.e. an
 * append.
 *
 * `null` rather than the id's existing index, because a host who hides a photo and
 * restores it later re-publishes an id the playlist already holds, and a caller handed
 * a bare index cannot tell "insert here" from "already there". Splicing at an existing
 * index would put the same face on the wall twice in a row, so the no-op is expressed
 * in the return type instead of asked of the caller.
 */
export const insertionPointFor = (position: PlaylistPosition, freshId: PhotoId): number | null => {
  if (position.playlist.items.includes(freshId)) return null

  const length = position.playlist.items.length
  if (length === 0) return 0
  return wrapIndex(position.cursor, length) + 1
}
