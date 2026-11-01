import type { PhotoStatus } from './photoStatus'

/**
 * Whether a guest may take back what they sent, as one rule shared by everything a guest sends.
 *
 * A photograph and a guestbook message are taken back by the same rule, because the guest-facing
 * notice makes **one** promise about it (`privacy/privacyNotice.ts`): the host's switch over the
 * whole feature, then the author, inside the grace window, while the host has not yet put it on
 * the wall. Written twice, the two copies would drift and the notice would say two things.
 */

/** What a removal asks of the rule, and what it answers. */
export type DeletionVerdict = 'allowed' | 'selfDeleteDisabled' | 'forbidden'

/**
 * A guest's own contribution, taken back by them: theirs, inside the window, and only while it
 * has not been published - pulling something off the wall mid-evening is the host's call.
 */
export const authorMayTakeBack = (facts: {
  readonly isAuthor: boolean
  readonly createdAt: Date
  readonly now: Date
  readonly graceMs: number
  readonly status: PhotoStatus
}): boolean => {
  if (!facts.isAuthor) return false
  if (facts.now.getTime() - facts.createdAt.getTime() > facts.graceMs) return false
  return facts.status === 'pending' || facts.status === 'rejected'
}

/**
 * The verdict: the event's veto first (a guest only), then whether the actor may.
 *
 * The two refusals stay distinct because a guest can act on one of them (ask the host) and not on
 * the other.
 */
export const removalVerdict = (
  actorIsGuest: boolean,
  mayRemove: boolean,
  allowGuestSelfDelete: boolean,
): DeletionVerdict => {
  if (actorIsGuest && !allowGuestSelfDelete) return 'selfDeleteDisabled'
  return mayRemove ? 'allowed' : 'forbidden'
}
