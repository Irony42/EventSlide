import type { Challenge } from '../../domain/challenges/challenge'
import type { EventId } from '../../domain/shared/ids'

/**
 * How an attempt to launch a challenge ended. Three outcomes the caller must tell apart,
 * because each is a different `409` for the host.
 */
export type StartOutcome = 'started' | 'alreadyRunning' | 'limitReached'

/**
 * The timed photo challenges of an event (spec 10).
 *
 * Every method takes `eventId` first: a challenge is read by the public wall, and a lookup
 * that could answer with another event's row would put a stranger's prompt on a projector.
 */
export interface ChallengeRepository {
  /**
   * Launches `challenge` unless one is already running at `now` or the history is full, and
   * does both checks and the insert as **one step**: two moderators tapping "Lancer" together
   * must not both win. "At most one running challenge" cannot be an index (running depends on
   * the clock), so this method is where it is true.
   */
  tryStart(challenge: Challenge, now: Date): Promise<StartOutcome>

  /** The most recently started challenge, running or not. The reader decides what to show. */
  findLatest(eventId: EventId): Promise<Challenge | null>

  /** Records a stop (`ended_at`). Only that field of an existing row changes. */
  save(challenge: Challenge): Promise<void>

  /**
   * How many **published** photographs answer the challenge: they name its mission, they were
   * received inside {@link Challenge.answerWindow}, and the operator has not taken them down.
   * Derived on every call, so a photograph that leaves the published state stops counting
   * with nothing to undo. A challenge whose mission is gone has no answers.
   */
  countAnswers(eventId: EventId, challenge: Challenge): Promise<number>
}
