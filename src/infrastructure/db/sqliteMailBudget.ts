import type { MailBudget } from '../../application/ports/mailBudget'
import type { Db } from './connection'

/**
 * `mail_daily_counts` (migration 042): a UTC day and the number of mails the box sent on it.
 *
 * `take` is **one conditional statement**, so two callers racing for the last places cannot both have
 * them: the upsert's `DO UPDATE … WHERE` leaves the row alone when the new total would pass the ceiling,
 * and `changes` says which happened. A request larger than the ceiling by itself is refused before the
 * statement, because the first insert of a day has no row to compare with.
 */
export class SqliteMailBudget implements MailBudget {
  /** `maxPerDay` is `MAIL_FOLLOWUP_MAX_PER_DAY`, or `null` for no ceiling. */
  constructor(
    private readonly db: Db,
    private readonly maxPerDay: number | null,
  ) {}

  async take(day: string, n: number): Promise<boolean> {
    // Nothing to take is not a success: no row is written for it.
    if (!(n >= 1)) return false
    if (this.maxPerDay === null) {
      await this.count(day, n)
      return true
    }
    if (n > this.maxPerDay) return false
    const result = this.db
      .prepare(
        `INSERT INTO mail_daily_counts (day, count) VALUES (?, ?)
         ON CONFLICT (day) DO UPDATE SET count = count + excluded.count
                                   WHERE count + excluded.count <= ?`,
      )
      .run(day, n, this.maxPerDay)
    return result.changes === 1
  }

  async count(day: string, n: number): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO mail_daily_counts (day, count) VALUES (?, ?)
         ON CONFLICT (day) DO UPDATE SET count = count + excluded.count`,
      )
      .run(day, n)
  }

  async used(day: string): Promise<number> {
    const row = this.db.prepare(`SELECT count FROM mail_daily_counts WHERE day = ?`).get(day) as
      { count: number } | undefined
    return row?.count ?? 0
  }

  async deleteBefore(day: string): Promise<number> {
    return this.db.prepare(`DELETE FROM mail_daily_counts WHERE day < ?`).run(day).changes
  }
}
