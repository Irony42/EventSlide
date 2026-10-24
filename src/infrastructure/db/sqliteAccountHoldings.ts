import type Database from 'better-sqlite3'
import type { UserId } from '../../domain/shared/ids'
import type { AccountHoldings, AccountHoldingsCount } from '../../application/ports/accountHoldings'
import type { Db } from './connection'

interface HoldingsRow {
  readonly events: number
  readonly media: number
  readonly reviews: number
  readonly event_memberships: number
}

/** The three counts of `AccountHoldings`, in one statement: each reads an index on the account's id. */
export class SqliteAccountHoldings implements AccountHoldings {
  private readonly select: Database.Statement<[string, string, string, string, string], HoldingsRow>

  constructor(db: Db) {
    this.select = db.prepare<[string, string, string, string, string], HoldingsRow>(
      `SELECT
         (SELECT COUNT(*) FROM events WHERE owner_id = ?) AS events,
         (SELECT COUNT(*) FROM photos WHERE author_user_id = ?)
           + (SELECT COUNT(*) FROM clip_jobs WHERE author_user_id = ?) AS media,
         (SELECT COUNT(*) FROM photos WHERE reviewed_by_user_id = ?) AS reviews,
         (SELECT COUNT(*) FROM event_memberships WHERE user_id = ?) AS event_memberships`,
    )
  }

  async countFor(userId: UserId): Promise<AccountHoldingsCount> {
    const row = this.select.get(userId, userId, userId, userId, userId)
    return {
      events: row?.events ?? 0,
      media: row?.media ?? 0,
      reviews: row?.reviews ?? 0,
      eventMemberships: row?.event_memberships ?? 0,
    }
  }
}
