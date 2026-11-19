import type { Db } from './connection'
import { fromIsoText, toIsoText } from './rowMapping'
import type {
  ChannelJobOutcome,
  ChannelMediaJob,
  ChannelMediaJobRepository,
  ChannelMediaJobStatus,
  NewChannelMediaJob,
} from '../../application/ports/channelMediaJobRepository'
import { parseChannelKind } from '../../domain/channels/channelKind'
import {
  asChannelBindingId,
  asChannelMediaJobId,
  asEventId,
  type ChannelMediaJobId,
  type EventId,
} from '../../domain/shared/ids'

/**
 * `ChannelMediaJobRepository` over SQLite (migration 033).
 *
 * Each state change is one statement, and `claimNext` is one transaction (select the oldest due
 * row, mark it running), so the worker and a recovery cannot take the same row.
 */

interface JobRow {
  readonly id: string
  readonly event_id: string
  readonly binding_id: string
  readonly channel: string
  readonly conversation_ref: string
  readonly message_ref: string
  readonly sender_key: string
  readonly sender_name: string | null
  readonly kind: ChannelMediaJob['kind']
  readonly file_ref: string
  readonly declared_bytes: number | null
  readonly duration_ms: number | null
  readonly declared_name: string
  readonly declared_mime_type: string | null
  readonly status: ChannelMediaJobStatus
  readonly failure_code: string | null
  readonly attempts: number
  readonly created_at: string
  readonly available_at: string
  readonly updated_at: string
}

const SELECT_JOB = `
  SELECT id, event_id, binding_id, channel, conversation_ref, message_ref, sender_key, sender_name,
         kind, file_ref, declared_bytes, duration_ms, declared_name, declared_mime_type, status,
         failure_code, attempts, created_at, available_at, updated_at
    FROM channel_media_jobs
`

const toJob = (row: JobRow): ChannelMediaJob => {
  const channel = parseChannelKind(row.channel)
  if (!channel.ok) {
    throw new Error(
      `channel_media_jobs.channel holds a value the domain rejects (${channel.error.code})`,
    )
  }
  return {
    id: asChannelMediaJobId(row.id),
    eventId: asEventId(row.event_id),
    bindingId: asChannelBindingId(row.binding_id),
    channel: channel.value,
    conversationRef: row.conversation_ref,
    messageRef: row.message_ref,
    senderKey: row.sender_key,
    senderName: row.sender_name,
    kind: row.kind,
    fileRef: row.file_ref,
    declaredBytes: row.declared_bytes,
    durationMs: row.duration_ms,
    declaredName: row.declared_name,
    declaredMimeType: row.declared_mime_type,
    status: row.status,
    failureCode: row.failure_code,
    attempts: row.attempts,
    createdAt: fromIsoText(row.created_at),
    availableAt: fromIsoText(row.available_at),
    updatedAt: fromIsoText(row.updated_at),
  }
}

export class SqliteChannelMediaJobRepository implements ChannelMediaJobRepository {
  constructor(private readonly db: Db) {}

  async enqueue(job: NewChannelMediaJob): Promise<'queued' | 'duplicate'> {
    const at = toIsoText(job.createdAt)
    const written = this.db
      .prepare(
        `INSERT INTO channel_media_jobs (id, event_id, binding_id, channel, conversation_ref,
                                         message_ref, sender_key, sender_name, kind, file_ref,
                                         declared_bytes, duration_ms, declared_name,
                                         declared_mime_type, created_at, available_at, updated_at)
              VALUES (@id, @eventId, @bindingId, @channel, @conversationRef, @messageRef,
                      @senderKey, @senderName, @kind, @fileRef, @declaredBytes, @durationMs,
                      @declaredName, @declaredMimeType, @at, @at, @at)
         ON CONFLICT (channel, conversation_ref, message_ref) DO NOTHING`,
      )
      .run({
        id: job.id,
        eventId: job.eventId,
        bindingId: job.bindingId,
        channel: job.channel,
        conversationRef: job.conversationRef,
        messageRef: job.messageRef,
        senderKey: job.senderKey,
        senderName: job.senderName,
        kind: job.kind,
        fileRef: job.fileRef,
        declaredBytes: job.declaredBytes,
        durationMs: job.durationMs,
        declaredName: job.declaredName,
        declaredMimeType: job.declaredMimeType,
        at,
      })
    return written.changes === 0 ? 'duplicate' : 'queued'
  }

  async findById(eventId: EventId, jobId: ChannelMediaJobId): Promise<ChannelMediaJob | null> {
    const row = this.db
      .prepare<[string, string], JobRow>(`${SELECT_JOB} WHERE event_id = ? AND id = ?`)
      .get(eventId, jobId)
    return row === undefined ? null : toJob(row)
  }

  async claimNext(now: Date): Promise<ChannelMediaJob | null> {
    const stamp = toIsoText(now)
    const take = this.db.transaction((): JobRow | undefined => {
      const row = this.db
        .prepare<[string], JobRow>(
          `${SELECT_JOB} WHERE status = 'queued' AND available_at <= ?
            ORDER BY available_at, id LIMIT 1`,
        )
        .get(stamp)
      if (row === undefined) return undefined
      this.db
        .prepare<[string, string]>(
          `UPDATE channel_media_jobs SET status = 'running', updated_at = ? WHERE id = ?`,
        )
        .run(stamp, row.id)
      return { ...row, status: 'running', updated_at: stamp }
    })
    const taken = take()
    return taken === undefined ? null : toJob(taken)
  }

  async recoverAbandoned(now: Date): Promise<number> {
    return this.db
      .prepare<[string]>(
        `UPDATE channel_media_jobs SET status = 'queued', updated_at = ? WHERE status = 'running'`,
      )
      .run(toIsoText(now)).changes
  }

  async retryLater(jobId: ChannelMediaJobId, now: Date, availableAt: Date): Promise<void> {
    this.db
      .prepare<[string, string, string]>(
        `UPDATE channel_media_jobs
            SET status = 'queued', attempts = attempts + 1, available_at = ?, updated_at = ?
          WHERE id = ? AND status = 'running'`,
      )
      .run(toIsoText(availableAt), toIsoText(now), jobId)
  }

  async finish(jobId: ChannelMediaJobId, outcome: ChannelJobOutcome, now: Date): Promise<void> {
    this.db
      .prepare<[string, string | null, string, string]>(
        `UPDATE channel_media_jobs
            SET status = ?, failure_code = ?, sender_name = NULL, updated_at = ?
          WHERE id = ?`,
      )
      .run(
        outcome.status,
        outcome.status === 'failed' ? outcome.failureCode : null,
        toIsoText(now),
        jobId,
      )
  }

  async countPending(eventId: EventId): Promise<number> {
    const rows = this.db
      .prepare<[string], { readonly total: number }>(
        `SELECT COUNT(*) AS total FROM channel_media_jobs
          WHERE event_id = ? AND status IN ('queued', 'running')`,
      )
      .all(eventId)
    return rows.reduce((sum, row) => sum + row.total, 0)
  }

  async deleteBySender(eventId: EventId, senderKey: string): Promise<number> {
    return this.db
      .prepare<[string, string]>(
        `DELETE FROM channel_media_jobs WHERE event_id = ? AND sender_key = ?`,
      )
      .run(eventId, senderKey).changes
  }

  async deleteFinishedBefore(cutoff: Date): Promise<number> {
    return this.db
      .prepare<[string]>(
        `DELETE FROM channel_media_jobs WHERE status IN ('done', 'failed') AND updated_at < ?`,
      )
      .run(toIsoText(cutoff)).changes
  }
}
