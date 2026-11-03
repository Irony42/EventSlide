import { Challenge, hasRoomForChallenge } from '../../domain/challenges/challenge'
import type { Photo } from '../../domain/photos/photo'
import type { EventId } from '../../domain/shared/ids'
import type { ChallengeRepository, StartOutcome } from '../ports/challengeRepository'
import { compareIds } from './ordering'

/**
 * In-memory `ChallengeRepository`, behaving the way the SQLite adapter must.
 *
 * Rows are filtered by event, so a cross-event read genuinely misses. **Answers are derived
 * from the photographs on every call**, never stored: it reads the photo fake, which is what
 * makes "a refused photograph stops counting" true here for the reason it is true in SQLite.
 */

/** The photographs this fake needs; `FakePhotoRepository` satisfies it (visible rows only). */
export interface ChallengePhotoView {
  ofEvent(eventId: EventId): readonly Photo[]
}

export class FakeChallengeRepository implements ChallengeRepository {
  private readonly rows: Challenge[] = []

  constructor(private readonly photos: ChallengePhotoView) {}

  /** Seed fixtures. */
  seed(...challenges: readonly Challenge[]): this {
    this.rows.push(...challenges)
    return this
  }

  private forEvent(eventId: EventId): Challenge[] {
    return this.rows.filter((row) => row.eventId === eventId)
  }

  async tryStart(challenge: Challenge, now: Date): Promise<StartOutcome> {
    const latest = await this.findLatest(challenge.eventId)
    if (latest !== null && latest.isRunning(now)) return 'alreadyRunning'
    if (!hasRoomForChallenge(this.forEvent(challenge.eventId).length)) return 'limitReached'
    this.rows.push(challenge)
    return 'started'
  }

  async findLatest(eventId: EventId): Promise<Challenge | null> {
    const newest = this.forEvent(eventId).sort(
      (left, right) =>
        right.startedAt.getTime() - left.startedAt.getTime() || compareIds(right.id, left.id),
    )
    return newest[0] ?? null
  }

  async save(challenge: Challenge): Promise<void> {
    const at = this.rows.findIndex(
      (row) => row.eventId === challenge.eventId && row.id === challenge.id,
    )
    if (at >= 0) this.rows[at] = challenge
  }

  async countAnswers(eventId: EventId, challenge: Challenge): Promise<number> {
    if (challenge.missionId === null) return 0
    const { from, to } = challenge.answerWindow()
    return this.photos
      .ofEvent(eventId)
      .filter(
        (photo) =>
          photo.status === 'published' &&
          photo.missionId === challenge.missionId &&
          photo.createdAt.getTime() >= from.getTime() &&
          photo.createdAt.getTime() <= to.getTime(),
      ).length
  }
}
