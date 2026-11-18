import { GuestbookEntry } from '../../domain/guestbook/guestbookEntry'
import { GuestbookText } from '../../domain/guestbook/guestbookText'
import { GuestbookVoice } from '../../domain/guestbook/guestbookVoice'
import { isVoiceState } from '../../domain/guestbook/guestbookVoiceState'
import { isVoiceFailure, type VoiceFailure } from '../../domain/guestbook/voiceFailure'
import { Caption } from '../../domain/photos/caption'
import { ContentHash } from '../../domain/photos/contentHash'
import { isPhotoStatus } from '../../domain/photos/photoStatus'
import { asEventId, asGuestId, asGuestbookEntryId, asUserId } from '../../domain/shared/ids'
import { fromIsoText, fromNullableIsoText } from './rowMapping'
import { VOICE_COUNTED_SQL } from './guestbookVoiceSql'

/**
 * How a `guestbook_entries` row, with the `guestbook_voices` row it may have, becomes a
 * `GuestbookEntry`: the one mapping the two guestbook adapters share (spec 25, rule 1).
 *
 * **The voice is joined, not looked up.** An entry with a row in `guestbook_voices` is a voice
 * message: its `text` is `null` and the line the guest wrote (the caption) is restored from `body`
 * (`''` is no caption). An entry with none is a written message and its `body` is its text, as it
 * always was. `body` stays `NOT NULL` (migration 019), so "this message has no text" is a fact of
 * the joined table and not of the column.
 *
 * Every statement that reads an entry selects {@link ENTRY_COLUMNS} from {@link ENTRY_FROM}, and
 * **names `e.event_id`** in its `WHERE`, as it always did: the join adds no way to reach another
 * event's row, since the voice row is keyed by the entry and an entry id arrives in a URL.
 */

export const ENTRY_COLUMNS = `e.id, e.event_id, e.guest_id, e.body, e.status, e.review_kind,
       e.reviewed_at, e.reviewed_by_user_id, e.created_at, e.taken_down_at,
       v.entry_id AS v_entry_id, v.state AS v_state, v.source_hash AS v_source_hash,
       v.source_byte_size AS v_source_byte_size, v.audio_hash AS v_audio_hash,
       v.audio_byte_size AS v_audio_byte_size, v.duration_ms AS v_duration_ms,
       v.attempts AS v_attempts, v.failure AS v_failure, v.queued_at AS v_queued_at,
       v.started_at AS v_started_at, v.finished_at AS v_finished_at`

export const ENTRY_FROM = `guestbook_entries e
       LEFT JOIN guestbook_voices v ON v.entry_id = e.id`

/**
 * A row that holds a place: a written message, or a voice that has not failed. The ceilings and
 * every list leave a failed voice out (spec 25, rule 6); the guest's own list does not.
 */
export const HOLDS_A_PLACE = `(v.entry_id IS NULL OR v.state IN (${VOICE_COUNTED_SQL}))`

export interface EntryRow {
  readonly id: string
  readonly event_id: string
  readonly guest_id: string
  readonly body: string
  readonly status: string
  readonly review_kind: string | null
  readonly reviewed_at: string | null
  readonly reviewed_by_user_id: string | null
  readonly created_at: string
  readonly taken_down_at: string | null
  readonly v_entry_id: string | null
  readonly v_state: string | null
  readonly v_source_hash: string | null
  readonly v_source_byte_size: number | null
  readonly v_audio_hash: string | null
  readonly v_audio_byte_size: number | null
  readonly v_duration_ms: number | null
  readonly v_attempts: number | null
  readonly v_failure: string | null
  readonly v_queued_at: string | null
  readonly v_started_at: string | null
  readonly v_finished_at: string | null
}

const corruptRow = (id: string, what: string): Error =>
  new Error(`guestbook_entries row ${id} ${what}; the database is corrupt`)

/** A column the join guarantees on a voice row: its absence is a corrupt database, not a guest error. */
const present = <T>(value: T | null, id: string, column: string): T => {
  if (value === null) throw corruptRow(id, `has a voice with no ${column}`)
  return value
}

const hashOf = (id: string, column: string, value: string): ContentHash => {
  const hash = ContentHash.create(value)
  if (!hash.ok) throw corruptRow(id, `has an invalid ${column} (${hash.error.code})`)
  return hash.value
}

const failureOf = (row: EntryRow): VoiceFailure | null => {
  const failure = row.v_failure
  if (failure === null) return null
  if (!isVoiceFailure(failure))
    throw corruptRow(row.id, `has an unknown voice failure (${failure})`)
  return failure
}

/** The recording of a voice row. The `CHECK`s hold what the types cannot, and are trusted here. */
const toVoice = (row: EntryRow): GuestbookVoice => {
  const state = row.v_state
  if (!isVoiceState(state)) throw corruptRow(row.id, `has an unknown voice state (${state})`)
  const caption = Caption.createOptional(row.body)
  if (!caption.ok)
    throw corruptRow(row.id, `has a caption the domain refuses (${caption.error.code})`)

  return GuestbookVoice.restore({
    state,
    sourceHash: hashOf(row.id, 'source_hash', present(row.v_source_hash, row.id, 'source_hash')),
    sourceByteSize: present(row.v_source_byte_size, row.id, 'source_byte_size'),
    caption: caption.value,
    audioHash: row.v_audio_hash === null ? null : hashOf(row.id, 'audio_hash', row.v_audio_hash),
    audioByteSize: row.v_audio_byte_size,
    durationMs: row.v_duration_ms,
    attempts: present(row.v_attempts, row.id, 'attempts'),
    failure: failureOf(row),
    queuedAt: fromIsoText(present(row.v_queued_at, row.id, 'queued_at')),
    startedAt: fromNullableIsoText(row.v_started_at),
    finishedAt: fromNullableIsoText(row.v_finished_at),
  })
}

export const toEntry = (row: EntryRow): GuestbookEntry => {
  if (!isPhotoStatus(row.status)) throw corruptRow(row.id, `has an unknown status (${row.status})`)

  let text: GuestbookText | null = null
  let voice: GuestbookVoice | null = null
  if (row.v_entry_id === null) {
    const parsed = GuestbookText.create(row.body)
    // A stored body the domain now refuses is a corrupt row rather than a guest error: the
    // alternative is a screen rendering whatever the column holds.
    if (!parsed.ok) throw corruptRow(row.id, `has a body the domain refuses (${parsed.error.code})`)
    text = parsed.value
  } else {
    voice = toVoice(row)
  }

  const reviewedAt = fromNullableIsoText(row.reviewed_at)
  let review: GuestbookEntry['review'] = null
  if (row.review_kind === 'host' && reviewedAt !== null && row.reviewed_by_user_id !== null) {
    review = { kind: 'host', userId: asUserId(row.reviewed_by_user_id), at: reviewedAt }
  } else if (row.review_kind === 'automatic' && reviewedAt !== null) {
    review = { kind: 'automatic', at: reviewedAt }
  }

  return GuestbookEntry.restore({
    id: asGuestbookEntryId(row.id),
    eventId: asEventId(row.event_id),
    guestId: asGuestId(row.guest_id),
    text,
    voice,
    status: row.status,
    review,
    createdAt: fromIsoText(row.created_at),
    takenDownAt: fromNullableIsoText(row.taken_down_at),
  })
}
