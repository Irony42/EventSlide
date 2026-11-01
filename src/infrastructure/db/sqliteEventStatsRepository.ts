import type { Db } from './connection'
import { fromIsoText } from './rowMapping'
import type {
  DerivedStats,
  EventStatsRepository,
  StatsCounter,
} from '../../application/ports/eventStatsRepository'
import type { PhotoStatusCounts } from '../../application/ports/photoRepository'
import type { StatsMetric } from '../../domain/stats/statsMetric'
import type { PhotoStatus } from '../../domain/photos/photoStatus'
import { emptyCounts } from '../../domain/reactions/reactionTally'
import type { ReactionKind } from '../../domain/reactions/reactionKind'
import { asGuestId, type EventId } from '../../domain/shared/ids'

/**
 * The statistics page's numbers, read as a handful of grouped aggregates.
 *
 * **Every statement carries `event_id`, and every statement over photographs carries
 * `taken_down_at IS NULL`.** `reactions` has no `taken_down_at` of its own, so a reaction is
 * counted through the photograph it sits on, with `event_id` checked on both sides of the join;
 * `countsForEvent` is not reused because its query does not look at the photograph at all and a
 * reaction on a photograph the operator took down would leak into the total.
 *
 * better-sqlite3 is synchronous and shares its connection with the upload path, so these stay a
 * few indexed `GROUP BY`s on one event and never read a row's media (spec 05, section 8). The
 * statements are exported for the query-plan test.
 */

export const STATS_SQL = {
  byStatus: `SELECT status, COUNT(*) AS total FROM photos
              WHERE event_id = ? AND taken_down_at IS NULL GROUP BY status`,
  // `created_at` is `toISOString()` text (`2026-06-20T19:14:59.000Z`): the first 14 characters
  // are the date and the hour with its colon, characters 15-16 the minute. Flooring the minute
  // to 0/15/30/45 gives the slot's start as the same kind of text.
  byQuarter: `SELECT substr(created_at, 1, 14) ||
                     printf('%02d', (CAST(substr(created_at, 15, 2) AS INTEGER) / 15) * 15) ||
                     ':00.000Z' AS start,
                     COUNT(*) AS total
                FROM photos
               WHERE event_id = ? AND taken_down_at IS NULL
               GROUP BY start
               ORDER BY start`,
  guests: `SELECT COUNT(*) AS joined, COUNT(revoked_at) AS revoked FROM guests WHERE event_id = ?`,
  senders: `SELECT COUNT(DISTINCT author_guest_id) AS total FROM photos
             WHERE event_id = ? AND taken_down_at IS NULL AND author_guest_id IS NOT NULL`,
  reactions: `SELECT r.kind AS kind, COUNT(*) AS total
                FROM reactions r
                JOIN photos p ON p.id = r.photo_id AND p.event_id = r.event_id
               WHERE r.event_id = ? AND p.event_id = ? AND p.taken_down_at IS NULL
               GROUP BY r.kind`,
  contributors: `SELECT g.id AS id, g.display_name AS display_name, g.revoked_at AS revoked_at,
                        sent.total AS photos, COALESCE(got.total, 0) AS reactions
                   FROM guests g
                   JOIN (SELECT author_guest_id, COUNT(*) AS total FROM photos
                          WHERE event_id = ? AND status = 'published'
                            AND taken_down_at IS NULL AND author_guest_id IS NOT NULL
                          GROUP BY author_guest_id) sent ON sent.author_guest_id = g.id
                   LEFT JOIN (SELECT p.author_guest_id AS author_guest_id, COUNT(*) AS total
                                FROM reactions r
                                JOIN photos p ON p.id = r.photo_id AND p.event_id = r.event_id
                               WHERE r.event_id = ? AND p.event_id = ? AND p.status = 'published'
                                 AND p.taken_down_at IS NULL AND p.author_guest_id IS NOT NULL
                               GROUP BY p.author_guest_id) got ON got.author_guest_id = g.id
                  WHERE g.event_id = ?`,
  bump: `INSERT INTO event_stats_counters (event_id, metric, day, value) VALUES (?, ?, ?, ?)
          ON CONFLICT (event_id, metric, day) DO UPDATE SET value = value + excluded.value`,
  counters: `SELECT metric, day, value FROM event_stats_counters
               WHERE event_id = ? ORDER BY day, metric`,
} as const

export class SqliteEventStatsRepository implements EventStatsRepository {
  constructor(private readonly db: Db) {}

  async bump(eventId: EventId, metric: StatsMetric, day: string, delta: number): Promise<void> {
    if (!Number.isSafeInteger(delta) || delta < 1) {
      throw new RangeError(`bump requires a positive integer delta, got ${delta}`)
    }
    this.db
      .prepare<[string, string, string, number]>(STATS_SQL.bump)
      .run(eventId, metric, day, delta)
  }

  async readCounters(eventId: EventId): Promise<readonly StatsCounter[]> {
    return this.db
      .prepare<[string], { metric: StatsMetric; day: string; value: number }>(STATS_SQL.counters)
      .all(eventId)
  }

  async readDerived(eventId: EventId): Promise<DerivedStats> {
    const byStatus: Record<keyof PhotoStatusCounts, number> = {
      pending: 0,
      published: 0,
      rejected: 0,
      hidden: 0,
    }
    for (const row of this.db
      .prepare<[string], { status: PhotoStatus; total: number }>(STATS_SQL.byStatus)
      .all(eventId)) {
      byStatus[row.status] = row.total
    }

    const byQuarter = this.db
      .prepare<[string], { start: string; total: number }>(STATS_SQL.byQuarter)
      .all(eventId)
      .map((row) => ({ start: fromIsoText(row.start), count: row.total }))

    const guests = this.db
      .prepare<[string], { joined: number; revoked: number }>(STATS_SQL.guests)
      .get(eventId)
    const senders = this.db.prepare<[string], { total: number }>(STATS_SQL.senders).get(eventId)

    const byKind: Record<ReactionKind, number> = { ...emptyCounts() }
    let total = 0
    for (const row of this.db
      .prepare<[string, string], { kind: ReactionKind; total: number }>(STATS_SQL.reactions)
      .all(eventId, eventId)) {
      byKind[row.kind] = row.total
      total += row.total
    }

    const contributors = this.db
      .prepare<
        [string, string, string, string],
        {
          id: string
          display_name: string | null
          revoked_at: string | null
          photos: number
          reactions: number
        }
      >(STATS_SQL.contributors)
      .all(eventId, eventId, eventId, eventId)
      .map((row) => ({
        guestId: asGuestId(row.id),
        displayName: row.display_name,
        revoked: row.revoked_at !== null,
        photos: row.photos,
        reactions: row.reactions,
      }))

    return {
      byQuarter,
      byStatus,
      // An aggregate without GROUP BY always returns a row.
      guests: {
        joined: guests?.joined ?? 0,
        contributors: senders?.total ?? 0,
        revoked: guests?.revoked ?? 0,
      },
      reactions: { total, byKind },
      contributors,
    }
  }
}
