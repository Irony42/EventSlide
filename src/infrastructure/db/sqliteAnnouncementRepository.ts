import { Announcement } from '../../domain/announcements/announcement'
import { AnnouncementText } from '../../domain/announcements/announcementText'
import {
  hasRoomForAnnouncement,
  type AnnouncementKind,
} from '../../domain/announcements/announcementRules'
import { announcementsOverlap } from '../../domain/announcements/announcementSchedule'
import {
  asAnnouncementId,
  asEventId,
  asUserId,
  type AnnouncementId,
  type EventId,
} from '../../domain/shared/ids'
import type {
  AnnouncementRepository,
  CreateAnnouncementOutcome,
  SaveAnnouncementOutcome,
} from '../../application/ports/announcementRepository'
import type { Db } from './connection'
import { fromIsoText, toIsoText } from './rowMapping'

/**
 * `event_announcements` (spec 21).
 *
 * **Every statement names `event_id`.** The two rules that cannot be an index, the ceiling and
 * "two of a kind never overlap", are held in one synchronous transaction (read the event's rows,
 * then write), the pattern of `SqliteChallengeRepository.tryStart`, with the domain's own
 * comparisons so each rule is written once.
 */

const COLUMNS = `id, event_id, text, at, kind, duration_seconds, countdown_seconds, created_by,
                 created_at`

/**
 * The wall's read, exported so the test that holds it to the `(event_id, at)` index runs the very
 * statement the adapter does.
 */
export const LIST_AROUND_SQL = `SELECT ${COLUMNS} FROM event_announcements
          WHERE event_id = ? AND at >= ?
          ORDER BY at, id
          LIMIT ?`

interface AnnouncementRow {
  readonly id: string
  readonly event_id: string
  readonly text: string
  readonly at: string
  readonly kind: AnnouncementKind
  readonly duration_seconds: number
  readonly countdown_seconds: number
  readonly created_by: string | null
  readonly created_at: string
}

const toAnnouncement = (row: AnnouncementRow): Announcement => {
  const text = AnnouncementText.create(row.text)
  // A stored text that no longer parses is a corrupt row: the wall must not render whatever the
  // column holds.
  if (!text.ok) {
    throw new Error(`event_announcements row ${row.id} has a text the domain refuses; corrupt`)
  }
  return Announcement.restore({
    id: asAnnouncementId(row.id),
    eventId: asEventId(row.event_id),
    text: text.value,
    kind: row.kind,
    at: fromIsoText(row.at),
    durationSeconds: row.duration_seconds,
    countdownSeconds: row.countdown_seconds,
    createdBy: row.created_by === null ? null : asUserId(row.created_by),
    createdAt: fromIsoText(row.created_at),
  })
}

const toParams = (announcement: Announcement): Record<string, string | number | null> => {
  const props = announcement.toProps()
  return {
    id: props.id,
    event_id: props.eventId,
    text: props.text.value,
    at: toIsoText(props.at),
    kind: props.kind,
    duration_seconds: props.durationSeconds,
    countdown_seconds: props.countdownSeconds,
    created_by: props.createdBy,
    created_at: toIsoText(props.createdAt),
  }
}

export class SqliteAnnouncementRepository implements AnnouncementRepository {
  constructor(private readonly db: Db) {}

  private rowsOf(eventId: EventId): Announcement[] {
    return this.db
      .prepare<[string], AnnouncementRow>(
        `SELECT ${COLUMNS} FROM event_announcements
          WHERE event_id = ?
          ORDER BY at, id`,
      )
      .all(eventId)
      .map(toAnnouncement)
  }

  async listByEvent(eventId: EventId): Promise<readonly Announcement[]> {
    return this.rowsOf(eventId)
  }

  async findById(eventId: EventId, id: AnnouncementId): Promise<Announcement | null> {
    const row = this.db
      .prepare<[string, string], AnnouncementRow>(
        `SELECT ${COLUMNS} FROM event_announcements WHERE event_id = ? AND id = ?`,
      )
      .get(eventId, id)
    return row === undefined ? null : toAnnouncement(row)
  }

  async listAround(eventId: EventId, from: Date, limit: number): Promise<readonly Announcement[]> {
    return this.db
      .prepare<[string, string, number], AnnouncementRow>(LIST_AROUND_SQL)
      .all(eventId, toIsoText(from), limit)
      .map(toAnnouncement)
  }

  async tryCreate(
    announcement: Announcement,
    ceiling: number,
  ): Promise<CreateAnnouncementOutcome> {
    // Synchronous driver: nothing can run between the reads and the insert, and the transaction
    // keeps it that way if the driver ever changes.
    return this.db
      .transaction((): CreateAnnouncementOutcome => {
        const held = this.rowsOf(announcement.eventId)
        if (!hasRoomForAnnouncement(held.length, ceiling)) return 'limitReached'
        if (held.some((row) => announcementsOverlap(row, announcement))) return 'overlap'

        this.db
          .prepare(
            `INSERT INTO event_announcements (${COLUMNS})
                  VALUES (@id, @event_id, @text, @at, @kind, @duration_seconds,
                          @countdown_seconds, @created_by, @created_at)`,
          )
          .run(toParams(announcement))
        return 'created'
      })
      .immediate()
  }

  async trySave(announcement: Announcement): Promise<SaveAnnouncementOutcome> {
    return this.db
      .transaction((): SaveAnnouncementOutcome => {
        const held = this.rowsOf(announcement.eventId)
        if (!held.some((row) => row.id === announcement.id)) return 'notFound'
        if (
          held.some((row) => row.id !== announcement.id && announcementsOverlap(row, announcement))
        ) {
          return 'overlap'
        }

        this.db
          .prepare(
            `UPDATE event_announcements
                SET text = @text, at = @at, kind = @kind, duration_seconds = @duration_seconds,
                    countdown_seconds = @countdown_seconds
              WHERE id = @id AND event_id = @event_id`,
          )
          .run(toParams(announcement))
        return 'saved'
      })
      .immediate()
  }

  async delete(eventId: EventId, id: AnnouncementId): Promise<boolean> {
    const result = this.db
      .prepare<[string, string]>(`DELETE FROM event_announcements WHERE id = ? AND event_id = ?`)
      .run(id, eventId)
    return result.changes > 0
  }
}
