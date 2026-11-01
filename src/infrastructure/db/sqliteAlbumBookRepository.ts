import { z } from 'zod'
import type { AlbumBookRepository } from '../../application/ports/albumBookRepository'
import { invalidateBook, startBook, type AlbumBook } from '../../domain/book/albumBook'
import {
  isAlbumBookStatus,
  isBookFailureCode,
  isBookStaleReason,
  type BookStaleReason,
} from '../../domain/book/albumBookStatus'
import { BOOK_LAYOUTS } from '../../domain/book/bookLayout'
import { EVENT_LANGUAGES } from '../../domain/events/eventLanguage'
import { asEventId, type EventId } from '../../domain/shared/ids'
import type { Db } from './connection'
import { fromIsoText, fromNullableIsoText, toIsoText } from './rowMapping'

/**
 * `AlbumBookRepository` over SQLite.
 *
 * `claimNext` and `invalidate` read, decide with the domain function and write inside one
 * `.immediate()` transaction, as `SqliteClipJobRepository.claimNext` does: no second
 * connection can commit between the read and the write.
 */

/** The host's choices as stored. Read back through the same schema: a row is not trusted. */
const optionsSchema = z
  .object({
    title: z.string(),
    subtitle: z.string(),
    language: z.enum(EVENT_LANGUAGES),
    layout: z.enum(BOOK_LAYOUTS),
    showAuthors: z.boolean(),
    showCaptions: z.boolean(),
  })
  .strict()

interface BookRow {
  readonly event_id: string
  readonly status: string
  readonly options_json: string
  readonly requested_at: string
  readonly snapshot_at: string
  readonly invalidated_at: string | null
  readonly started_at: string | null
  readonly done_at: string | null
  readonly photo_count: number | null
  readonly skipped_count: number | null
  readonly page_count: number | null
  readonly byte_size: number | null
  readonly expires_at: string | null
  readonly failure_code: string | null
  readonly stale_reason: string | null
}

const COLUMNS = `event_id, status, options_json, requested_at, snapshot_at, invalidated_at,
  started_at, done_at, photo_count, skipped_count, page_count, byte_size, expires_at,
  failure_code, stale_reason`

const corrupt = (field: string): Error => new Error(`album_books row has an unreadable ${field}`)

const toBook = (row: BookRow): AlbumBook => {
  if (!isAlbumBookStatus(row.status)) throw corrupt('status')
  if (row.failure_code !== null && !isBookFailureCode(row.failure_code))
    throw corrupt('failure_code')
  if (row.stale_reason !== null && !isBookStaleReason(row.stale_reason))
    throw corrupt('stale_reason')
  const options = optionsSchema.safeParse(JSON.parse(row.options_json))
  if (!options.success) throw corrupt('options_json')
  return {
    eventId: asEventId(row.event_id),
    status: row.status,
    options: options.data,
    requestedAt: fromIsoText(row.requested_at),
    snapshotAt: fromIsoText(row.snapshot_at),
    invalidatedAt: fromNullableIsoText(row.invalidated_at),
    startedAt: fromNullableIsoText(row.started_at),
    doneAt: fromNullableIsoText(row.done_at),
    photoCount: row.photo_count,
    skippedCount: row.skipped_count,
    pageCount: row.page_count,
    byteSize: row.byte_size,
    expiresAt: fromNullableIsoText(row.expires_at),
    failureCode: row.failure_code,
    staleReason: row.stale_reason,
  }
}

const nullableIso = (date: Date | null): string | null => (date === null ? null : toIsoText(date))

const toParams = (book: AlbumBook): Record<string, string | number | null> => ({
  event_id: book.eventId,
  status: book.status,
  options_json: JSON.stringify(book.options),
  requested_at: toIsoText(book.requestedAt),
  snapshot_at: toIsoText(book.snapshotAt),
  invalidated_at: nullableIso(book.invalidatedAt),
  started_at: nullableIso(book.startedAt),
  done_at: nullableIso(book.doneAt),
  photo_count: book.photoCount,
  skipped_count: book.skippedCount,
  page_count: book.pageCount,
  byte_size: book.byteSize,
  expires_at: nullableIso(book.expiresAt),
  failure_code: book.failureCode,
  stale_reason: book.staleReason,
})

const UPSERT = `
  INSERT INTO album_books (${COLUMNS})
  VALUES (@event_id, @status, @options_json, @requested_at, @snapshot_at, @invalidated_at,
          @started_at, @done_at, @photo_count, @skipped_count, @page_count, @byte_size,
          @expires_at, @failure_code, @stale_reason)
  ON CONFLICT (event_id) DO UPDATE SET
    status = excluded.status, options_json = excluded.options_json,
    requested_at = excluded.requested_at, snapshot_at = excluded.snapshot_at,
    invalidated_at = excluded.invalidated_at, started_at = excluded.started_at,
    done_at = excluded.done_at, photo_count = excluded.photo_count,
    skipped_count = excluded.skipped_count, page_count = excluded.page_count,
    byte_size = excluded.byte_size, expires_at = excluded.expires_at,
    failure_code = excluded.failure_code, stale_reason = excluded.stale_reason
`

const UPDATE = `
  UPDATE album_books SET
    status = @status, options_json = @options_json, requested_at = @requested_at,
    snapshot_at = @snapshot_at, invalidated_at = @invalidated_at, started_at = @started_at,
    done_at = @done_at, photo_count = @photo_count, skipped_count = @skipped_count,
    page_count = @page_count, byte_size = @byte_size, expires_at = @expires_at,
    failure_code = @failure_code, stale_reason = @stale_reason
  WHERE event_id = @event_id
`

export class SqliteAlbumBookRepository implements AlbumBookRepository {
  constructor(private readonly db: Db) {}

  private read(eventId: string): AlbumBook | null {
    const row = this.db
      .prepare<[string], BookRow>(`SELECT ${COLUMNS} FROM album_books WHERE event_id = ?`)
      .get(eventId)
    return row === undefined ? null : toBook(row)
  }

  private write(book: AlbumBook): void {
    this.db.prepare(UPDATE).run(toParams(book))
  }

  async find(eventId: EventId): Promise<AlbumBook | null> {
    return this.read(eventId)
  }

  async saveRequest(book: AlbumBook): Promise<void> {
    this.db
      .transaction(() => {
        this.db.prepare(UPSERT).run(toParams(book))
        this.db
          .prepare<[string, string]>(
            `INSERT INTO album_book_requests (event_id, requested_at) VALUES (?, ?)`,
          )
          .run(book.eventId, toIsoText(book.requestedAt))
      })
      .immediate()
  }

  async save(book: AlbumBook): Promise<void> {
    const result = this.db.prepare(UPDATE).run(toParams(book))
    if (result.changes === 0) {
      throw new Error('AlbumBookRepository.save: no book was requested for this event')
    }
  }

  async claimNext(now: Date): Promise<AlbumBook | null> {
    return this.db
      .transaction((): AlbumBook | null => {
        const row = this.db
          .prepare<[], BookRow>(
            `SELECT ${COLUMNS} FROM album_books WHERE status = 'queued'
              ORDER BY requested_at ASC, event_id ASC LIMIT 1`,
          )
          .get()
        if (row === undefined) return null
        const started = startBook(toBook(row), now)
        if (!started.ok) return null
        this.write(started.value)
        return started.value
      })
      .immediate()
  }

  async invalidate(
    eventId: EventId,
    reason: BookStaleReason,
    now: Date,
  ): Promise<AlbumBook | null> {
    return this.db
      .transaction((): AlbumBook | null => {
        const book = this.read(eventId)
        if (book === null) return null
        const next = invalidateBook(book, reason, now)
        if (next !== book) this.write(next)
        return next
      })
      .immediate()
  }

  async recoverRunning(): Promise<number> {
    return this.db
      .prepare(
        `UPDATE album_books SET status = 'queued', started_at = NULL WHERE status = 'running'`,
      )
      .run().changes
  }

  async countRequestsSince(eventId: EventId, since: Date): Promise<number> {
    const row = this.db
      .prepare<[string, string], { readonly n: number }>(
        `SELECT COUNT(*) AS n FROM album_book_requests WHERE event_id = ? AND requested_at >= ?`,
      )
      .get(eventId, toIsoText(since))
    return row?.n ?? 0
  }

  async listExpired(now: Date): Promise<readonly EventId[]> {
    return this.db
      .prepare<[string], { readonly event_id: string }>(
        `SELECT event_id FROM album_books WHERE expires_at IS NOT NULL AND expires_at <= ?`,
      )
      .all(toIsoText(now))
      .map((row) => asEventId(row.event_id))
  }

  async listDoneEventIds(): Promise<readonly EventId[]> {
    return this.idsWhere(`status = 'done'`)
  }

  async listActiveEventIds(): Promise<readonly EventId[]> {
    return this.idsWhere(`status IN ('queued', 'running')`)
  }

  private idsWhere(condition: string): readonly EventId[] {
    return this.db
      .prepare<[], { readonly event_id: string }>(
        `SELECT event_id FROM album_books WHERE ${condition} ORDER BY event_id`,
      )
      .all()
      .map((row) => asEventId(row.event_id))
  }

  async doneBytes(): Promise<number> {
    const row = this.db
      .prepare<[], { readonly total: number }>(
        `SELECT COALESCE(SUM(byte_size), 0) AS total FROM album_books WHERE status = 'done'`,
      )
      .get()
    return row?.total ?? 0
  }

  async delete(eventId: EventId): Promise<void> {
    this.db.prepare<[string]>(`DELETE FROM album_books WHERE event_id = ?`).run(eventId)
  }
}
