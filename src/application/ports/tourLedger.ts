import type { GuidedTour } from '../../domain/users/guidedTour'
import type { UserId } from '../../domain/shared/ids'

/**
 * Which guided tours an account has already been shown (the console's first-visit tours).
 *
 * Per **account**, not per browser: a host who opens their event on the phone first and on the
 * laptop afterwards is shown the tour once. Nothing here is an authority — a tour seen or not
 * changes what the console offers, never what a request may do.
 */
export interface TourLedger {
  /** The tours this account has seen, in no particular order. Empty for an unknown account. */
  seenBy(userId: UserId): Promise<readonly GuidedTour[]>

  /**
   * Records that the account was shown this tour. Idempotent: the first instant is kept, so a
   * tour finished on two devices does not move. Recording for an account that does not exist
   * records nothing.
   */
  markSeen(userId: UserId, tour: GuidedTour, at: Date): Promise<void>
}
