import { recentPrompts } from '../../../domain/challenges/challenge'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { ChallengeRepository } from '../../ports/challengeRepository'
import type { Clock } from '../../ports/clock'
import type { EventRepository } from '../../ports/eventRepository'
import type { MembershipRepository } from '../../ports/userRepository'
import { requireEventRole, requireReadable } from '../shared/eventRole'
import { readChallenge, type ChallengeReading } from './readChallenge'

/**
 * The host's read of the event's challenge (spec 10): what the console needs to draw "Lancer" or
 * "Arrêter" and the time left. Any member may read it, like the mission list.
 *
 * It carries `serverNowMs` for the reason the wall's response does: a console on a laptop whose
 * clock is three minutes off must still show the same countdown as the projector.
 */

export interface GetChallengeInput {
  readonly eventId: EventId
  readonly actorId: UserId
}

export interface HostChallengeView {
  readonly challenge: ChallengeReading | null
  readonly serverNowMs: number
  /** The texts of the event's past challenges, newest first, once each (spec 18): the host's only. */
  readonly recent: string[]
}

export interface GetChallengeDeps {
  readonly events: EventRepository
  readonly challenges: ChallengeRepository
  readonly memberships: MembershipRepository
  readonly clock: Clock
}

export type GetChallenge = (
  input: GetChallengeInput,
) => Promise<Result<HostChallengeView, DomainError>>

export const makeGetChallenge =
  ({ events, challenges, memberships, clock }: GetChallengeDeps): GetChallenge =>
  async ({ eventId, actorId }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))

    const allowed = await requireEventRole(memberships, eventId, actorId, 'moderate')
    if (!allowed.ok) return allowed

    const readable = requireReadable(event)
    if (!readable.ok) return readable

    const now = clock.now()
    return ok({
      challenge: await readChallenge(challenges, eventId, now),
      serverNowMs: now.getTime(),
      recent: recentPrompts(await challenges.listPrompts(eventId)),
    })
  }
