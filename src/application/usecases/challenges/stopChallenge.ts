import { DomainError } from '../../../domain/shared/errors'
import type { EventId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { ChallengeRepository } from '../../ports/challengeRepository'
import type { Clock } from '../../ports/clock'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import type { MembershipRepository } from '../../ports/userRepository'
import { requireEventRole, requireWritable } from '../shared/eventRole'

/**
 * A host stops the running challenge before its end (spec 10).
 *
 * **Idempotent**: with nothing running it answers success and publishes nothing, because
 * nothing changed. A double tap, or two moderators stopping together, is one stop. The
 * instant of the first stop is kept (`Challenge.stop`).
 *
 * It is allowed on an event that is no longer live: the host who closed the evening with a
 * challenge still counting down must be able to take it off the wall.
 */

export interface StopChallengeInput {
  readonly eventId: EventId
  readonly actorId: UserId
}

export interface StopChallengeDeps {
  readonly events: EventRepository
  readonly challenges: ChallengeRepository
  readonly memberships: MembershipRepository
  readonly bus: EventBus
  readonly clock: Clock
}

export type StopChallenge = (input: StopChallengeInput) => Promise<Result<void, DomainError>>

export const makeStopChallenge =
  ({ events, challenges, memberships, bus, clock }: StopChallengeDeps): StopChallenge =>
  async ({ eventId, actorId }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))

    const allowed = await requireEventRole(memberships, eventId, actorId, 'moderate')
    if (!allowed.ok) return allowed

    const writable = requireWritable(event)
    if (!writable.ok) return writable

    const now = clock.now()
    const latest = await challenges.findLatest(eventId)
    if (latest === null || !latest.isRunning(now)) return ok(undefined)

    await challenges.save(latest.stop(now))
    bus.publish({ type: 'challenge.changed', eventId })
    return ok(undefined)
  }
