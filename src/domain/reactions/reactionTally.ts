import { DomainError } from '../shared/errors'
import { err, ok, type Result } from '../shared/result'
import type { GuestId, PhotoId } from '../shared/ids'
import { REACTION_KINDS, type ReactionKind } from './reactionKind'

/**
 * Aggregation over reactions, shared by the wall and by "photo of the night".
 *
 * The input is structural rather than a `Reaction`, because the wall recounts on every
 * tap: it reads `SELECT kind, guest_id` and must not build five hundred entities to
 * produce five numbers that change again a second later.
 */
export interface TallyEntry {
  readonly kind: ReactionKind
  readonly guestId: GuestId
}

export type ReactionCounts = Readonly<Record<ReactionKind, number>>

/**
 * Written out rather than derived from `REACTION_KINDS`, because the annotation then
 * turns adding a kind into a compile error here — instead of a key the wall silently
 * reads as `undefined` and renders as `NaN`.
 */
const ZERO: ReactionCounts = { love: 0, laugh: 0, wow: 0, cheers: 0, clap: 0 }

/** A fresh set of counts, every kind present at zero, so no caller handles a gap. */
export const emptyCounts = (): ReactionCounts => ({ ...ZERO })

/**
 * Counts the rows as given. Nothing is deduplicated here: one reaction per guest per
 * kind per photo is a unique index in SQLite, and a tally that quietly folded a second
 * row away would hide the day that index goes missing.
 */
export const tally = (entries: readonly TallyEntry[]): ReactionCounts => {
  const counts: Record<ReactionKind, number> = { ...ZERO }
  for (const entry of entries) {
    counts[entry.kind] += 1
  }
  return counts
}

/**
 * Unweighted on purpose. `reactionWeight` sizes the floating animation; if it also
 * scored this sum then the photo of the night would be won by whoever tapped the
 * heart, which is not what the room voted for.
 */
export const totalReactions = (counts: ReactionCounts): number =>
  REACTION_KINDS.reduce((total, kind) => total + counts[kind], 0)

/**
 * The pure half of "you already reacted". The use case checks this before writing, so
 * a double tap on a slow connection is a no-op rather than a conflict the guest sees;
 * the unique index catches the race the check cannot.
 */
export const hasReacted = (
  entries: readonly TallyEntry[],
  guestId: GuestId,
  kind: ReactionKind,
): boolean => entries.some((entry) => entry.guestId === guestId && entry.kind === kind)

interface RankedPhoto {
  readonly photoId: PhotoId
  readonly total: number
}

/** Code-unit order, not locale order: a ranking must not depend on the host's ICU. */
const compareIds = (left: PhotoId, right: PhotoId): number =>
  Number(left > right) - Number(left < right)

/**
 * Total descending, then id ascending. The tie-break is not cosmetic: without it the
 * order fell out of the map's insertion order, so two projectors reading the same
 * event could disagree about the photo of the night — the same class of defect as
 * 1.0's per-browser slideshow index.
 */
const byTotalThenId = (left: RankedPhoto, right: RankedPhoto): number =>
  right.total - left.total || compareIds(left.photoId, right.photoId)

export const topPhotos = (
  byPhoto: ReadonlyMap<PhotoId, ReactionCounts>,
  limit: number,
): Result<readonly PhotoId[], DomainError> => {
  if (!Number.isInteger(limit)) {
    return err(DomainError.invalid('reaction.limitNotInteger'))
  }
  if (limit < 1) {
    return err(DomainError.invalid('reaction.limitOutOfRange', { min: 1 }))
  }
  const ranked = [...byPhoto]
    .map(([photoId, counts]) => ({ photoId, total: totalReactions(counts) }))
    .sort(byTotalThenId)
    .slice(0, limit)
    .map((entry) => entry.photoId)
  return ok(ranked)
}
