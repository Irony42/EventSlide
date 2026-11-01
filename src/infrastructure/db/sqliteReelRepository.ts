import type {
  ReelAdmission,
  ReelAdmissionLimits,
  ReelFinish,
  ReelFinishLimits,
  ReelInvalidation,
  ReelRepository,
} from '../../application/ports/reelRepository'
import { storageRefusalFor } from '../../domain/events/admission'
import { isReelEligible } from '../../domain/highlights/highlightEligibility'
import { ReelJob, type ReelOutput } from '../../domain/highlights/reelJob'
import { isActive, isReelStatus, canGoStale } from '../../domain/highlights/reelStatus'
import { ContentHash } from '../../domain/photos/contentHash'
import { MEDIA_KINDS, type MediaKind } from '../../domain/photos/mediaKind'
import { isPhotoStatus } from '../../domain/photos/photoStatus'
import { asEventId, asPhotoId, asReelId, type EventId, type PhotoId } from '../../domain/shared/ids'
import { clientHoldingBytesSum, eventHoldingBytesSum } from './clipJobStatusSql'
import type { Db } from './connection'
import { fromIsoText, toIsoText } from './rowMapping'

/**
 * The event's one highlight reel, in SQLite (spec 08).
 *
 * Three properties hold the file together, as for the clip queue:
 *
 * - **The claim is one write transaction** (`.immediate()`), so two workers cannot both take the
 *   row and run two encoders on one output.
 * - **Admission and the final write judge the limits inside their own transaction**, over the same
 *   sums as every other writer (`eventHoldingBytesSum`), which includes this table: the montage is
 *   a file on the event's disk. The request drops the old file from the row *before* the sum is
 *   taken, so a recreation is never charged for two files.
 * - **The final write re-checks every photograph of the snapshot** against `photos` in the same
 *   transaction (published, a photograph, not taken down), so a photograph removed while the
 *   montage rendered gives a `stale` row and never a `done` one.
 */

const REEL_COLUMNS = `
  id, event_id, status, photo_ids, attempts, not_before, failure_code,
  output_hash, byte_size, duration_ms, created_at, updated_at
`

interface ReelRow {
  readonly id: string
  readonly event_id: string
  readonly status: string
  readonly photo_ids: string
  readonly attempts: number
  readonly not_before: string
  readonly failure_code: string | null
  readonly output_hash: string | null
  readonly byte_size: number | null
  readonly duration_ms: number | null
  readonly created_at: string
  readonly updated_at: string
}

interface CountRow {
  readonly value: number | null
}

const isKind = (value: string): value is MediaKind =>
  (MEDIA_KINDS as readonly string[]).includes(value)

const corrupt = (id: string, problem: string): Error =>
  new Error(`highlight_reels row ${id} ${problem}: the database does not match the schema`)

const parseIds = (row: ReelRow): readonly PhotoId[] => {
  let parsed: unknown
  try {
    parsed = JSON.parse(row.photo_ids)
  } catch {
    throw corrupt(row.id, 'has photo_ids that are not JSON')
  }
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== 'string')) {
    throw corrupt(row.id, 'has photo_ids that are not a list of ids')
  }
  return (parsed as string[]).map(asPhotoId)
}

const toOutput = (row: ReelRow): ReelOutput | null => {
  if (row.output_hash === null) return null
  const hash = ContentHash.create(row.output_hash)
  if (!hash.ok) throw corrupt(row.id, 'has an unreadable output_hash')
  if (row.byte_size === null || row.duration_ms === null) {
    throw corrupt(row.id, 'names a file with no size or duration')
  }
  return { hash: hash.value, byteSize: row.byte_size, durationMs: row.duration_ms }
}

const toJob = (row: ReelRow): ReelJob => {
  if (!isReelStatus(row.status)) throw corrupt(row.id, `has the status ${row.status}`)
  return ReelJob.restore({
    id: asReelId(row.id),
    eventId: asEventId(row.event_id),
    status: row.status,
    photoIds: parseIds(row),
    attempts: row.attempts,
    notBefore: fromIsoText(row.not_before),
    failureCode: row.failure_code,
    output: toOutput(row),
    createdAt: fromIsoText(row.created_at),
    updatedAt: fromIsoText(row.updated_at),
  })
}

const toBindings = (job: ReelJob) => {
  const props = job.toProps()
  return {
    id: props.id,
    event_id: props.eventId,
    status: props.status,
    photo_ids: JSON.stringify(props.photoIds),
    attempts: props.attempts,
    not_before: toIsoText(props.notBefore),
    failure_code: props.failureCode,
    output_hash: props.output?.hash.value ?? null,
    byte_size: props.output?.byteSize ?? null,
    duration_ms: props.output?.durationMs ?? null,
    created_at: toIsoText(props.createdAt),
    updated_at: toIsoText(props.updatedAt),
  }
}

type Bindings = ReturnType<typeof toBindings>

const INSERT_REEL = `
  INSERT INTO highlight_reels (${REEL_COLUMNS})
  VALUES (@id, @event_id, @status, @photo_ids, @attempts, @not_before, @failure_code,
          @output_hash, @byte_size, @duration_ms, @created_at, @updated_at)
`

/** The whole mutable state of the row, written from the entity; the id and the event are the key. */
const UPDATE_REEL = `
  UPDATE highlight_reels
     SET status = @status, photo_ids = @photo_ids, attempts = @attempts, not_before = @not_before,
         failure_code = @failure_code, output_hash = @output_hash, byte_size = @byte_size,
         duration_ms = @duration_ms, updated_at = @updated_at
   WHERE id = @id AND event_id = @event_id
`

const SUM_EVENT_BYTES = `SELECT ${eventHoldingBytesSum(':eventId')} AS value`
const SUM_CLIENT_BYTES = `SELECT ${clientHoldingBytesSum(':clientId')} AS value`

export class SqliteReelRepository implements ReelRepository {
  constructor(private readonly db: Db) {}

  private select(eventId: EventId): ReelRow | undefined {
    return this.db
      .prepare<[string], ReelRow>(`SELECT ${REEL_COLUMNS} FROM highlight_reels WHERE event_id = ?`)
      .get(eventId)
  }

  async findByEvent(eventId: EventId): Promise<ReelJob | null> {
    const row = this.select(eventId)
    return row === undefined ? null : toJob(row)
  }

  async reelBytes(eventId: EventId): Promise<number> {
    const row = this.db
      .prepare<[string], CountRow>(
        `SELECT COALESCE(SUM(byte_size), 0) AS value
           FROM highlight_reels WHERE event_id = ? AND output_hash IS NOT NULL`,
      )
      .get(eventId)
    return row?.value ?? 0
  }

  async request(job: ReelJob, limits: ReelAdmissionLimits): Promise<ReelAdmission> {
    const insert = this.db.prepare<Bindings>(INSERT_REEL)
    const update = this.db.prepare<Bindings>(UPDATE_REEL)
    const active = this.db.prepare<[], CountRow>(
      `SELECT COUNT(*) AS value FROM highlight_reels WHERE status IN ('queued', 'running')`,
    )
    const used = this.db.prepare<{ readonly eventId: string }, CountRow>(SUM_EVENT_BYTES)
    const clientBytes = limits.clientBytes
    const clientUsed =
      clientBytes === null
        ? null
        : this.db.prepare<{ readonly clientId: string }, CountRow>(SUM_CLIENT_BYTES)

    return this.db
      .transaction((): ReelAdmission => {
        const existing = this.select(job.eventId)
        const current = existing === undefined ? null : toJob(existing)

        if (current !== null && isActive(current.status)) {
          return { refusal: { reason: 'alreadyRunning' }, replacedOutput: null }
        }

        const depth = active.get()?.value ?? 0
        if (depth >= limits.maxQueued) {
          return {
            refusal: { reason: 'queueFull', depth, maxDepth: limits.maxQueued },
            replacedOutput: null,
          }
        }

        // The old file is not counted against the new one: asking again is charged for one
        // montage, not two. Refused, the row is left alone and the host keeps the montage they
        // had; accepted, the update below drops the old file from the row (the new job has no
        // output) and the caller deletes the file the row no longer names.
        const replaced = current?.output ?? null
        const released = replaced?.byteSize ?? 0

        const refusal = storageRefusalFor(
          limits.reservedBytes,
          {
            quotaBytes: limits.quotaBytes,
            usedBytes: (used.get({ eventId: job.eventId })?.value ?? 0) - released,
          },
          clientBytes === null || clientUsed === null
            ? null
            : {
                maxBytes: clientBytes.maxBytes,
                usedBytes:
                  (clientUsed.get({ clientId: clientBytes.clientId })?.value ?? 0) - released,
              },
        )
        if (refusal !== null) return { refusal, replacedOutput: null }

        if (current === null) insert.run(toBindings(job))
        else update.run(toBindings(job))
        return { refusal: null, replacedOutput: replaced?.hash ?? null }
      })
      .immediate()
  }

  async claimNext(now: Date): Promise<ReelJob | null> {
    const due = this.db.prepare<[string], ReelRow>(
      `SELECT ${REEL_COLUMNS} FROM highlight_reels
        WHERE status = 'queued' AND not_before <= ?
        ORDER BY not_before ASC, created_at ASC, id ASC LIMIT 1`,
    )
    const update = this.db.prepare<Bindings>(`${UPDATE_REEL} AND status = 'queued'`)

    return this.db
      .transaction((): ReelJob | null => {
        const row = due.get(toIsoText(now))
        if (row === undefined) return null
        const claimed = toJob(row).claim(now)
        if (!claimed.ok) throw corrupt(row.id, `could not be claimed (${claimed.error.code})`)
        if (update.run(toBindings(claimed.value)).changes === 0) return null
        return claimed.value
      })
      .immediate()
  }

  async save(job: ReelJob): Promise<boolean> {
    return this.db.prepare<Bindings>(UPDATE_REEL).run(toBindings(job)).changes > 0
  }

  async finish(
    job: ReelJob,
    output: ReelOutput,
    limits: ReelFinishLimits,
    now: Date,
  ): Promise<ReelFinish> {
    const used = this.db.prepare<{ readonly eventId: string }, CountRow>(SUM_EVENT_BYTES)
    const clientBytes = limits.clientBytes
    const clientUsed =
      clientBytes === null
        ? null
        : this.db.prepare<{ readonly clientId: string }, CountRow>(SUM_CLIENT_BYTES)
    const photo = this.db.prepare<
      [string, string],
      {
        readonly status: string
        readonly media_kind: string
        readonly taken_down_at: string | null
      }
    >(`SELECT status, media_kind, taken_down_at FROM photos WHERE event_id = ? AND id = ?`)

    return this.db
      .transaction((): ReelFinish => {
        const row = this.select(job.eventId)
        if (row === undefined || row.id !== job.id) return { kind: 'gone' }
        const current = toJob(row)
        if (current.status !== 'running') return { kind: 'stale' }

        // Every photograph, judged now, against the rows as committed.
        for (const photoId of current.photoIds) {
          const held = photo.get(job.eventId, photoId)
          if (
            held === undefined ||
            held.taken_down_at !== null ||
            !isPhotoStatus(held.status) ||
            !isKind(held.media_kind) ||
            !isReelEligible(held.status, held.media_kind)
          ) {
            const spoiled = current.makeStale(now)
            if (!spoiled.ok) throw corrupt(row.id, 'could not be made stale')
            this.db.prepare<Bindings>(UPDATE_REEL).run(toBindings(spoiled.value))
            return { kind: 'stale' }
          }
        }

        const refusal = storageRefusalFor(
          output.byteSize,
          {
            quotaBytes: limits.quotaBytes,
            usedBytes: used.get({ eventId: job.eventId })?.value ?? 0,
          },
          clientBytes === null || clientUsed === null
            ? null
            : {
                maxBytes: clientBytes.maxBytes,
                usedBytes: clientUsed.get({ clientId: clientBytes.clientId })?.value ?? 0,
              },
        )
        if (refusal !== null) return { kind: 'refused', refusal }

        const done = current.succeed(output, now)
        if (!done.ok) throw corrupt(row.id, 'could not be finished')
        this.db.prepare<Bindings>(UPDATE_REEL).run(toBindings(done.value))
        return { kind: 'done' }
      })
      .immediate()
  }

  async invalidate(
    eventId: EventId,
    photoIds: readonly PhotoId[],
    now: Date,
  ): Promise<ReelInvalidation> {
    return this.db
      .transaction((): ReelInvalidation => {
        const row = this.select(eventId)
        if (row === undefined) return { staled: false, output: null }
        const current = toJob(row)
        if (!canGoStale(current.status)) return { staled: false, output: null }
        if (!photoIds.some((id) => current.includes(id))) return { staled: false, output: null }

        const spoiled = current.makeStale(now)
        if (!spoiled.ok) throw corrupt(row.id, 'could not be made stale')
        this.db.prepare<Bindings>(UPDATE_REEL).run(toBindings(spoiled.value))
        return { staled: true, output: current.output?.hash ?? null }
      })
      .immediate()
  }

  async clearOutput(eventId: EventId, hash: ContentHash): Promise<void> {
    this.db
      .prepare<[string, string]>(
        `UPDATE highlight_reels SET output_hash = NULL, byte_size = NULL, duration_ms = NULL
          WHERE event_id = ? AND output_hash = ?`,
      )
      .run(eventId, hash.value)
  }

  async recoverAbandoned(now: Date): Promise<number> {
    const running = this.db.prepare<[], ReelRow>(
      `SELECT ${REEL_COLUMNS} FROM highlight_reels WHERE status = 'running'`,
    )
    const update = this.db.prepare<Bindings>(UPDATE_REEL)
    return this.db
      .transaction((): number => {
        const rows = running.all()
        for (const row of rows) {
          const next = toJob(row).recover(now)
          if (!next.ok) throw corrupt(row.id, `could not be recovered (${next.error.code})`)
          update.run(toBindings(next.value))
        }
        return rows.length
      })
      .immediate()
  }

  async listStaleOutputs(): Promise<
    readonly { readonly eventId: EventId; readonly hash: ContentHash }[]
  > {
    const rows = this.db
      .prepare<[], ReelRow>(
        `SELECT ${REEL_COLUMNS} FROM highlight_reels
          WHERE status = 'stale' AND output_hash IS NOT NULL`,
      )
      .all()
    return rows.flatMap((row) => {
      const output = toOutput(row)
      return output === null ? [] : [{ eventId: asEventId(row.event_id), hash: output.hash }]
    })
  }

  async listReferencedDigests(eventId: EventId): Promise<ReadonlySet<string>> {
    const row = this.select(eventId)
    return new Set(row?.output_hash == null ? [] : [row.output_hash])
  }

  async countActive(): Promise<number> {
    return (
      this.db
        .prepare<[], CountRow>(
          `SELECT COUNT(*) AS value FROM highlight_reels WHERE status IN ('queued', 'running')`,
        )
        .get()?.value ?? 0
    )
  }
}
