import type { GuestbookEntry, EntryStatus } from './guestbookEntry'
import { compareIds } from '../shared/ordering'

/**
 * The order in which the host reads the guestbook (spec 01): what needs a decision first, then
 * the rest.
 *
 * `pending` leads and is **oldest first**, for the reason the photo queue gives: a guest waiting
 * next to the projector for their word must not be starved by the ten that arrived after it. The
 * other statuses follow in the order the host cares about them (on the screen, then taken off it,
 * then refused), each **newest first** because the host is looking at what just happened. Ties
 * are broken by id, so two moderators see the same order.
 *
 * Applied to the whole set before any page limit: a limit taken first could push the oldest
 * pending message off the page.
 */

const RANK: Readonly<Record<EntryStatus, number>> = {
  pending: 0,
  published: 1,
  hidden: 2,
  rejected: 3,
}

export const orderGuestbookQueue = <T extends Pick<GuestbookEntry, 'id' | 'status' | 'createdAt'>>(
  entries: readonly T[],
): readonly T[] =>
  [...entries].sort((left, right) => {
    const byStatus = RANK[left.status] - RANK[right.status]
    if (byStatus !== 0) return byStatus
    const byArrival = left.createdAt.getTime() - right.createdAt.getTime()
    if (byArrival !== 0) return left.status === 'pending' ? byArrival : -byArrival
    return compareIds(left.id, right.id)
  })

/** The messages waiting for a decision: the badge on the host's tab. */
export const pendingGuestbookCount = (entries: readonly Pick<GuestbookEntry, 'status'>[]): number =>
  entries.filter((entry) => entry.status === 'pending').length
