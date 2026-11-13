import type { GuidedTour } from '../../domain/users/guidedTour'
import type { UserId } from '../../domain/shared/ids'
import type { TourLedger } from '../ports/tourLedger'

/**
 * In-memory `TourLedger`.
 *
 * The foreign key on `user_id` is mirrored by {@link FakeTourLedger.withAccounts}: a fake that
 * recorded a tour for an account that does not exist would pass tests the real table would
 * fail. A ledger built without it knows no account and records nothing.
 */
export class FakeTourLedger implements TourLedger {
  private readonly seen = new Map<UserId, Map<GuidedTour, Date>>()
  private readonly accounts = new Set<UserId>()

  /** The accounts that exist, for the foreign key on `user_id`. */
  withAccounts(...ids: readonly UserId[]): this {
    for (const id of ids) this.accounts.add(id)
    return this
  }

  /** When the account was first shown the tour, or `undefined`. For a test to look at. */
  seenAt(userId: UserId, tour: GuidedTour): Date | undefined {
    return this.seen.get(userId)?.get(tour)
  }

  async seenBy(userId: UserId): Promise<readonly GuidedTour[]> {
    return [...(this.seen.get(userId)?.keys() ?? [])]
  }

  async markSeen(userId: UserId, tour: GuidedTour, at: Date): Promise<void> {
    if (!this.accounts.has(userId)) return
    const tours = this.seen.get(userId) ?? new Map<GuidedTour, Date>()
    if (!tours.has(tour)) tours.set(tour, at)
    this.seen.set(userId, tours)
  }
}
