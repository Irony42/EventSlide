import type { AlbumExportRepository } from '../../application/ports/albumExportRepository'
import {
  finishOfExport,
  invalidateExport,
  serveExport,
  settleExport,
  startExport,
  type AlbumExport,
  type ExportFinish,
  type ExportVerdict,
} from '../../domain/exports/albumExport'
import {
  isExportFailureCode,
  isExportStaleReason,
  isExportStatus,
  type ExportStaleReason,
} from '../../domain/exports/albumExportStatus'
import { asEventId, asUserId, type EventId } from '../../domain/shared/ids'
import type { Db } from './connection'
import { fromIsoText, fromNullableIsoText, toIsoText } from './rowMapping'

/**
 * `AlbumExportRepository` over SQLite.
 *
 * `claimNext`, `finish`, `invalidate` and `markServed` read, decide with the domain function and
 * write inside one `.immediate()` transaction, as `SqliteAlbumBookRepository` does: no second
 * connection can commit between the read and the write.
 */

interface ExportRow {
  readonly event_id: string
  readonly status: string
  readonly requested_at: string
  readonly requested_by: string | null
  readonly started_at: string | null
  readonly sealed_at: string | null
  readonly expires_at: string | null
  readonly entries: number | null
  readonly skipped: number | null
  readonly bytes: number | null
  readonly sha256: string | null
  readonly served_at: string | null
  readonly stale_reason: string | null
  readonly invalidated_at: string | null
  readonly failure: string | null
}

const COLUMNS = `event_id, status, requested_at, requested_by, started_at, sealed_at, expires_at,
  entries, skipped, bytes, sha256, served_at, stale_reason, invalidated_at, failure`

const corrupt = (field: string): Error => new Error(`event_exports row has an unreadable ${field}`)

const toExport = (row: ExportRow): AlbumExport => {
  if (!isExportStatus(row.status)) throw corrupt('status')
  if (row.failure !== null && !isExportFailureCode(row.failure)) throw corrupt('failure')
  if (row.stale_reason !== null && !isExportStaleReason(row.stale_reason)) {
    throw corrupt('stale_reason')
  }
  return {
    eventId: asEventId(row.event_id),
    status: row.status,
    requestedAt: fromIsoText(row.requested_at),
    requestedBy: row.requested_by === null ? null : asUserId(row.requested_by),
    startedAt: fromNullableIsoText(row.started_at),
    sealedAt: fromNullableIsoText(row.sealed_at),
    expiresAt: fromNullableIsoText(row.expires_at),
    entries: row.entries,
    skipped: row.skipped,
    bytes: row.bytes,
    sha256: row.sha256,
    servedAt: fromNullableIsoText(row.served_at),
    staleReason: row.stale_reason,
    invalidatedAt: fromNullableIsoText(row.invalidated_at),
    failure: row.failure,
  }
}

const nullableIso = (date: Date | null): string | null => (date === null ? null : toIsoText(date))

const toParams = (archive: AlbumExport): Record<string, string | number | null> => ({
  event_id: archive.eventId,
  status: archive.status,
  requested_at: toIsoText(archive.requestedAt),
  requested_by: archive.requestedBy,
  started_at: nullableIso(archive.startedAt),
  sealed_at: nullableIso(archive.sealedAt),
  expires_at: nullableIso(archive.expiresAt),
  entries: archive.entries,
  skipped: archive.skipped,
  bytes: archive.bytes,
  sha256: archive.sha256,
  served_at: nullableIso(archive.servedAt),
  stale_reason: archive.staleReason,
  invalidated_at: nullableIso(archive.invalidatedAt),
  failure: archive.failure,
})

const UPSERT = `
  INSERT INTO event_exports (${COLUMNS})
  VALUES (@event_id, @status, @requested_at, @requested_by, @started_at, @sealed_at, @expires_at,
          @entries, @skipped, @bytes, @sha256, @served_at, @stale_reason, @invalidated_at, @failure)
  ON CONFLICT (event_id) DO UPDATE SET
    status = excluded.status, requested_at = excluded.requested_at,
    requested_by = excluded.requested_by, started_at = excluded.started_at,
    sealed_at = excluded.sealed_at, expires_at = excluded.expires_at, entries = excluded.entries,
    skipped = excluded.skipped, bytes = excluded.bytes, sha256 = excluded.sha256,
    served_at = excluded.served_at, stale_reason = excluded.stale_reason,
    invalidated_at = excluded.invalidated_at, failure = excluded.failure
`

const UPDATE = `
  UPDATE event_exports SET
    status = @status, requested_at = @requested_at, requested_by = @requested_by,
    started_at = @started_at, sealed_at = @sealed_at, expires_at = @expires_at,
    entries = @entries, skipped = @skipped, bytes = @bytes, sha256 = @sha256,
    served_at = @served_at, stale_reason = @stale_reason, invalidated_at = @invalidated_at,
    failure = @failure
  WHERE event_id = @event_id
`

export class SqliteAlbumExportRepository implements AlbumExportRepository {
  constructor(private readonly db: Db) {}

  private read(eventId: string): AlbumExport | null {
    const row = this.db
      .prepare<[string], ExportRow>(`SELECT ${COLUMNS} FROM event_exports WHERE event_id = ?`)
      .get(eventId)
    return row === undefined ? null : toExport(row)
  }

  private write(archive: AlbumExport): void {
    this.db.prepare(UPDATE).run(toParams(archive))
  }

  async find(eventId: EventId): Promise<AlbumExport | null> {
    return this.read(eventId)
  }

  async request(archive: AlbumExport): Promise<void> {
    this.db
      .transaction(() => {
        this.db.prepare(UPSERT).run(toParams(archive))
        this.db
          .prepare<[string, string]>(
            `INSERT INTO event_export_requests (event_id, requested_at) VALUES (?, ?)`,
          )
          .run(archive.eventId, toIsoText(archive.requestedAt))
      })
      .immediate()
  }

  async claimNext(now: Date): Promise<AlbumExport | null> {
    return this.db
      .transaction((): AlbumExport | null => {
        const row = this.db
          .prepare<[], ExportRow>(
            `SELECT ${COLUMNS} FROM event_exports WHERE status = 'queued'
              ORDER BY requested_at ASC, event_id ASC LIMIT 1`,
          )
          .get()
        if (row === undefined) return null
        const started = startExport(toExport(row), now)
        if (!started.ok) return null
        this.write(started.value)
        return started.value
      })
      .immediate()
  }

  async finish(eventId: EventId, verdict: ExportVerdict, now: Date): Promise<ExportFinish> {
    return this.db
      .transaction((): ExportFinish => {
        const archive = this.read(eventId)
        if (archive === null) return 'superseded'
        const settled = settleExport(archive, verdict, now)
        if (!settled.ok) return 'superseded'
        this.write(settled.value)
        return finishOfExport(settled.value)
      })
      .immediate()
  }

  async invalidate(
    eventId: EventId,
    reason: ExportStaleReason,
    now: Date,
  ): Promise<AlbumExport | null> {
    return this.db
      .transaction((): AlbumExport | null => {
        const archive = this.read(eventId)
        if (archive === null) return null
        const next = invalidateExport(archive, reason, now)
        if (next !== archive) this.write(next)
        return next
      })
      .immediate()
  }

  async markServed(eventId: EventId, at: Date, expiresAt: Date): Promise<boolean> {
    return this.db
      .transaction((): boolean => {
        const archive = this.read(eventId)
        if (archive === null) return false
        const served = serveExport(archive, at, expiresAt)
        if (!served.ok) return false
        this.write(served.value)
        return true
      })
      .immediate()
  }

  async recoverRunning(): Promise<number> {
    return this.db
      .prepare(
        `UPDATE event_exports SET status = 'queued', started_at = NULL WHERE status = 'running'`,
      )
      .run().changes
  }

  async countRequestsSince(eventId: EventId, since: Date): Promise<number> {
    const row = this.db
      .prepare<[string, string], { readonly n: number }>(
        `SELECT COUNT(*) AS n FROM event_export_requests WHERE event_id = ? AND requested_at >= ?`,
      )
      .get(eventId, toIsoText(since))
    return row?.n ?? 0
  }

  async firstRequestSince(eventId: EventId, since: Date): Promise<Date | null> {
    const row = this.db
      .prepare<[string, string], { readonly first: string | null }>(
        `SELECT MIN(requested_at) AS first FROM event_export_requests
          WHERE event_id = ? AND requested_at >= ?`,
      )
      .get(eventId, toIsoText(since))
    return row?.first === undefined || row.first === null ? null : fromIsoText(row.first)
  }

  async listExpired(now: Date): Promise<readonly EventId[]> {
    return this.db
      .prepare<[string], { readonly event_id: string }>(
        `SELECT event_id FROM event_exports
          WHERE status = 'sealed' AND expires_at IS NOT NULL AND expires_at <= ?
          ORDER BY event_id`,
      )
      .all(toIsoText(now))
      .map((row) => asEventId(row.event_id))
  }

  async listSealedEventIds(): Promise<readonly EventId[]> {
    return this.idsWhere(`status = 'sealed'`)
  }

  async listActiveEventIds(): Promise<readonly EventId[]> {
    return this.idsWhere(`status IN ('queued', 'running')`)
  }

  private idsWhere(condition: string): readonly EventId[] {
    return this.db
      .prepare<[], { readonly event_id: string }>(
        `SELECT event_id FROM event_exports WHERE ${condition} ORDER BY event_id`,
      )
      .all()
      .map((row) => asEventId(row.event_id))
  }

  async sealedBytes(): Promise<number> {
    const row = this.db
      .prepare<[], { readonly total: number }>(
        `SELECT COALESCE(SUM(bytes), 0) AS total FROM event_exports WHERE status = 'sealed'`,
      )
      .get()
    return row?.total ?? 0
  }

  async delete(eventId: EventId): Promise<void> {
    this.db.prepare<[string]>(`DELETE FROM event_exports WHERE event_id = ?`).run(eventId)
  }
}
