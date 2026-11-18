import { storageRefusalFor } from '../../domain/events/admission'
import { GuestbookEntry } from '../../domain/guestbook/guestbookEntry'
import type { GuestbookVoice } from '../../domain/guestbook/guestbookVoice'
import type { ContentHash } from '../../domain/photos/contentHash'
import { admitsAnotherVoice, voiceRefusalFor } from '../../domain/guestbook/guestbookVoiceLimits'
import type { EventId, GuestId, GuestbookEntryId } from '../../domain/shared/ids'
import type {
  GuestbookVoiceRepository,
  VoiceAdmission,
  VoiceAdmissionLimits,
} from '../../application/ports/guestbookVoiceRepository'
import { clientHoldingBytesSum, eventHoldingBytesSum } from './clipJobStatusSql'
import type { Db } from './connection'
import {
  ENTRY_COLUMNS,
  ENTRY_FROM,
  HOLDS_A_PLACE,
  toEntry,
  type EntryRow,
} from './guestbookEntryRows'
import {
  VOICE_BLOCKING_RESEND_SQL,
  VOICE_COUNTED_SQL,
  VOICE_IN_FLIGHT_SQL,
  voiceHoldingBytesSum,
} from './guestbookVoiceSql'
import { toIsoText } from './rowMapping'

/**
 * `guestbook_voices`, always read through its `guestbook_entries` row (spec 25).
 *
 * A voice message is an entry of the book, so every method answers with the `GuestbookEntry` and
 * shares the row mapping of `SqliteGuestbookRepository` (`guestbookEntryRows.ts`). **Every
 * statement that serves a request names `e.event_id`** and leaves out `taken_down_at IS NOT NULL`;
 * the worker's and the reapers' do not, because a recording nobody can reach still has to leave the
 * queue and give its slot back.
 *
 * `admitVoice` is the one write that decides, in a single `.immediate()` transaction: the
 * duplicate, the count ceilings, the queue's depth and the byte quota, then both rows.
 */

interface CountRow {
  readonly value: number | null
}

/** What a COUNT or a COALESCEd SUM answers: always a row, and never null, so the fallback is a type's. */
const scalar = (row: CountRow | undefined): number => row?.value ?? 0

interface VoiceBindings {
  readonly entry_id: string
  readonly event_id: string
  readonly state: string
  readonly source_hash: string
  readonly source_byte_size: number
  readonly audio_hash: string | null
  readonly audio_byte_size: number | null
  readonly duration_ms: number | null
  readonly attempts: number
  readonly failure: string | null
  readonly queued_at: string
  readonly started_at: string | null
  readonly finished_at: string | null
}

const toBindings = (eventId: string, entryId: string, voice: GuestbookVoice): VoiceBindings => {
  const props = voice.toProps()
  return {
    entry_id: entryId,
    event_id: eventId,
    state: props.state,
    source_hash: props.sourceHash.value,
    source_byte_size: props.sourceByteSize,
    audio_hash: props.audioHash === null ? null : props.audioHash.value,
    audio_byte_size: props.audioByteSize,
    duration_ms: props.durationMs,
    attempts: props.attempts,
    failure: props.failure,
    queued_at: toIsoText(props.queuedAt),
    started_at: props.startedAt === null ? null : toIsoText(props.startedAt),
    finished_at: props.finishedAt === null ? null : toIsoText(props.finishedAt),
  }
}

const INSERT_VOICE = `
  INSERT INTO guestbook_voices (entry_id, event_id, state, source_hash, source_byte_size,
    audio_hash, audio_byte_size, duration_ms, attempts, failure, queued_at, started_at, finished_at)
  VALUES (@entry_id, @event_id, @state, @source_hash, @source_byte_size,
    @audio_hash, @audio_byte_size, @duration_ms, @attempts, @failure, @queued_at, @started_at,
    @finished_at)`

const UPDATE_VOICE = `
  UPDATE guestbook_voices
     SET state = @state, audio_hash = @audio_hash, audio_byte_size = @audio_byte_size,
         duration_ms = @duration_ms, attempts = @attempts, failure = @failure,
         queued_at = @queued_at, started_at = @started_at, finished_at = @finished_at
   WHERE event_id = @event_id AND entry_id = @entry_id`

const SUM_EVENT_BYTES = `SELECT ${eventHoldingBytesSum(':eventId')} AS value`
const SUM_CLIENT_BYTES = `SELECT ${clientHoldingBytesSum(':clientId')} AS value`

const voiceOf = (entry: GuestbookEntry): GuestbookVoice => {
  const voice = entry.voice
  if (voice === null) throw new Error('admitVoice takes a voice message')
  return voice
}

export class SqliteGuestbookVoiceRepository implements GuestbookVoiceRepository {
  constructor(private readonly db: Db) {}

  async admitVoice(entry: GuestbookEntry, limits: VoiceAdmissionLimits): Promise<VoiceAdmission> {
    const props = entry.toProps()
    const voice = voiceOf(entry)
    const voiceProps = voice.toProps()

    // Not filtered by `taken_down_at`: the unique index covers a taken-down row too, so a lookup
    // that missed it would turn the duplicate into a constraint failure.
    const findDuplicate = this.db.prepare<[string, string], EntryRow>(
      `SELECT ${ENTRY_COLUMNS} FROM ${ENTRY_FROM}
        WHERE e.event_id = ? AND v.source_hash = ? AND v.state IN (${VOICE_BLOCKING_RESEND_SQL})`,
    )
    const countHeld = this.db.prepare<[string, string], CountRow>(
      `SELECT COUNT(*) AS value FROM ${ENTRY_FROM}
        WHERE e.event_id = ? AND e.guest_id = ? AND ${HOLDS_A_PLACE}`,
    )
    const countOpen = this.db.prepare<[string], CountRow>(
      `SELECT COUNT(*) AS value FROM ${ENTRY_FROM}
        WHERE e.event_id = ? AND e.status <> 'rejected' AND e.taken_down_at IS NULL
          AND ${HOLDS_A_PLACE}`,
    )
    const countVoices = this.db.prepare<[string], CountRow>(OPEN_VOICES)
    const inFlightForEvent = this.db.prepare<[string], CountRow>(
      `SELECT COUNT(*) AS value FROM guestbook_voices
        WHERE event_id = ? AND state IN (${VOICE_IN_FLIGHT_SQL})`,
    )
    const inFlight = this.db.prepare<[], CountRow>(
      `SELECT COUNT(*) AS value FROM guestbook_voices WHERE state IN (${VOICE_IN_FLIGHT_SQL})`,
    )
    const used = this.db.prepare<{ readonly eventId: string }, CountRow>(SUM_EVENT_BYTES)
    const clientBytes = limits.clientBytes ?? null
    const clientUsed =
      clientBytes === null
        ? null
        : this.db.prepare<{ readonly clientId: string }, CountRow>(SUM_CLIENT_BYTES)
    const insertEntry = this.db.prepare<Record<string, string | null>>(
      `INSERT INTO guestbook_entries (id, event_id, guest_id, body, status, review_kind,
                                      reviewed_at, reviewed_by_user_id, created_at, taken_down_at)
            VALUES (@id, @event_id, @guest_id, @body, @status, @review_kind, @reviewed_at,
                    NULL, @created_at, NULL)`,
    )
    const insertVoice = this.db.prepare<VoiceBindings>(INSERT_VOICE)

    return this.db
      .transaction((): VoiceAdmission => {
        const duplicate = findDuplicate.get(props.eventId, voiceProps.sourceHash.value)
        if (duplicate !== undefined) return { kind: 'duplicate', entry: toEntry(duplicate) }

        // The ceilings, from the one function the use case and the fake run: a failed voice is
        // counted in none of the three numbers.
        const limit = voiceRefusalFor({
          heldByGuest: scalar(countHeld.get(props.eventId, props.guestId)),
          openInEvent: scalar(countOpen.get(props.eventId)),
          voicesInEvent: scalar(countVoices.get(props.eventId)),
        })
        if (limit !== null) return { kind: 'refused', refusal: { reason: 'limit', limit } }

        // Per event first, then box-wide, both read before either is compared: the wait behind a
        // per-event refusal is never shorter than the box-wide depth (see `ClipJobRepository.stage`).
        const eventDepth = scalar(inFlightForEvent.get(props.eventId))
        const depth = scalar(inFlight.get())
        if (!admitsAnotherVoice(eventDepth, limits.maxQueuedVoicesPerEvent)) {
          return {
            kind: 'refused',
            refusal: {
              reason: 'queueFull',
              depth: Math.max(eventDepth, depth),
              maxDepth: limits.maxQueuedVoicesPerEvent,
            },
          }
        }
        if (!admitsAnotherVoice(depth, limits.maxQueuedVoices)) {
          return {
            kind: 'refused',
            refusal: { reason: 'queueFull', depth, maxDepth: limits.maxQueuedVoices },
          }
        }

        const storage = storageRefusalFor(
          voiceProps.sourceByteSize,
          {
            quotaBytes: limits.quotaBytes,
            usedBytes: scalar(used.get({ eventId: props.eventId })),
          },
          clientBytes === null || clientUsed === null
            ? null
            : {
                maxBytes: clientBytes.maxBytes,
                usedBytes: scalar(clientUsed.get({ clientId: clientBytes.clientId })),
              },
        )
        if (storage !== null) return { kind: 'refused', refusal: storage }

        insertEntry.run({
          id: props.id,
          event_id: props.eventId,
          guest_id: props.guestId,
          // The caption, or the empty string: the column is NOT NULL, and "no text" is the join's.
          body: voiceProps.caption === null ? '' : voiceProps.caption.value,
          status: props.status,
          review_kind: props.review?.kind ?? null,
          reviewed_at: props.review === null ? null : toIsoText(props.review.at),
          created_at: toIsoText(props.createdAt),
        })
        insertVoice.run(toBindings(props.eventId, props.id, voice))
        return { kind: 'added', entry }
      })
      .immediate()
  }

  async saveVoice(
    eventId: EventId,
    entryId: GuestbookEntryId,
    voice: GuestbookVoice,
  ): Promise<boolean> {
    return (
      this.db.prepare<VoiceBindings>(UPDATE_VOICE).run(toBindings(eventId, entryId, voice))
        .changes > 0
    )
  }

  async findBySourceHash(
    eventId: EventId,
    sourceHash: ContentHash,
  ): Promise<GuestbookEntry | null> {
    // The state filter is the port's contract and what lets SQLite use the partial unique index:
    // it takes a partial index only when the query's WHERE implies the index's.
    const row = this.db
      .prepare<[string, string], EntryRow>(
        `SELECT ${ENTRY_COLUMNS} FROM ${ENTRY_FROM}
          WHERE e.event_id = ? AND v.source_hash = ? AND v.state IN (${VOICE_BLOCKING_RESEND_SQL})
            AND e.taken_down_at IS NULL`,
      )
      .get(eventId, sourceHash.value)
    return row === undefined ? null : toEntry(row)
  }

  async findByEntry(eventId: EventId, entryId: GuestbookEntryId): Promise<GuestbookEntry | null> {
    const row = this.db
      .prepare<[string, string], EntryRow>(
        `SELECT ${ENTRY_COLUMNS} FROM ${ENTRY_FROM}
          WHERE e.event_id = ? AND e.id = ? AND v.entry_id IS NOT NULL
            AND e.taken_down_at IS NULL`,
      )
      .get(eventId, entryId)
    return row === undefined ? null : toEntry(row)
  }

  async listByGuest(eventId: EventId, guestId: GuestId): Promise<readonly GuestbookEntry[]> {
    return this.db
      .prepare<[string, string], EntryRow>(
        `SELECT ${ENTRY_COLUMNS} FROM ${ENTRY_FROM}
          WHERE e.event_id = ? AND e.guest_id = ? AND v.entry_id IS NOT NULL
            AND e.taken_down_at IS NULL
          ORDER BY e.created_at ASC, e.id ASC`,
      )
      .all(eventId, guestId)
      .map(toEntry)
  }

  async countOpenByEvent(eventId: EventId): Promise<number> {
    return scalar(this.db.prepare<[string], CountRow>(OPEN_VOICES).get(eventId))
  }

  async queuedCount(): Promise<number> {
    return scalar(
      this.db
        .prepare<[], CountRow>(
          `SELECT COUNT(*) AS value FROM guestbook_voices WHERE state IN (${VOICE_IN_FLIGHT_SQL})`,
        )
        .get(),
    )
  }

  async deleteByEntry(eventId: EventId, entryId: GuestbookEntryId): Promise<void> {
    // Only a voice message: this port never removes a written one. The voice row follows by cascade.
    this.db
      .prepare<[string, string, string]>(
        `DELETE FROM guestbook_entries
          WHERE event_id = ? AND id = ?
            AND id IN (SELECT entry_id FROM guestbook_voices WHERE entry_id = ?)`,
      )
      .run(eventId, entryId, entryId)
  }

  async listReferencedDigests(eventId: EventId): Promise<ReadonlySet<string>> {
    // Taken-down voices included: their bytes stay (preserved evidence) and are named by the row.
    const rows = this.db
      .prepare<[string, string], { readonly digest: string }>(
        `SELECT source_hash AS digest FROM guestbook_voices
          WHERE event_id = ? AND state IN (${VOICE_IN_FLIGHT_SQL})
         UNION
         SELECT audio_hash AS digest FROM guestbook_voices
          WHERE event_id = ? AND state = 'ready' AND audio_hash IS NOT NULL`,
      )
      .all(eventId, eventId)
    return new Set(rows.map((row) => row.digest))
  }

  async voiceBytes(eventId: EventId): Promise<number> {
    return scalar(
      this.db
        .prepare<{ readonly eventId: string }, CountRow>(
          `SELECT ${voiceHoldingBytesSum(':eventId')} AS value`,
        )
        .get({ eventId }),
    )
  }

  async totalBytes(eventId: EventId): Promise<number> {
    return scalar(
      this.db
        .prepare<[string], CountRow>(
          `SELECT COALESCE(SUM(audio_byte_size), 0) AS value FROM guestbook_voices
            WHERE event_id = ? AND state = 'ready'`,
        )
        .get(eventId),
    )
  }

  async countReady(eventId: EventId): Promise<number> {
    return scalar(
      this.db
        .prepare<[string], CountRow>(
          `SELECT COUNT(*) AS value FROM guestbook_voices WHERE event_id = ? AND state = 'ready'`,
        )
        .get(eventId),
    )
  }

  /**
   * The oldest due voice, claimed: the read and the write are one transaction, as the clip queue's
   * are. Not scoped by event and not filtered by `taken_down_at`: there is one worker for the box,
   * and a recording the operator took down still has to leave the queue.
   */
  async claimNext(now: Date): Promise<GuestbookEntry | null> {
    const due = this.db.prepare<[string], EntryRow>(DUE_VOICE_SQL)
    const update = this.db.prepare<VoiceBindings>(UPDATE_VOICE)

    return this.db
      .transaction((): GuestbookEntry | null => {
        const row = due.get(toIsoText(now))
        if (row === undefined) return null

        const entry = toEntry(row)
        const claimed = voiceOf(entry).start(now)
        // The row was selected as queued, so the entity cannot refuse it. Throwing rather than
        // answering `null` keeps a transition bug from reading as an idle worker.
        if (!claimed.ok) {
          throw new Error(`guestbook voice ${row.id} could not be claimed (${claimed.error.code})`)
        }
        update.run(toBindings(entry.eventId, entry.id, claimed.value))
        return withVoice(entry, claimed.value)
      })
      .immediate()
  }

  async requeueRunning(now: Date): Promise<readonly GuestbookEntry[]> {
    const running = this.db.prepare<[], EntryRow>(
      `SELECT ${ENTRY_COLUMNS} FROM ${VOICE_FROM}
        WHERE v.state = 'running' AND v.state IN (${VOICE_IN_FLIGHT_SQL})
        ORDER BY v.queued_at ASC, e.id ASC`,
    )
    const update = this.db.prepare<VoiceBindings>(UPDATE_VOICE)

    return this.db
      .transaction((): readonly GuestbookEntry[] => {
        const recovered: GuestbookEntry[] = []
        for (const row of running.all()) {
          const entry = toEntry(row)
          const next = voiceOf(entry).retry(now)
          if (!next.ok) {
            throw new Error(`guestbook voice ${row.id} could not be recovered (${next.error.code})`)
          }
          update.run(toBindings(entry.eventId, entry.id, next.value))
          recovered.push(withVoice(entry, next.value))
        }
        return recovered
      })
      .immediate()
  }

  async reapReserved(olderThan: Date): Promise<readonly GuestbookEntry[]> {
    return this.reap(`v.state = 'reserved' AND v.queued_at <= ?`, olderThan)
  }

  async reapFailed(olderThan: Date): Promise<readonly GuestbookEntry[]> {
    return this.reap(`v.state = 'failed' AND v.finished_at <= ?`, olderThan)
  }

  /** Select, then delete the entries (the voice rows follow by cascade), in one transaction. */
  private reap(condition: string, olderThan: Date): readonly GuestbookEntry[] {
    const doomed = this.db.prepare<[string], EntryRow>(
      `SELECT ${ENTRY_COLUMNS} FROM ${ENTRY_FROM} WHERE ${condition} ORDER BY e.created_at ASC, e.id ASC`,
    )
    const remove = this.db.prepare<[string]>(`DELETE FROM guestbook_entries WHERE id = ?`)

    return this.db
      .transaction((): readonly GuestbookEntry[] => {
        const rows = doomed.all(toIsoText(olderThan))
        for (const row of rows) remove.run(row.id)
        return rows.map(toEntry)
      })
      .immediate()
  }
}

/**
 * The worker's reads start from the voice, not from the entry. The partial index on the queue is
 * only taken when the query's WHERE **implies** its own (`state IN (...)` of the three in-flight
 * states, which `state = 'queued'` alone does not), so the in-flight filter is written out beside
 * the narrower one: it is what turns a scan of every voice the box ever held into a seek.
 */
const VOICE_FROM = `guestbook_voices v
       JOIN guestbook_entries e ON e.id = v.entry_id`

/**
 * What the worker asks for: the oldest voice that is due. Exported so `migrator.test.ts` plans the
 * very statement the repository runs, and not a copy of it that could drift from it.
 */
export const DUE_VOICE_SQL = `SELECT ${ENTRY_COLUMNS} FROM ${VOICE_FROM}
        WHERE v.state = 'queued' AND v.state IN (${VOICE_IN_FLIGHT_SQL}) AND v.queued_at <= ?
        ORDER BY v.queued_at ASC, e.id ASC
        LIMIT 1`

/** Voices the host can still act on: not refused, not failed, not taken down. */
const OPEN_VOICES = `
  SELECT COUNT(*) AS value
    FROM guestbook_voices v
    JOIN guestbook_entries e ON e.id = v.entry_id
   WHERE v.event_id = ? AND e.status <> 'rejected' AND e.taken_down_at IS NULL
     AND v.state IN (${VOICE_COUNTED_SQL})`

/** The same entry with its voice moved on, without reading it back. */
const withVoice = (entry: GuestbookEntry, voice: GuestbookVoice): GuestbookEntry =>
  GuestbookEntry.restore({ ...entry.toProps(), voice })
