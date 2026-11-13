import type { TourLedger } from '../../application/ports/tourLedger'
import type { UserId } from '../../domain/shared/ids'
import { isGuidedTour, type GuidedTour } from '../../domain/users/guidedTour'
import type { Db } from './connection'
import { toIsoText } from './rowMapping'

/**
 * `user_tours` (migration 028).
 *
 * `markSeen` is one statement: `INSERT … SELECT` from `users`, so an account that does not
 * exist inserts no row (rather than failing on the foreign key), and `ON CONFLICT DO NOTHING`
 * keeps the first instant a tour was seen.
 */
export class SqliteTourLedger implements TourLedger {
  constructor(private readonly db: Db) {}

  async seenBy(userId: UserId): Promise<readonly GuidedTour[]> {
    const rows = this.db
      .prepare<[string], { tour: string }>(`SELECT tour FROM user_tours WHERE user_id = ?`)
      .all(userId)
    // The `CHECK` holds the same vocabulary; the filter is what a row written by a newer build
    // (a tour this one does not know) turns into: nothing to show.
    return rows.map((row) => row.tour).filter(isGuidedTour)
  }

  async markSeen(userId: UserId, tour: GuidedTour, at: Date): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO user_tours (user_id, tour, seen_at)
              SELECT id, ?, ? FROM users WHERE id = ?
         ON CONFLICT (user_id, tour) DO NOTHING`,
      )
      .run(tour, toIsoText(at), userId)
  }
}
