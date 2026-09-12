import type {
  ClipAdmission,
  ClipAdmissionLimits,
  ClipJobRepository,
} from '../../application/ports/clipJobRepository'
import { ClipJob, type ClipJobProps } from '../../domain/clips/clipJob'
import { isClipJobStatus, type ClipJobStatus } from '../../domain/clips/clipJobStatus'
import { Caption } from '../../domain/photos/caption'
import { ContentHash } from '../../domain/photos/contentHash'
import type { PhotoAuthor } from '../../domain/photos/photo'
import type { DomainError } from '../../domain/shared/errors'
import {
  asClipJobId,
  asEventId,
  asGuestId,
  asPhotoId,
  asUserId,
  type ClipJobId,
  type EventId,
} from '../../domain/shared/ids'
import type { Result } from '../../domain/shared/result'
import type { Db } from './connection'
import { fromIsoText, toIsoText } from './rowMapping'

/**
 * `ClipJobRepository` over SQLite.
 *
 * One property here is worth more than the rest of the file: **the claim is a single
 * transaction**. `better-sqlite3` is synchronous, so between the `SELECT` that finds the
 * next due job and the `UPDATE` that marks it `running` there is no `await` for anything
 * else to interleave at, and `.immediate()` takes the write lock before the read so a
 * second connection cannot commit in between either. Without that, two processes during
 * a rolling restart both claim the same row and run two `ffmpeg` instances writing to one
 * output path — which is not a slow queue, it is a corrupt file on a projector.
 *
 * The decision itself is still the entity's: the row is hydrated, `ClipJob.claim` is
 * asked, and what it answers is what gets written. The repository contributes only the
 * thing a use case cannot, which is atomicity.
 */

const CLIP_JOB_COLUMNS = `
  id, event_id, photo_id, author_guest_id, author_user_id, status,
  source_hash, source_byte_size, caption, attempts,
  created_at, updated_at, not_before, failure_code
`

const INSERT_CLIP_JOB = `
  INSERT INTO clip_jobs (
    id, event_id, photo_id, author_guest_id, author_user_id, status,
    source_hash, source_byte_size, caption, attempts,
    created_at, updated_at, not_before, failure_code
  ) VALUES (
    @id, @event_id, @photo_id, @author_guest_id, @author_user_id, @status,
    @source_hash, @source_byte_size, @caption, @attempts,
    @created_at, @updated_at, @not_before, @failure_code
  )
`

/** Scoped by `event_id` as well as by `id`, like every other write in this codebase. */
const UPDATE_CLIP_JOB = `
  UPDATE clip_jobs
     SET photo_id         = @photo_id,
         author_guest_id  = @author_guest_id,
         author_user_id   = @author_user_id,
         status           = @status,
         source_hash      = @source_hash,
         source_byte_size = @source_byte_size,
         caption          = @caption,
         attempts         = @attempts,
         created_at       = @created_at,
         updated_at       = @updated_at,
         not_before       = @not_before,
         failure_code     = @failure_code
   WHERE id = @id AND event_id = @event_id
`

interface ClipJobRow {
  readonly id: string
  readonly event_id: string
  readonly photo_id: string
  readonly author_guest_id: string | null
  readonly author_user_id: string | null
  readonly status: string
  readonly source_hash: string
  readonly source_byte_size: number
  readonly caption: string | null
  readonly attempts: number
  readonly created_at: string
  readonly updated_at: string
  readonly not_before: string
  readonly failure_code: string | null
}

interface ClipJobBindings {
  readonly id: string
  readonly event_id: string
  readonly photo_id: string
  readonly author_guest_id: string | null
  readonly author_user_id: string | null
  readonly status: string
  readonly source_hash: string
  readonly source_byte_size: number
  readonly caption: string | null
  readonly attempts: number
  readonly created_at: string
  readonly updated_at: string
  readonly not_before: string
  readonly failure_code: string | null
}

const corruptRow = (id: string, problem: string): Error =>
  new Error(`clip_jobs row ${id} ${problem}: the database does not match the schema`)

const trusted = <T>(result: Result<T, DomainError>, id: string, column: string): T => {
  if (!result.ok) throw corruptRow(id, `has an invalid ${column} (${result.error.code})`)
  return result.value
}

const toAuthor = (row: ClipJobRow): PhotoAuthor => {
  if (row.author_guest_id !== null) {
    return { kind: 'guest', guestId: asGuestId(row.author_guest_id) }
  }
  if (row.author_user_id !== null) return { kind: 'host', userId: asUserId(row.author_user_id) }
  throw corruptRow(row.id, 'has neither an author guest nor an author user')
}

const statusOf = (row: ClipJobRow): ClipJobStatus => {
  if (!isClipJobStatus(row.status))
    throw corruptRow(row.id, `has an unknown status (${row.status})`)
  return row.status
}

const toClipJob = (row: ClipJobRow): ClipJob => {
  const props: ClipJobProps = {
    id: asClipJobId(row.id),
    eventId: asEventId(row.event_id),
    author: toAuthor(row),
    photoId: asPhotoId(row.photo_id),
    status: statusOf(row),
    sourceHash: trusted(ContentHash.create(row.source_hash), row.id, 'source_hash'),
    sourceByteSize: row.source_byte_size,
    caption: row.caption === null ? null : trusted(Caption.create(row.caption), row.id, 'caption'),
    attempts: row.attempts,
    createdAt: fromIsoText(row.created_at),
    updatedAt: fromIsoText(row.updated_at),
    notBefore: fromIsoText(row.not_before),
    failureCode: row.failure_code,
  }
  return ClipJob.restore(props)
}

const toBindings = (job: ClipJob): ClipJobBindings => {
  const props = job.toProps()
  const author = props.author

  return {
    id: props.id,
    event_id: props.eventId,
    photo_id: props.photoId,
    author_guest_id: author.kind === 'guest' ? author.guestId : null,
    author_user_id: author.kind === 'host' ? author.userId : null,
    status: props.status,
    source_hash: props.sourceHash.value,
    source_byte_size: props.sourceByteSize,
    caption: props.caption === null ? null : props.caption.value,
    attempts: props.attempts,
    created_at: toIsoText(props.createdAt),
    updated_at: toIsoText(props.updatedAt),
    not_before: toIsoText(props.notBefore),
    failure_code: props.failureCode,
  }
}

interface CountRow {
  readonly value: number | null
}

/**
 * The event's whole byte total, in one statement: the album **and** the queue.
 *
 * Character for character what `SqlitePhotoRepository`'s `SUM_EVENT_BYTES` asks, and it
 * has to be — the two enforce one quota from two tables, and a staged clip is on the
 * same disk as a published photograph. Duplicated rather than shared because each is
 * read inside its own adapter's write transaction, and a module that both imported would
 * be a third place to keep in step with the schema.
 */
const SUM_EVENT_BYTES = `
  SELECT (SELECT COALESCE(SUM(byte_size), 0) FROM photos WHERE event_id = :eventId)
       + (SELECT COALESCE(SUM(source_byte_size), 0)
            FROM clip_jobs
           WHERE event_id = :eventId AND status IN ('queued', 'running')) AS value
`

const COUNT_ACTIVE_CLIPS = `
  SELECT COUNT(*) AS value FROM clip_jobs WHERE status IN ('queued', 'running')
`

export class SqliteClipJobRepository implements ClipJobRepository {
  constructor(private readonly db: Db) {}

  async findById(eventId: EventId, clipJobId: ClipJobId): Promise<ClipJob | null> {
    const row = this.db
      .prepare<[string, string], ClipJobRow>(
        `SELECT ${CLIP_JOB_COLUMNS} FROM clip_jobs WHERE event_id = ? AND id = ?`,
      )
      .get(eventId, clipJobId)

    return row === undefined ? null : toClipJob(row)
  }

  async findBySourceHash(eventId: EventId, sourceHash: ContentHash): Promise<ClipJob | null> {
    const row = this.db
      .prepare<[string, string], ClipJobRow>(
        `SELECT ${CLIP_JOB_COLUMNS} FROM clip_jobs WHERE event_id = ? AND source_hash = ?`,
      )
      .get(eventId, sourceHash.value)

    return row === undefined ? null : toClipJob(row)
  }

  /**
   * Update-or-insert, in one transaction for the same reason `SqlitePhotoRepository.save`
   * is: without it a concurrent insert between the miss and the insert turns an update
   * into a raise.
   */
  async save(job: ClipJob): Promise<void> {
    const update = this.db.prepare<ClipJobBindings>(UPDATE_CLIP_JOB)
    const insert = this.db.prepare<ClipJobBindings>(INSERT_CLIP_JOB)
    const bindings = toBindings(job)

    this.db.transaction(() => {
      if (update.run(bindings).changes === 0) insert.run(bindings)
    })()
  }

  /**
   * The upload path's door: depth, quota and insert in one `.immediate()` transaction.
   *
   * The counterpart of `SqlitePhotoRepository.saveManyWithinLimits`, and it exists for
   * the identical reason. Asking `countActive`, then `totalBytes`, then `save` is three
   * statements with `await`s between them, so two guests uploading at the same moment
   * both read a queue with room and both committed — the overshoot bounded by the number
   * of requests in flight rather than by the quota.
   *
   * Depth before bytes, because a full queue is the cheaper and the more temporary of
   * the two refusals: a guest told `429, come back in ninety seconds` has somewhere to
   * go, and one told the gallery is full does not.
   */
  async stage(job: ClipJob, limits: ClipAdmissionLimits): Promise<ClipAdmission> {
    const active = this.db.prepare<[], CountRow>(COUNT_ACTIVE_CLIPS)
    const used = this.db.prepare<{ readonly eventId: string }, CountRow>(SUM_EVENT_BYTES)
    const insert = this.db.prepare<ClipJobBindings>(INSERT_CLIP_JOB)

    return this.db
      .transaction((): ClipAdmission => {
        const depth = active.get()?.value ?? 0
        if (depth >= limits.maxQueuedClips) return { refusal: { reason: 'queueFull', depth } }

        const usedBytes = used.get({ eventId: job.eventId })?.value ?? 0
        if (usedBytes + job.sourceByteSize > limits.quotaBytes) {
          return {
            refusal: {
              reason: 'quotaExceeded',
              remaining: Math.max(0, limits.quotaBytes - usedBytes),
            },
          }
        }

        insert.run(toBindings(job))
        return { refusal: null }
      })
      .immediate()
  }

  /**
   * The oldest due job, claimed. See the class note: the read and the write are one
   * transaction, and `.immediate()` is what extends that across connections.
   *
   * Not scoped by event, deliberately: there is one worker for the box, and it cannot
   * name the event whose guest is about to upload.
   */
  async claimNext(now: Date): Promise<ClipJob | null> {
    const due = this.db.prepare<[string], ClipJobRow>(
      `SELECT ${CLIP_JOB_COLUMNS}
         FROM clip_jobs
        WHERE status = 'queued' AND not_before <= ?
        ORDER BY not_before ASC, created_at ASC, id ASC
        LIMIT 1`,
    )
    const update = this.db.prepare<ClipJobBindings>(UPDATE_CLIP_JOB)

    return this.db
      .transaction((): ClipJob | null => {
        const row = due.get(toIsoText(now))
        if (row === undefined) return null

        const claimed = toClipJob(row).claim(now)
        // The row was selected as `queued`, so the entity cannot refuse it. Throwing
        // rather than answering `null` keeps a genuine transition bug from reading as an
        // empty queue, which is the failure that would look like "the worker is idle".
        if (!claimed.ok) throw corruptRow(row.id, `could not be claimed (${claimed.error.code})`)

        update.run(toBindings(claimed.value))
        return claimed.value
      })
      .immediate()
  }

  /**
   * Everything a dead process was holding, in one transaction.
   *
   * One statement per row rather than a blanket `UPDATE ... WHERE status = 'running'`,
   * because the outcome is not the same for every row: `ClipJob.recover` puts most of
   * them back and gives up on one that has spent its attempts, and that decision belongs
   * to the entity rather than to a `CASE` expression in SQL.
   */
  async recoverAbandoned(now: Date): Promise<readonly ClipJob[]> {
    const running = this.db.prepare<[], ClipJobRow>(
      `SELECT ${CLIP_JOB_COLUMNS} FROM clip_jobs WHERE status = 'running' ORDER BY created_at ASC`,
    )
    const update = this.db.prepare<ClipJobBindings>(UPDATE_CLIP_JOB)

    return this.db
      .transaction((): readonly ClipJob[] => {
        const recovered: ClipJob[] = []
        for (const row of running.all()) {
          const next = toClipJob(row).recover(now)
          if (!next.ok) throw corruptRow(row.id, `could not be recovered (${next.error.code})`)

          update.run(toBindings(next.value))
          recovered.push(next.value)
        }
        return recovered
      })
      .immediate()
  }

  async countActive(): Promise<number> {
    return this.db.prepare<[], CountRow>(COUNT_ACTIVE_CLIPS).get()?.value ?? 0
  }

  /**
   * The half of the byte quota that is not photographs.
   *
   * `SqlitePhotoRepository`'s own `SUM` reads the same rows in the same statement as its
   * photo total — it has to, because the enforcing check happens inside the insert
   * transaction. This method is what the rest of the application asks, and the two must
   * always say the same thing about the same event.
   */
  async stagedBytes(eventId: EventId): Promise<number> {
    const row = this.db
      .prepare<[string], CountRow>(
        `SELECT COALESCE(SUM(source_byte_size), 0) AS value
           FROM clip_jobs
          WHERE event_id = ? AND status IN ('queued', 'running')`,
      )
      .get(eventId)

    return row?.value ?? 0
  }
}
