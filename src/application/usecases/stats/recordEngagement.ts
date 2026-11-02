import type { StatsMetric } from '../../../domain/stats/statsMetric'
import { statsDayOf } from '../../../domain/stats/statsDay'
import type { EventId } from '../../../domain/shared/ids'
import type { Clock } from '../../ports/clock'
import type { EventStatsRepository } from '../../ports/eventStatsRepository'
import type { Logger } from '../../ports/logger'

/**
 * Counts one after-party event (an album opened, a ZIP launched) for the host statistics page.
 *
 * What is stored is an integer for the event, the metric and the UTC day, and nothing about
 * whoever caused it (migration 018). A guest opening a link is never made to wait for, or fail
 * on, a statistic: a repository error is logged and swallowed, and the caller gets nothing to
 * check. Called from the use case that serves the access, **after** it succeeded, so a refused
 * access (revoked, expired, locked, wrong password) is never counted.
 */

export interface RecordEngagementInput {
  readonly eventId: EventId
  readonly metric: StatsMetric
  readonly delta: number
}

export interface RecordEngagementDeps {
  readonly stats: Pick<EventStatsRepository, 'bump'>
  readonly clock: Clock
  readonly logger: Logger
}

export type RecordEngagement = (input: RecordEngagementInput) => Promise<void>

export const makeRecordEngagement =
  ({ stats, clock, logger }: RecordEngagementDeps): RecordEngagement =>
  async ({ eventId, metric, delta }) => {
    try {
      await stats.bump(eventId, metric, statsDayOf(clock.now()), delta)
    } catch (cause) {
      logger.warn('an engagement counter could not be written', {
        eventId,
        metric,
        reason: cause instanceof Error ? cause.message : 'unknown',
      })
    }
  }
