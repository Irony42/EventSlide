import type { DomainError } from '../../../domain/shared/errors'
import type { UserId } from '../../../domain/shared/ids'
import { ok, type Result } from '../../../domain/shared/result'
import type { GuidedTour } from '../../../domain/users/guidedTour'
import type { Clock } from '../../ports/clock'
import type { TourLedger } from '../../ports/tourLedger'

export interface MarkTourSeenInput {
  /** From the session, never from the request: this records what *that* account was shown. */
  readonly userId: UserId
  readonly tour: GuidedTour
}

export interface MarkTourSeenDeps {
  readonly tours: Pick<TourLedger, 'markSeen'>
  readonly clock: Clock
}

export type MarkTourSeen = (input: MarkTourSeenInput) => Promise<Result<void, DomainError>>

/**
 * The console showed a guided tour to the end, or the person chose to skip it: either way it
 * is not offered by itself again, on this device or any other. Replaying it from the page's
 * "Visite guidée" button stays possible and moves nothing (the first instant is kept).
 *
 * It cannot fail: the account comes from a session the gate already read, and an account
 * deleted in between records nothing, which is what a tour for nobody should do.
 */
export const makeMarkTourSeen =
  ({ tours, clock }: MarkTourSeenDeps): MarkTourSeen =>
  async ({ userId, tour }) => {
    await tours.markSeen(userId, tour, clock.now())
    return ok(undefined)
  }
