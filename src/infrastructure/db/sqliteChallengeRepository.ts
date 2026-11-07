import { Challenge, hasRoomForChallenge } from '../../domain/challenges/challenge'
import { MissionPrompt } from '../../domain/missions/missionPrompt'
import {
  asChallengeId,
  asEventId,
  asMissionId,
  asUserId,
  type EventId,
} from '../../domain/shared/ids'
import type { ChallengeRepository, StartOutcome } from '../../application/ports/challengeRepository'
import type { Db } from './connection'
import { fromIsoText, fromNullableIsoText, toIsoText } from './rowMapping'

/**
 * `event_challenges`, plus the one read that turns photographs into a final count.
 *
 * **Every statement names `event_id`.** And **the answer count is a query, not a column**:
 * it counts published, not-taken-down photographs that name the challenge (`challenge_id`, set
 * at the upload, migration 026), on every call, so a refusal takes effect with nothing to undo.
 */

const COLUMNS = `id, event_id, mission_id, prompt, started_at, ends_at, ended_at, created_by`

interface ChallengeRow {
  readonly id: string
  readonly event_id: string
  readonly mission_id: string | null
  readonly prompt: string
  readonly started_at: string
  readonly ends_at: string
  readonly ended_at: string | null
  readonly created_by: string | null
}

const toChallenge = (row: ChallengeRow): Challenge => {
  const prompt = MissionPrompt.create(row.prompt)
  // A stored prompt that no longer parses is a corrupt row: the wall must not render whatever
  // the column holds.
  if (!prompt.ok) {
    throw new Error(`event_challenges row ${row.id} has a prompt the domain refuses; corrupt`)
  }
  return Challenge.restore({
    id: asChallengeId(row.id),
    eventId: asEventId(row.event_id),
    missionId: row.mission_id === null ? null : asMissionId(row.mission_id),
    prompt: prompt.value,
    startedAt: fromIsoText(row.started_at),
    endsAt: fromIsoText(row.ends_at),
    endedAt: fromNullableIsoText(row.ended_at),
    createdBy: row.created_by === null ? null : asUserId(row.created_by),
  })
}

export class SqliteChallengeRepository implements ChallengeRepository {
  constructor(private readonly db: Db) {}

  async tryStart(challenge: Challenge, now: Date): Promise<StartOutcome> {
    const props = challenge.toProps()
    // Synchronous driver: nothing can run between the reads and the insert, and the
    // transaction keeps it that way if the driver ever changes.
    return this.db
      .transaction((): StartOutcome => {
        const latest = this.latestRow(props.eventId)
        if (latest !== undefined && toChallenge(latest).isRunning(now)) return 'alreadyRunning'

        const held = this.db
          .prepare<[string], { readonly n: number }>(
            `SELECT COUNT(*) AS n FROM event_challenges WHERE event_id = ?`,
          )
          .get(props.eventId)
        if (!hasRoomForChallenge(held?.n ?? 0)) return 'limitReached'

        this.db
          .prepare(
            `INSERT INTO event_challenges (${COLUMNS})
                VALUES (@id, @event_id, @mission_id, @prompt, @started_at, @ends_at, @ended_at,
                        @created_by)`,
          )
          .run({
            id: props.id,
            event_id: props.eventId,
            mission_id: props.missionId,
            prompt: props.prompt.value,
            started_at: toIsoText(props.startedAt),
            ends_at: toIsoText(props.endsAt),
            ended_at: null,
            created_by: props.createdBy,
          })
        return 'started'
      })
      .immediate()
  }

  private latestRow(eventId: EventId): ChallengeRow | undefined {
    return this.db
      .prepare<[string], ChallengeRow>(
        `SELECT ${COLUMNS} FROM event_challenges
          WHERE event_id = ?
          ORDER BY started_at DESC, id DESC
          LIMIT 1`,
      )
      .get(eventId)
  }

  async findLatest(eventId: EventId): Promise<Challenge | null> {
    const row = this.latestRow(eventId)
    return row === undefined ? null : toChallenge(row)
  }

  async save(challenge: Challenge): Promise<void> {
    const props = challenge.toProps()
    this.db
      .prepare<[string | null, string, string]>(
        `UPDATE event_challenges SET ended_at = ? WHERE id = ? AND event_id = ?`,
      )
      .run(props.endedAt === null ? null : toIsoText(props.endedAt), props.id, props.eventId)
  }

  async countAnswers(eventId: EventId, challenge: Challenge): Promise<number> {
    const row = this.db
      .prepare<[string, string], { readonly n: number }>(
        `SELECT COUNT(*) AS n
           FROM photos
          WHERE event_id = ?
            AND challenge_id = ?
            AND status = 'published'
            AND taken_down_at IS NULL`,
      )
      .get(eventId, challenge.id)
    return row?.n ?? 0
  }

  async listPrompts(eventId: EventId): Promise<string[]> {
    // Bounded: fifty challenges is the ceiling of an event, and the domain keeps five.
    return this.db
      .prepare<[string], { readonly prompt: string }>(
        `SELECT prompt FROM event_challenges
          WHERE event_id = ?
          ORDER BY started_at DESC, id DESC
          LIMIT 50`,
      )
      .all(eventId)
      .map((row) => row.prompt)
  }
}
