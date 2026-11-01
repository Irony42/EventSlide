import type { ContributorEntry } from '../../domain/stats/contributorRanking'
import type { ReactionCounts } from '../../domain/reactions/reactionTally'
import type { EventId } from '../../domain/shared/ids'
import type { StatsMetric } from '../../domain/stats/statsMetric'
import type { PhotoStatusCounts } from './photoRepository'

/**
 * What the statistics page is made of (spec 05).
 *
 * **Derived, never counted.** Everything here is read from `photos`, `guests` and `reactions`
 * as they are now, so a guest's erasure or a deleted photograph changes the numbers on the next
 * read and no counter can outlive what it counted. Every figure leaves out a photograph the
 * operator took down, reactions included (the `reactions` table has no such column: they are
 * counted through their photograph).
 *
 * Aggregates only, by design: the adapter never hands back a list of media.
 */

/** A non-empty 15-minute slot of the event, `start` in UTC. */
export interface UploadQuarter {
  readonly start: Date
  readonly count: number
}

export interface DerivedStats {
  /**
   * Sends (photos and videos) per 15-minute UTC slot, **sparse** (empty slots are absent), in
   * time order. Not hours: the browser regroups into the reader's local hours, and a quarter
   * is the unit every real time zone is a whole multiple of.
   */
  readonly byQuarter: readonly UploadQuarter[]
  /** Sends by status, taken-down ones excluded. */
  readonly byStatus: PhotoStatusCounts
  readonly guests: {
    /** Every guest row of the event, the ones the host removed included. */
    readonly joined: number
    /** Guests with at least one send, any status, the ones the host removed included. */
    readonly contributors: number
    /** Guests the host removed. */
    readonly revoked: number
  }
  readonly reactions: {
    readonly total: number
    readonly byKind: ReactionCounts
  }
  /** One entry per guest with at least one **published** send, removed guests included. */
  readonly contributors: readonly ContributorEntry[]
}

/** One stored counter: how many times `metric` happened on `day` (UTC, `YYYY-MM-DD`). */
export interface StatsCounter {
  readonly metric: StatsMetric
  readonly day: string
  readonly value: number
}

export interface EventStatsRepository {
  /** Scoped by event like every read: another event's rows never enter a figure. */
  readDerived(eventId: EventId): Promise<DerivedStats>

  /**
   * Adds `delta` to the counter of that event, metric and day, creating it at `delta`. The only
   * write, and an addition rather than a read-modify-write: two opens at once are two.
   * `delta` is a positive integer; anything else is a `RangeError`, and nothing is written.
   */
  bump(eventId: EventId, metric: StatsMetric, day: string, delta: number): Promise<void>

  /** Every counter of the event, oldest day first (ties by metric). Another event's never. */
  readCounters(eventId: EventId): Promise<readonly StatsCounter[]>
}
