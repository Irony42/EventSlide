import type { Challenge, ChallengeState } from '../../../domain/challenges/challenge'
import type { EventId } from '../../../domain/shared/ids'
import type { ChallengeRepository } from '../../ports/challengeRepository'

/**
 * What a reader (the wall, a phone, the host's console) is shown of an event's challenge at
 * `now`, or `null` when there is nothing to show: none ever launched, or the last one ended
 * more than twenty seconds ago.
 *
 * **`answers` is `null` unless the challenge is over and somebody answered.** It is `null`
 * while it runs (a live count would invite a race for the number, and spend a query on every
 * read of the evening), and `null` when nobody did ("Défi terminé" alone is kinder than
 * "0 photos"). It counts **published** photographs only, so it can never reveal the activity
 * of the moderation queue. The count is computed only inside the short `ended` window.
 *
 * A plain function over the port rather than a use case: three use cases read the same
 * thing, and none of them owns it.
 */
export interface ChallengeReading {
  readonly challenge: Challenge
  readonly state: ChallengeState
  readonly answers: number | null
}

export const readChallenge = async (
  challenges: ChallengeRepository,
  eventId: EventId,
  now: Date,
): Promise<ChallengeReading | null> => {
  const challenge = await challenges.findLatest(eventId)
  if (challenge === null) return null

  const state = challenge.stateAt(now)
  if (state === null) return null
  if (state === 'running') return { challenge, state, answers: null }

  const counted = await challenges.countAnswers(eventId, challenge)
  return { challenge, state, answers: counted > 0 ? counted : null }
}
