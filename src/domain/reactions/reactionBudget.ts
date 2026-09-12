import { DomainError } from '../shared/errors'
import { err, ok, type Result } from '../shared/result'

/**
 * The arithmetic of "not that fast", and nothing else.
 *
 * A reaction is the one write a guest can repeat as quickly as a thumb moves, and each
 * one fans out to every browser holding the wall open. Unbounded, that is a spam
 * channel on the projector and a denial of service on a self-hosted box at the same
 * time.
 *
 * Enforcement is two layers, neither of them here: the HTTP rate limiter drops a flood
 * per IP and per event before it reaches a use case, and the use case counts the
 * guest's own recent reactions and consults `canReact` before writing. This module
 * owns only the sums — which is what makes the rule testable with no clock, no
 * repository and no limiter, unlike 1.0 where there was no rule to test.
 */

export interface ReactionBudget {
  /** How many reactions this guest has already sent inside the window ending now. */
  readonly recentCount: number
  /**
   * The window `recentCount` was counted over. It takes no part in the comparison —
   * the count already answers that — but it travels with the count because
   * `nextAllowedAt` takes the whole budget: the window a guest is told to wait for
   * therefore cannot drift from the window that refused them.
   */
  readonly windowMs: number
  readonly maxPerWindow: number
}

const invalidWindow = (windowMs: number): DomainError | null =>
  Number.isInteger(windowMs) && windowMs > 0 ? null : DomainError.invalid('reaction.windowInvalid')

/**
 * Whether one more reaction fits in the window.
 *
 * A `false` is not an error: the use case is the layer that knows whether the caller
 * is a guest to slow down with `rateLimited` or a replay to ignore, and turning the
 * decision into an error here would make the two indistinguishable.
 */
export const canReact = (budget: ReactionBudget): Result<boolean, DomainError> => {
  const badWindow = invalidWindow(budget.windowMs)
  if (badWindow !== null) return err(badWindow)

  // A cap of zero is refused rather than read as "reactions off". Whether reactions
  // exist at all is an event setting; letting a budget say it too would give "why
  // can't I react" two answers in two places.
  if (!Number.isInteger(budget.maxPerWindow) || budget.maxPerWindow < 1) {
    return err(DomainError.invalid('reaction.maxPerWindowInvalid'))
  }
  if (!Number.isInteger(budget.recentCount) || budget.recentCount < 0) {
    return err(DomainError.invalid('reaction.recentCountInvalid'))
  }
  return ok(budget.recentCount < budget.maxPerWindow)
}

/**
 * When the oldest reaction in the window falls out of it — the earliest moment the
 * guest can send another. The HTTP layer turns this into `Retry-After` so the phone
 * can grey the buttons for exactly that long instead of guessing, and so a guest is
 * never told "too fast" twice in a row for the same burst.
 */
export const nextAllowedAt = (
  budget: ReactionBudget,
  oldestRecentAt: Date,
): Result<Date, DomainError> => {
  const badWindow = invalidWindow(budget.windowMs)
  if (badWindow !== null) return err(badWindow)
  return ok(new Date(oldestRecentAt.getTime() + budget.windowMs))
}
