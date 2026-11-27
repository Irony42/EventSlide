import { budgetDayOf, MAIL_COUNTS_KEPT_DAYS } from '../../../domain/notices/mailPreferences'
import { addDays } from '../../../domain/shared/time'
import type { Clock } from '../../ports/clock'
import type { MailBudget } from '../../ports/mailBudget'

export interface PruneMailBudgetDeps {
  readonly budget: Pick<MailBudget, 'deleteBefore'>
  readonly clock: Clock
}

export interface PruneMailBudgetReport {
  /** How many days of counts were erased. */
  readonly erased: number
}

export type PruneMailBudget = () => Promise<PruneMailBudgetReport>

/**
 * Erases the daily mail counts older than a week (spec 32, section 5), a step of the retention sweep:
 * the day's count is needed for the day, yesterday's for the monitoring alert, and nothing after
 * that. The rows hold a day and a number and no address, so this is housekeeping, not erasure of
 * personal data. A day is a UTC calendar day: the cutoff is the day seven days back, and a count of
 * that very day is kept.
 */
export const makePruneMailBudget =
  ({ budget, clock }: PruneMailBudgetDeps): PruneMailBudget =>
  async () => ({
    erased: await budget.deleteBefore(budgetDayOf(addDays(clock.now(), -MAIL_COUNTS_KEPT_DAYS))),
  })
