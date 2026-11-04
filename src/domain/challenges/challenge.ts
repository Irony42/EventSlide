import { DomainError } from '../shared/errors'
import type { ChallengeId, EventId, MissionId, UserId } from '../shared/ids'
import { err, ok, type Result } from '../shared/result'
import type { MissionPrompt } from '../missions/missionPrompt'

/**
 * A timed photo challenge (spec 10): one mission and a window of time, launched by a host.
 *
 * It does not invent a new kind of prompt. It is the host's existing mission, plus the one
 * thing a mission lacks, which is a **moment**: a start and an end the whole room can see
 * counting down. The prompt is copied into the row, so correcting the mission afterwards
 * cannot change a sentence two hundred people are reading off a projector.
 *
 * **Time is derived, never ticked.** A challenge is running while `now < endsAt` and nobody
 * stopped it. Nothing on the server fires when it ends: no timer, no job, no write. That is
 * what lets a restart in the middle of a challenge change nothing, and what lets the wall and
 * a phone read the same answer from the same two instants.
 */

/** The shortest and the longest a challenge may run. The interface offers 1, 2, 5 and 10 minutes. */
export const MIN_CHALLENGE_SECONDS = 15
export const MAX_CHALLENGE_SECONDS = 30 * 60

/** The history ceiling. A compromised moderator account must not be able to grow the table. */
export const MAX_CHALLENGES_PER_EVENT = 50

/** How long a finished challenge stays readable ("Défi terminé · 3 photos"), then it is gone. */
export const ENDED_VISIBLE_MS = 20_000

/**
 * How long after the end a photograph still answers the challenge. A phone on poor venue Wi-Fi
 * sends its photograph late; `created_at` is the server's receipt, not the phone's clock.
 */
export const ANSWER_TOLERANCE_MS = 60_000

/** Whether an event holding `existing` challenges may take one more. */
export const hasRoomForChallenge = (existing: number): boolean =>
  existing < MAX_CHALLENGES_PER_EVENT

/** Whole seconds, within the bounds. Anything else is a `400`, never clamped. */
export const parseChallengeDuration = (raw: unknown): Result<number, DomainError> =>
  typeof raw === 'number' &&
  Number.isInteger(raw) &&
  raw >= MIN_CHALLENGE_SECONDS &&
  raw <= MAX_CHALLENGE_SECONDS
    ? ok(raw)
    : err(
        DomainError.invalid('challenge.durationInvalid', {
          min: MIN_CHALLENGE_SECONDS,
          max: MAX_CHALLENGE_SECONDS,
        }),
      )

export type ChallengeState = 'running' | 'ended'

export interface ChallengeProps {
  readonly id: ChallengeId
  readonly eventId: EventId
  /** Null once the mission is deleted (the row outlives it, and is stopped by that deletion). */
  readonly missionId: MissionId | null
  /** The frozen copy of the prompt, as the room reads it. */
  readonly prompt: MissionPrompt
  readonly startedAt: Date
  readonly endsAt: Date
  /** Set when a host stopped it early. */
  readonly endedAt: Date | null
  /** A host account, never a guest. */
  readonly createdBy: UserId | null
}

export interface NewChallenge {
  readonly eventId: EventId
  readonly missionId: MissionId
  readonly prompt: MissionPrompt
  readonly durationSeconds: unknown
  readonly createdBy: UserId
}

export class Challenge {
  private constructor(private readonly props: ChallengeProps) {}

  static start(input: NewChallenge, id: ChallengeId, now: Date): Result<Challenge, DomainError> {
    const duration = parseChallengeDuration(input.durationSeconds)
    if (!duration.ok) return duration

    return ok(
      new Challenge({
        id,
        eventId: input.eventId,
        missionId: input.missionId,
        prompt: input.prompt,
        startedAt: now,
        endsAt: new Date(now.getTime() + duration.value * 1000),
        endedAt: null,
        createdBy: input.createdBy,
      }),
    )
  }

  /** Rehydrate from storage. See `Photo.restore` for why this trusts the row. */
  static restore(props: ChallengeProps): Challenge {
    return new Challenge(props)
  }

  get id(): ChallengeId {
    return this.props.id
  }
  get eventId(): EventId {
    return this.props.eventId
  }
  get missionId(): MissionId | null {
    return this.props.missionId
  }
  get prompt(): MissionPrompt {
    return this.props.prompt
  }
  get startedAt(): Date {
    return this.props.startedAt
  }
  get endsAt(): Date {
    return this.props.endsAt
  }
  get endedAt(): Date | null {
    return this.props.endedAt
  }

  /** Running until the end instant, which is itself already over (`<`, not `≤`). */
  isRunning(now: Date): boolean {
    return this.props.endedAt === null && now.getTime() < this.props.endsAt.getTime()
  }

  /** The instant it really stopped: the host's stop if it came first, otherwise its end. */
  private get stoppedAtMs(): number {
    const stop = this.props.endedAt?.getTime() ?? Infinity
    return Math.min(stop, this.props.endsAt.getTime())
  }

  /**
   * What a reader is shown: `running`, then `ended` for {@link ENDED_VISIBLE_MS}, then nothing.
   * The same answer for the wall and for a phone, from the same two instants.
   */
  stateAt(now: Date): ChallengeState | null {
    if (this.isRunning(now)) return 'running'
    return now.getTime() < this.stoppedAtMs + ENDED_VISIBLE_MS ? 'ended' : null
  }

  /**
   * A host stops it. Idempotent: stopping a challenge that is already over returns it as it
   * was, so the instant it ended is never moved.
   */
  stop(now: Date): Challenge {
    if (!this.isRunning(now)) return this
    return new Challenge({ ...this.props, endedAt: now })
  }

  /**
   * The span in which a photograph answers it: from the start to a minute after the stop
   * (the tolerance for a late upload). Both bounds are inclusive.
   */
  answerWindow(): { readonly from: Date; readonly to: Date } {
    return {
      from: this.props.startedAt,
      to: new Date(this.stoppedAtMs + ANSWER_TOLERANCE_MS),
    }
  }

  toProps(): ChallengeProps {
    return this.props
  }
}
