import type Database from 'better-sqlite3'
import type { EventRepository, EventSummary } from '../../application/ports/eventRepository'
import { Event } from '../../domain/events/event'
import { EventName } from '../../domain/events/eventName'
import {
  EventSettings,
  isModerationMode,
  type EventSettingsProps,
} from '../../domain/events/eventSettings'
import { isEventStatus, type EventStatus } from '../../domain/events/eventStatus'
import type { DomainError } from '../../domain/shared/errors'
import { asEventId, asUserId, type EventId, type UserId } from '../../domain/shared/ids'
import { JoinCode } from '../../domain/shared/joinCode'
import type { Result } from '../../domain/shared/result'
import { Slug } from '../../domain/shared/slug'
import type { Db } from './connection'
import { fromIsoText, fromNullableIsoText, toIsoText } from './rowMapping'

/**
 * `EventRepository` over SQLite.
 *
 * Two unique indexes carry the product's weight here. A duplicate slug points two QR
 * codes at one album; a duplicate join code sends a guest to the wrong party, which is
 * the shape of 1.0's worst defect. Neither is checked in TypeScript first — a
 * check-then-insert races two hosts creating an event in the same second — so `save`
 * lets the index refuse and the use case retries with a fresh code.
 */

interface EventRow {
  readonly id: string
  readonly owner_id: string
  readonly name: string
  readonly slug: string
  readonly join_code: string
  readonly status: string
  readonly settings: string
  readonly quota_bytes: number
  readonly created_at: string
  readonly starts_at: string | null
  readonly closed_at: string | null
  readonly scheduled_open_at: string | null
  readonly scheduled_close_at: string | null
  readonly schedule_discarded_at: string | null
}

/** Named rather than positional: fourteen columns in the right order by luck is no plan. */
interface EventParams {
  readonly id: string
  readonly ownerId: string
  readonly name: string
  readonly slug: string
  readonly joinCode: string
  readonly status: string
  readonly settings: string
  readonly quotaBytes: number
  readonly createdAt: string
  readonly startsAt: string | null
  readonly closedAt: string | null
  readonly scheduledOpenAt: string | null
  readonly scheduledCloseAt: string | null
  readonly scheduleDiscardedAt: string | null
}

interface SummaryRow {
  readonly id: string
  readonly slug: string
  readonly name: string
  readonly status: string
  readonly created_at: string
  readonly photo_count: number
  readonly pending_count: number
  readonly guest_count: number
  readonly used_bytes: number
}

interface PresenceRow {
  readonly present: number
}

const EVENT_COLUMNS = `id, owner_id, name, slug, join_code, status, settings, quota_bytes,
                       created_at, starts_at, closed_at, scheduled_open_at, scheduled_close_at,
                       schedule_discarded_at`

const corrupt = (column: string, detail: string): Error =>
  new Error(`Corrupt events.${column} in the database: ${detail}`)

/**
 * Hydration trusts the row — the values were validated on the way in and the schema's
 * `CHECK` constraints back that up — so a value the domain now refuses means the file
 * was hand-edited or written by another program. Throwing names the column, because
 * the alternative is worse than a crash: a defaulted setting would silently turn a
 * host's "hold every photo until I say so" into auto-publish.
 */
const domainValue = <T>(result: Result<T, DomainError>, column: string, raw: string): T => {
  if (!result.ok) throw corrupt(column, `${result.error.code} (${raw})`)
  return result.value
}

const statusOf = (raw: string): EventStatus => {
  if (!isEventStatus(raw)) throw corrupt('status', raw)
  return raw
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const settingsBoolean = (value: unknown, field: string): boolean => {
  if (typeof value !== 'boolean') throw corrupt('settings', `${field} is not a boolean`)
  return value
}

const settingsInteger = (value: unknown, field: string): number => {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw corrupt('settings', `${field} is not an integer`)
  }
  return value
}

/** `null` is a real value in this column — "keep forever", "no per-guest limit". */
const settingsNullableInteger = (value: unknown, field: string): number | null =>
  value === null ? null : settingsInteger(value, field)

/**
 * The one exception to "every field is required", and it is the exception a settings
 * blob written as JSON always eventually needs.
 *
 * `allowClips` arrived with migration 003. Every event created before it has a
 * `settings` blob with no such key, and there is no way to backfill one — the column is
 * opaque JSON, so a migration would have to parse and rewrite every row of every album
 * to add a field whose absence already means exactly the default. Refusing those rows
 * would make the upgrade take down every existing wedding; silently defaulting a field a
 * host *did* choose is the failure the strict reading above exists to prevent, and it
 * cannot happen here because no host has ever chosen this one.
 *
 * A field added in a future migration belongs here too, with its own line saying which
 * migration introduced it. A field that has always existed does not.
 */
const settingsBooleanAddedLater = (value: unknown, field: string, fallback: boolean): boolean =>
  value === undefined ? fallback : settingsBoolean(value, field)

const decodeJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw)
  } catch {
    throw corrupt('settings', 'not valid JSON')
  }
}

/**
 * Rebuilds `EventSettings` through its own factory instead of trusting the JSON.
 *
 * Every field is required here even though `EventSettings.create` would default an
 * absent one. A missing key means the stored policy is not the policy the host chose,
 * and defaulting it is how a retention window silently becomes "keep forever".
 */
const settingsOf = (raw: string): EventSettings => {
  const decoded = decodeJson(raw)
  if (!isRecord(decoded)) throw corrupt('settings', 'not a JSON object')

  const moderation = decoded['moderation']
  if (!isModerationMode(moderation)) throw corrupt('settings', 'unknown moderation mode')

  const props: EventSettingsProps = {
    moderation,
    allowCaptions: settingsBoolean(decoded['allowCaptions'], 'allowCaptions'),
    allowReactions: settingsBoolean(decoded['allowReactions'], 'allowReactions'),
    // Added by migration 003; absent on every event created before it. See above.
    allowClips: settingsBooleanAddedLater(decoded['allowClips'], 'allowClips', true),
    allowGuestSelfDelete: settingsBoolean(decoded['allowGuestSelfDelete'], 'allowGuestSelfDelete'),
    guestSelfDeleteGraceSeconds: settingsInteger(
      decoded['guestSelfDeleteGraceSeconds'],
      'guestSelfDeleteGraceSeconds',
    ),
    retentionDays: settingsNullableInteger(decoded['retentionDays'], 'retentionDays'),
    maxPhotosPerGuest: settingsNullableInteger(decoded['maxPhotosPerGuest'], 'maxPhotosPerGuest'),
  }

  const settings = EventSettings.create(props)
  if (!settings.ok) throw corrupt('settings', settings.error.code)
  return settings.value
}

const toEvent = (row: EventRow): Event =>
  Event.restore({
    id: asEventId(row.id),
    ownerId: asUserId(row.owner_id),
    name: domainValue(EventName.create(row.name), 'name', row.name),
    slug: domainValue(Slug.create(row.slug), 'slug', row.slug),
    joinCode: domainValue(JoinCode.create(row.join_code), 'join_code', row.join_code),
    status: statusOf(row.status),
    settings: settingsOf(row.settings),
    quotaBytes: row.quota_bytes,
    createdAt: fromIsoText(row.created_at),
    startsAt: fromNullableIsoText(row.starts_at),
    closedAt: fromNullableIsoText(row.closed_at),
    scheduledOpenAt: fromNullableIsoText(row.scheduled_open_at),
    scheduledCloseAt: fromNullableIsoText(row.scheduled_close_at),
    scheduleDiscardedAt: fromNullableIsoText(row.schedule_discarded_at),
  })

const toSummary = (row: SummaryRow): EventSummary => ({
  id: asEventId(row.id),
  slug: row.slug,
  name: row.name,
  status: statusOf(row.status),
  photoCount: row.photo_count,
  pendingCount: row.pending_count,
  guestCount: row.guest_count,
  usedBytes: row.used_bytes,
  createdAt: fromIsoText(row.created_at),
})

const toParams = (event: Event): EventParams => {
  const props = event.toProps()
  return {
    id: props.id,
    ownerId: props.ownerId,
    name: props.name.value,
    slug: props.slug.value,
    joinCode: props.joinCode.value,
    status: props.status,
    settings: JSON.stringify(props.settings.toProps()),
    quotaBytes: props.quotaBytes,
    createdAt: toIsoText(props.createdAt),
    startsAt: props.startsAt === null ? null : toIsoText(props.startsAt),
    closedAt: props.closedAt === null ? null : toIsoText(props.closedAt),
    scheduledOpenAt: props.scheduledOpenAt === null ? null : toIsoText(props.scheduledOpenAt),
    scheduledCloseAt: props.scheduledCloseAt === null ? null : toIsoText(props.scheduledCloseAt),
    scheduleDiscardedAt:
      props.scheduleDiscardedAt === null ? null : toIsoText(props.scheduleDiscardedAt),
  }
}

export class SqliteEventRepository implements EventRepository {
  private readonly selectById: Database.Statement<[string], EventRow>
  private readonly selectBySlug: Database.Statement<[string], EventRow>
  private readonly selectByJoinCode: Database.Statement<[string], EventRow>
  private readonly selectSummaries: Database.Statement<[string, string], SummaryRow>
  private readonly selectDueForPurge: Database.Statement<[string], EventRow>
  private readonly selectDueForSchedule: Database.Statement<[string, string], EventRow>
  private readonly selectSlug: Database.Statement<[string], PresenceRow>
  private readonly selectJoinCode: Database.Statement<[string], PresenceRow>
  private readonly upsert: Database.Statement<EventParams>
  private readonly deleteById: Database.Statement<[string]>

  /**
   * Statements are prepared once per repository, not per call. `better-sqlite3` caches
   * the compiled plan on the statement object, and the wall re-reads an event on every
   * slide: re-preparing there is a parse per frame for no reason.
   */
  constructor(db: Db) {
    this.selectById = db.prepare<[string], EventRow>(
      `SELECT ${EVENT_COLUMNS} FROM events WHERE id = ?`,
    )

    this.selectBySlug = db.prepare<[string], EventRow>(
      `SELECT ${EVENT_COLUMNS} FROM events WHERE slug = ?`,
    )

    this.selectByJoinCode = db.prepare<[string], EventRow>(
      `SELECT ${EVENT_COLUMNS} FROM events WHERE join_code = ?`,
    )

    // Four correlated subqueries instead of four queries per event: a host with twenty
    // events would otherwise cost eighty round trips to draw one dashboard, which is
    // exactly the lag that makes an admin screen feel broken. Each subquery is served
    // by an index leading with event_id.
    this.selectSummaries = db.prepare<[string, string], SummaryRow>(
      `SELECT e.id, e.slug, e.name, e.status, e.created_at,
              (SELECT COUNT(*) FROM photos p WHERE p.event_id = e.id) AS photo_count,
              (SELECT COUNT(*) FROM photos p
                WHERE p.event_id = e.id AND p.status = 'pending')      AS pending_count,
              (SELECT COUNT(*) FROM guests g WHERE g.event_id = e.id)  AS guest_count,
              (SELECT COALESCE(SUM(p.byte_size), 0) FROM photos p
                WHERE p.event_id = e.id)                               AS used_bytes
         FROM events e
        WHERE e.owner_id = ?
           OR EXISTS (SELECT 1 FROM event_memberships m
                       WHERE m.event_id = e.id AND m.user_id = ?)
        ORDER BY e.created_at DESC, e.id`,
    )

    // The retention deadline is `closed_at + settings.retentionDays`, and retentionDays
    // lives inside the JSON column — so `json_extract` keeps the whole decision in one
    // query. Hydrating every closed event to ask the entity would make the nightly
    // purge scale with the size of the archive rather than with what is actually due.
    //
    // The `%f` format emits `SS.sss`, so the computed deadline is ISO-8601 to the
    // millisecond and compares lexicographically against `now` — the same
    // `now >= deadline` that `Event.isDueForPurge` applies. A null retentionDays means
    // "keep the album forever" and yields no deadline, hence the explicit guard.
    this.selectDueForPurge = db.prepare<[string], EventRow>(
      `SELECT ${EVENT_COLUMNS}
         FROM events
        WHERE status IN ('closed', 'archived')
          AND closed_at IS NOT NULL
          AND json_extract(settings, '$.retentionDays') IS NOT NULL
          AND strftime('%Y-%m-%dT%H:%M:%fZ', closed_at,
                       '+' || json_extract(settings, '$.retentionDays') || ' days') <= ?
        ORDER BY created_at DESC, id`,
    )

    // The scheduling sweep's query, and the one read in this repository that is not
    // scoped to an event: it asks which events, anywhere, are due. `<=` rather than `=`
    // is the point — the sweep that should have run at 18:00 may not have run at all,
    // and the next one has to open the party rather than wait for an instant that has
    // gone. ISO-8601 UTC text compares lexicographically, so this is the same
    // `now >= instant` the entity applies, and both partial indexes added by migration
    // 002 serve it.
    this.selectDueForSchedule = db.prepare<[string, string], EventRow>(
      `SELECT ${EVENT_COLUMNS}
         FROM events
        WHERE (scheduled_open_at  IS NOT NULL AND scheduled_open_at  <= ?)
           OR (scheduled_close_at IS NOT NULL AND scheduled_close_at <= ?)
        ORDER BY created_at DESC, id`,
    )

    this.selectSlug = db.prepare<[string], PresenceRow>(
      `SELECT 1 AS present FROM events WHERE slug = ? LIMIT 1`,
    )

    this.selectJoinCode = db.prepare<[string], PresenceRow>(
      `SELECT 1 AS present FROM events WHERE join_code = ? LIMIT 1`,
    )

    this.upsert = db.prepare<EventParams>(
      `INSERT INTO events (id, owner_id, name, slug, join_code, status, settings,
                           quota_bytes, created_at, starts_at, closed_at,
                           scheduled_open_at, scheduled_close_at, schedule_discarded_at)
            VALUES (@id, @ownerId, @name, @slug, @joinCode, @status, @settings,
                    @quotaBytes, @createdAt, @startsAt, @closedAt,
                    @scheduledOpenAt, @scheduledCloseAt, @scheduleDiscardedAt)
       ON CONFLICT (id) DO UPDATE SET owner_id    = excluded.owner_id,
                                      name        = excluded.name,
                                      slug        = excluded.slug,
                                      join_code   = excluded.join_code,
                                      status      = excluded.status,
                                      settings    = excluded.settings,
                                      quota_bytes = excluded.quota_bytes,
                                      created_at  = excluded.created_at,
                                      starts_at   = excluded.starts_at,
                                      closed_at   = excluded.closed_at,
                                      scheduled_open_at  = excluded.scheduled_open_at,
                                      scheduled_close_at = excluded.scheduled_close_at,
                                      schedule_discarded_at = excluded.schedule_discarded_at`,
    )

    this.deleteById = db.prepare<[string]>(`DELETE FROM events WHERE id = ?`)
  }

  async findById(id: EventId): Promise<Event | null> {
    const row = this.selectById.get(id)
    return row === undefined ? null : toEvent(row)
  }

  async findBySlug(slug: Slug): Promise<Event | null> {
    const row = this.selectBySlug.get(slug.value)
    return row === undefined ? null : toEvent(row)
  }

  async findByJoinCode(code: JoinCode): Promise<Event | null> {
    const row = this.selectByJoinCode.get(code.value)
    return row === undefined ? null : toEvent(row)
  }

  /**
   * Owned or moderated, newest first. A moderator handed a laptop for the evening
   * needs the event on their dashboard, so membership qualifies as well as ownership;
   * ties break on id so two open dashboards agree on the order.
   */
  async listForUser(userId: UserId): Promise<readonly EventSummary[]> {
    return this.selectSummaries.all(userId, userId).map(toSummary)
  }

  /** Insert or update. The unique indexes on slug and join code are the real guard. */
  async save(event: Event): Promise<void> {
    this.upsert.run(toParams(event))
  }

  /**
   * One statement. Photos, guests, reactions and memberships all carry
   * `ON DELETE CASCADE`, so this removes the whole album atomically — provided
   * `foreign_keys = ON`, which `connection.ts` sets per connection and without which
   * SQLite ignores every cascade in the schema.
   *
   * Media files are removed afterwards by the use case: the filesystem is not part of
   * this transaction, and a row pointing at a deleted file is worse than bytes nobody
   * references.
   */
  async delete(id: EventId): Promise<void> {
    this.deleteById.run(id)
  }

  async slugTaken(slug: Slug): Promise<boolean> {
    return this.selectSlug.get(slug.value) !== undefined
  }

  async joinCodeTaken(code: JoinCode): Promise<boolean> {
    return this.selectJoinCode.get(code.value) !== undefined
  }

  async listDueForPurge(now: Date): Promise<readonly Event[]> {
    return this.selectDueForPurge.all(toIsoText(now)).map(toEvent)
  }

  async listDueForSchedule(now: Date): Promise<readonly Event[]> {
    const at = toIsoText(now)
    return this.selectDueForSchedule.all(at, at).map(toEvent)
  }
}
