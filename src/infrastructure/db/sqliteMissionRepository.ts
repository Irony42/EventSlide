import { Mission } from '../../domain/missions/mission'
import type { MissionProgress } from '../../domain/missions/missionProgress'
import { MissionPrompt } from '../../domain/missions/missionPrompt'
import { isMissionScope, type MissionScope } from '../../domain/missions/missionScope'
import {
  asEventId,
  asMissionId,
  type EventId,
  type GuestId,
  type MissionId,
} from '../../domain/shared/ids'
import type {
  MissionRepository,
  MissionWithProgress,
} from '../../application/ports/missionRepository'
import type { Db } from './connection'
import { fromIsoText, toIsoText } from './rowMapping'

/**
 * `event_missions`, plus the one read that turns photographs into progress.
 *
 * Two things are worth reading before changing anything here.
 *
 * **Every statement names `event_id`.** A mission id arrives from a guest's phone on a
 * tagged upload, so this is one of the few tables where an id in a query came from
 * outside the box. A `WHERE id = ?` here would be a route by which a guest at one event
 * could file a photograph against another event's prompt.
 *
 * **Progress is a query, not a column.** `listWithProgress` counts published
 * photographs per mission on every call, which is what makes a moderator's refusal take
 * effect with nothing to undo — see `domain/missions/missionProgress.ts`. The cost is
 * one grouped scan of `idx_photos_event_mission`, which is partial on `mission_id IS NOT
 * NULL` and covering, so it is the size of the tagged photographs rather than of the
 * evening.
 */

const MISSION_COLUMNS = `id, event_id, prompt, scope, created_at`

interface MissionRow {
  readonly id: string
  readonly event_id: string
  readonly prompt: string
  /** Narrowed by the `CHECK` on the column; the mapper still refuses anything else. */
  readonly scope: string
  readonly created_at: string
}

interface ProgressRow {
  readonly mission_id: string
  readonly published_photos: number
  readonly completed_by_guests: number
}

const corruptRow = (id: string, what: string): Error =>
  new Error(`event_missions row ${id} ${what}; the database is corrupt`)

const toScope = (row: MissionRow): MissionScope => {
  if (!isMissionScope(row.scope)) throw corruptRow(row.id, `has an unknown scope (${row.scope})`)
  return row.scope
}

const toMission = (row: MissionRow): Mission => {
  const prompt = MissionPrompt.create(row.prompt)
  // A stored prompt that no longer parses is a corrupt row rather than a host error, and
  // it is worth failing on: the alternative is a projector rendering whatever the column
  // holds, which is the one surface where being wrong costs the room its evening.
  if (!prompt.ok) throw corruptRow(row.id, `has a prompt the domain refuses (${prompt.error.code})`)

  return Mission.restore({
    id: asMissionId(row.id),
    eventId: asEventId(row.event_id),
    prompt: prompt.value,
    scope: toScope(row),
    createdAt: fromIsoText(row.created_at),
  })
}

const NO_PROGRESS: MissionProgress = { publishedPhotos: 0, completedByGuests: 0 }

export class SqliteMissionRepository implements MissionRepository {
  constructor(private readonly db: Db) {}

  async findById(eventId: EventId, missionId: MissionId): Promise<Mission | null> {
    const row = this.db
      .prepare<[string, string], MissionRow>(
        `SELECT ${MISSION_COLUMNS} FROM event_missions WHERE event_id = ? AND id = ?`,
      )
      .get(eventId, missionId)
    return row === undefined ? null : toMission(row)
  }

  async findByPrompt(eventId: EventId, prompt: MissionPrompt): Promise<Mission | null> {
    const row = this.db
      .prepare<[string, string], MissionRow>(
        `SELECT ${MISSION_COLUMNS} FROM event_missions WHERE event_id = ? AND prompt = ?`,
      )
      .get(eventId, prompt.value)
    return row === undefined ? null : toMission(row)
  }

  async listWithProgress(eventId: EventId): Promise<readonly MissionWithProgress[]> {
    // Two statements rather than one `LEFT JOIN … GROUP BY`, deliberately. The join
    // would make the mission list's ordering depend on the aggregate's plan, and it
    // would read the covering index for missions that nothing names at all. Both run on
    // one synchronous connection with nothing able to interleave between them, so there
    // is no window in which the two answers could be about different states.
    const missions = this.db
      .prepare<[string], MissionRow>(
        `SELECT ${MISSION_COLUMNS}
           FROM event_missions
          WHERE event_id = ?
          ORDER BY created_at ASC, id ASC`,
      )
      .all(eventId)

    if (missions.length === 0) return []

    const counts = this.db
      .prepare<[string], ProgressRow>(
        `SELECT mission_id                        AS mission_id,
                COUNT(*)                          AS published_photos,
                COUNT(DISTINCT author_guest_id)   AS completed_by_guests
           FROM photos
          WHERE event_id = ?
            AND mission_id IS NOT NULL
            AND status = 'published'
          GROUP BY mission_id`,
      )
      .all(eventId)

    const byMission = new Map<string, MissionProgress>(
      counts.map((row) => [
        row.mission_id,
        {
          publishedPhotos: row.published_photos,
          // `COUNT(DISTINCT author_guest_id)` ignores NULLs, which is exactly the rule:
          // a host's own upload answers the prompt for the room and belongs to no
          // guest's tally.
          completedByGuests: row.completed_by_guests,
        },
      ]),
    )

    return missions.map((row) => ({
      mission: toMission(row),
      progress: byMission.get(row.id) ?? NO_PROGRESS,
    }))
  }

  async completedByGuest(eventId: EventId, guestId: GuestId): Promise<ReadonlySet<MissionId>> {
    const rows = this.db
      .prepare<[string, string], { readonly mission_id: string }>(
        `SELECT DISTINCT mission_id
           FROM photos
          WHERE event_id = ?
            AND author_guest_id = ?
            AND mission_id IS NOT NULL
            AND status = 'published'`,
      )
      .all(eventId, guestId)

    return new Set(rows.map((row) => asMissionId(row.mission_id)))
  }

  async count(eventId: EventId): Promise<number> {
    const row = this.db
      .prepare<[string], { readonly n: number }>(
        `SELECT COUNT(*) AS n FROM event_missions WHERE event_id = ?`,
      )
      .get(eventId)
    return row?.n ?? 0
  }

  async save(mission: Mission): Promise<void> {
    const props = mission.toProps()
    const bindings = {
      id: props.id,
      event_id: props.eventId,
      prompt: props.prompt.value,
      scope: props.scope,
      created_at: toIsoText(props.createdAt),
    }

    const update = this.db.prepare<typeof bindings>(
      `UPDATE event_missions
          SET prompt = @prompt, scope = @scope
        WHERE id = @id AND event_id = @event_id`,
    )
    const insert = this.db.prepare<typeof bindings>(
      `INSERT INTO event_missions (${MISSION_COLUMNS})
            VALUES (@id, @event_id, @prompt, @scope, @created_at)`,
    )

    // Update first, insert only if it matched nothing — the shape `SqlitePhotoRepository`
    // already uses. `created_at` is deliberately not in the update: a corrected prompt is
    // the same row and must keep its place in the host's order.
    this.db.transaction(() => {
      if (update.run(bindings).changes === 0) insert.run(bindings)
    })()
  }

  async delete(eventId: EventId, missionId: MissionId): Promise<void> {
    // The photographs are unfiled by `ON DELETE SET NULL` inside this same statement, so
    // there is no moment at which a row points at a mission that is already gone — and
    // no photograph is removed. See migration 005 for why that is `SET NULL` and not
    // `CASCADE`.
    this.db
      .prepare<[string, string]>(`DELETE FROM event_missions WHERE event_id = ? AND id = ?`)
      .run(eventId, missionId)
  }
}
