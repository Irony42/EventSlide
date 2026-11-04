import { Challenge } from '../../../domain/challenges/challenge'
import { MissionPrompt } from '../../../domain/missions/missionPrompt'
import { DomainError } from '../../../domain/shared/errors'
import type { EventId, MissionId, UserId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { ChallengeRepository } from '../../ports/challengeRepository'
import type { Clock } from '../../ports/clock'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import type { IdGenerator } from '../../ports/idGenerator'
import type { MissionRepository } from '../../ports/missionRepository'
import type { MembershipRepository } from '../../ports/userRepository'
import { requireEventRole, requireWritable } from '../shared/eventRole'

/**
 * A host launches one of the event's missions as a timed challenge (spec 10).
 *
 * **Any moderator may**, unlike writing a mission (owner only): the person at the evening
 * with a laptop is usually the moderator, and a challenge writes no new sentence, it only
 * says when. The sentence is the mission's, copied into the challenge so correcting the
 * mission later cannot change what the room is reading.
 *
 * Three `409`s, each a different thing for the host to do: the event is not live (nobody
 * can answer), a challenge is already running (stop it first: there is no silent
 * replacement), and the history is full (fifty, a ceiling against a compromised account).
 * The last two are decided by the repository in one step, so two moderators tapping at once
 * cannot both win.
 *
 * **It does not touch moderation.** A photograph that answers the challenge waits for the
 * host's decision like any other.
 */

export interface StartChallengeInput {
  readonly eventId: EventId
  readonly actorId: UserId
  /** The challenge's own text (spec 18), typed by the host; the mission's when absent. */
  readonly prompt?: unknown
  /** Optional: a mission the text may come from (and which a photograph is then also filed under). */
  readonly missionId?: MissionId | null
  /** Whole seconds, 15 to 1800; the domain decides. */
  readonly durationSeconds: unknown
}

export interface StartChallengeDeps {
  readonly events: EventRepository
  readonly missions: MissionRepository
  readonly challenges: ChallengeRepository
  readonly memberships: MembershipRepository
  readonly ids: IdGenerator
  readonly bus: EventBus
  readonly clock: Clock
}

export type StartChallenge = (input: StartChallengeInput) => Promise<Result<Challenge, DomainError>>

export const makeStartChallenge =
  ({
    events,
    missions,
    challenges,
    memberships,
    ids,
    bus,
    clock,
  }: StartChallengeDeps): StartChallenge =>
  async ({ eventId, actorId, prompt: typed, missionId, durationSeconds }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))

    const allowed = await requireEventRole(memberships, eventId, actorId, 'moderate')
    if (!allowed.ok) return allowed

    const writable = requireWritable(event)
    if (!writable.ok) return writable

    // A paused, closed or archived event has nobody to answer: refused, not parked.
    if (!event.acceptsGuests()) return err(DomainError.conflict('challenge.eventNotOpen'))

    // Scoped read: a mission id of another event is a `404`, never a stranger's prompt.
    const mission =
      missionId === undefined || missionId === null
        ? null
        : await missions.findById(eventId, missionId)
    if (missionId !== undefined && missionId !== null && mission === null) {
      return err(DomainError.notFound('mission.notFound'))
    }

    // The text the host typed wins; a mission alone lends its own (the spec 10 body). Never both
    // absent: a challenge says something to the room.
    let prompt: MissionPrompt
    if (typed === undefined || typed === null) {
      if (mission === null) return err(DomainError.invalid('mission.promptEmpty'))
      prompt = mission.prompt
    } else {
      const parsed = MissionPrompt.create(typed)
      if (!parsed.ok) return parsed
      prompt = parsed.value
    }

    const now = clock.now()
    const started = Challenge.start(
      { eventId, missionId: mission?.id ?? null, prompt, durationSeconds, createdBy: actorId },
      ids.challengeId(),
      now,
    )
    if (!started.ok) return started

    const outcome = await challenges.tryStart(started.value, now)
    if (outcome === 'alreadyRunning') return err(DomainError.conflict('challenge.alreadyRunning'))
    if (outcome === 'limitReached') return err(DomainError.conflict('challenge.limit'))

    // The wall is showing nothing of it yet: the signal carries no data and every reader refetches.
    bus.publish({ type: 'challenge.changed', eventId })
    return ok(started.value)
  }
