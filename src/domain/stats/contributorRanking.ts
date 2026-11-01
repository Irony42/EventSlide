import type { GuestId } from '../shared/ids'
import { compareIds } from '../shared/ordering'

/**
 * "Ceux qui ont le plus partagé": who the host sees at the top of the statistics page.
 *
 * The input is structural, one entry per guest who has at least one published send, because the
 * adapter reads aggregates and never the rows (spec 05, §8). `photos` is what the guest has
 * published, `reactions` what those same published sends received: one scope for both columns of
 * a line, otherwise a line would say two things about two different sets of photographs.
 */

/** The page names ten guests at most. A longer list is a leaderboard, and this is a recap. */
export const TOP_CONTRIBUTORS_LIMIT = 10

export interface ContributorEntry {
  readonly guestId: GuestId
  /** `null` when the guest stayed anonymous (or lost their name to an erasure). */
  readonly displayName: string | null
  /** The host removed this guest: they leave the ranking and stay counted as removed. */
  readonly revoked: boolean
  readonly photos: number
  readonly reactions: number
}

export interface RankedContributor {
  readonly displayName: string
  readonly photos: number
  readonly reactions: number
}

export interface ContributorRanking {
  readonly top: readonly RankedContributor[]
  /** Guests without a name, folded into one line: they are never listed one by one. */
  readonly anonymous: { readonly guests: number; readonly photos: number }
}

/**
 * Most published sends first, then most reactions received, then guest id: a total order, so two
 * readers of the same event agree on the line a tie lands on (the same argument as `rankedPhotos`).
 */
const bySharing = (left: ContributorEntry, right: ContributorEntry): number =>
  right.photos - left.photos ||
  right.reactions - left.reactions ||
  compareIds(left.guestId, right.guestId)

export const rankContributors = (
  entries: readonly ContributorEntry[],
  limit: number = TOP_CONTRIBUTORS_LIMIT,
): ContributorRanking => {
  const eligible = entries.filter((entry) => !entry.revoked && entry.photos > 0)

  const named = eligible.flatMap((entry) =>
    entry.displayName === null ? [] : [{ ...entry, displayName: entry.displayName }],
  )
  const anonymous = eligible.filter((entry) => entry.displayName === null)

  return {
    top: named
      .sort(bySharing)
      .slice(0, Math.min(limit, TOP_CONTRIBUTORS_LIMIT))
      .map(({ displayName, photos, reactions }) => ({ displayName, photos, reactions })),
    anonymous: {
      guests: anonymous.length,
      photos: anonymous.reduce((sum, entry) => sum + entry.photos, 0),
    },
  }
}
