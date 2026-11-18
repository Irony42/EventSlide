import type { StorageRefusal } from '../../domain/events/admission'
import type { GuestbookEntry } from '../../domain/guestbook/guestbookEntry'
import type { GuestbookVoice } from '../../domain/guestbook/guestbookVoice'
import type { ContentHash } from '../../domain/photos/contentHash'
import type { VoiceRefusal } from '../../domain/guestbook/guestbookVoiceLimits'
import type { EventId, GuestId, GuestbookEntryId } from '../../domain/shared/ids'
import type { ClientByteLimit } from './clientRepository'

/**
 * The recordings behind the guestbook's voice messages (spec 25), and their processing queue.
 *
 * **A separate port from {@link GuestbookRepository}**, which is already wide and says "no
 * `findById` without an event". A voice message is an entry of the book that carries a
 * recording, so every method here answers with the {@link GuestbookEntry}, voice attached, and
 * the two ports share their rows (the SQLite adapters share the table, the fakes share the map).
 *
 * Every method takes `eventId` first, as every event-scoped port does, with the worker's
 * exceptions named below ({@link GuestbookVoiceRepository.claimNext},
 * {@link GuestbookVoiceRepository.requeueRunning}, the two reapers and
 * {@link GuestbookVoiceRepository.queuedCount} ask "what, anywhere on this box, is due" because
 * there is one worker for the whole process, and none of them returns anything to a request).
 *
 * **Every read that serves a request leaves out a message the operator took down.** The worker's
 * and the reapers' do not: a recording nobody can reach still has to leave the queue and give its
 * slot back.
 */

/** What an admission is judged against, taken inside its own transaction. */
export interface VoiceAdmissionLimits {
  /** `events.quota_bytes`, or the client's reduced one. The event's holdings may not pass it. */
  readonly quotaBytes: number
  /** How many recordings may be waiting or running across the whole box. */
  readonly maxQueuedVoices: number
  /** The same backpressure scoped to this event, so one wedding cannot fill every slot. */
  readonly maxQueuedVoicesPerEvent: number
  /** The ceiling of the event's client over all its events, or `null`. */
  readonly clientBytes?: ClientByteLimit | null
}

/**
 * Why a recording was not admitted, with the numbers observed at the moment of the decision.
 * `limit` is the count ceiling that said no (`voiceRefusalFor`, the same function the fake runs).
 */
export type VoiceAdmissionRefusal =
  | { readonly reason: 'limit'; readonly limit: VoiceRefusal }
  | { readonly reason: 'queueFull'; readonly depth: number; readonly maxDepth: number }
  | StorageRefusal

export type VoiceAdmission =
  /** Reserved: the entry and its voice are stored, `reserved`, and the bytes are about to be. */
  | { readonly kind: 'added'; readonly entry: GuestbookEntry }
  /** These very bytes are already this event's (a retry after a dropped upload): that entry. */
  | { readonly kind: 'duplicate'; readonly entry: GuestbookEntry }
  /** A ceiling is reached; nothing was stored. */
  | { readonly kind: 'refused'; readonly refusal: VoiceAdmissionRefusal }

/** What the end of a voice's processing is judged against, taken inside its own transaction. */
export interface VoiceFinishLimits {
  /** `events.quota_bytes`, or the client's reduced one. */
  readonly quotaBytes: number
  /** The ceiling of the event's client over all its events, or `null`. */
  readonly clientBytes?: ClientByteLimit | null
}

export type VoiceFinish =
  /** The voice is `ready`: the output is what the event holds from now on. */
  | { readonly kind: 'saved' }
  /** The row is gone (the guest erased it, or the event was purged): nothing was written. */
  | { readonly kind: 'gone' }
  /** The output does not fit; nothing was written and the voice is still what it was. */
  | { readonly kind: 'refused'; readonly refusal: StorageRefusal }

export interface GuestbookVoiceRepository {
  /**
   * Store a voice message **as a reservation, deciding the limits inside one write transaction**:
   * the row before the bytes, as `ClipJobRepository.stage` does and for the same reason (a refusal
   * costs zero bytes, and the reservation is charged from the instant it exists).
   *
   * In this order: bytes this event already holds in a non-failed voice are the same message
   * (`duplicate`, nothing new: the unique index on `(event_id, source_hash)` is what decides when
   * two requests overlap); then the count ceilings (`voiceRefusalFor`: three per guest, 500 and 200
   * per event, a failed voice counted nowhere); then the queue's depth, per event first and box-wide
   * after; then the byte quota of the event and of its client, over the one expression every
   * reader of "what an event holds" shares. The entry row and the voice row go in together.
   */
  admitVoice(entry: GuestbookEntry, limits: VoiceAdmissionLimits): Promise<VoiceAdmission>

  /**
   * Write a voice's state: **update-only**, answering whether the row was still there. Every caller
   * is a transition of a row that exists (the upload's `reserved` to `queued`, the worker's
   * claims, results and recoveries), so an insert here would resurrect a message the guest erased
   * while a worker was holding it. `false` means it is gone, which is ordinary, not an error.
   */
  saveVoice(eventId: EventId, entryId: GuestbookEntryId, voice: GuestbookVoice): Promise<boolean>

  /**
   * Write a voice's **result** (`ready`, with its output), after judging the quota **inside the
   * same transaction**, with the voice's own source credited: while it ran the event was charged for
   * the source, and the output replaces it, so the figure the output is judged against leaves the
   * source out. Without that credit an event near its quota refuses a recording that plainly fits.
   * It is the voice counterpart of `replacesStagedClip`, and **the only path that can refuse after
   * the work**: an output can be larger than the source (a 32 kbit/s Opus recording becomes
   * 48 kbit/s AAC). Update-only, like {@link saveVoice}: `gone` is ordinary, not an error.
   */
  markReady(
    eventId: EventId,
    entryId: GuestbookEntryId,
    voice: GuestbookVoice,
    limits: VoiceFinishLimits,
  ): Promise<VoiceFinish>

  /**
   * The idempotency check: the voice message this event already holds for these source bytes, or
   * `null`. **Answers only with one that still blocks a fresh attempt** (every state but
   * `failed`), which is what the partial unique index covers: a failed voice is a verdict about
   * the box, not about the bytes, and the guest must be able to send them again. A taken-down
   * message is not found (the transaction still decides it, since the index covers it too).
   */
  findBySourceHash(eventId: EventId, sourceHash: ContentHash): Promise<GuestbookEntry | null>

  /** The voice message of this entry, **in any state**, or `null`. A written message is not found. */
  findByEntry(eventId: EventId, entryId: GuestbookEntryId): Promise<GuestbookEntry | null>

  /**
   * Every voice message of this guest, in any state, for their erasure: the caller removes the
   * bytes (`holdsVoiceSource` ones and the `ready` output) and then the rows. **Skips what the
   * operator took down**, which is preserved evidence.
   */
  listByGuest(eventId: EventId, guestId: GuestId): Promise<readonly GuestbookEntry[]>

  /**
   * Voice messages the host can still act on (`pending`, `published`, `hidden`; not refused, not
   * failed, not taken down): what `MAX_VOICE_PER_EVENT` is judged on.
   */
  countOpenByEvent(eventId: EventId): Promise<number>

  /** Waiting or running, across every event: the box-wide depth of the queue. */
  queuedCount(): Promise<number>

  /**
   * Remove the entry **and** its voice, for the guest's own removal and the failed upload's
   * cleanup. Idempotent. The caller has already removed the bytes it owns.
   */
  deleteByEntry(eventId: EventId, entryId: GuestbookEntryId): Promise<void>

  /**
   * The digests this event's voices still name, lower-case hex: the sources of the ones still
   * holding theirs and the outputs of the `ready` ones. The counterpart of
   * `PhotoRepository.listReferencedDigests` for `sweepOrphanedMedia`. A failed voice names nothing.
   *
   * `excludingEntries` leaves out the named entries' own voices: what the **others** still name, which
   * is what a removal asks before it deletes a digest by name (two recordings can come out as the
   * same bytes, and the file of the one that stays must not go with the one that leaves).
   */
  listReferencedDigests(
    eventId: EventId,
    excludingEntries?: readonly GuestbookEntryId[],
  ): Promise<ReadonlySet<string>>

  /**
   * What this event's voices occupy: sources while processing, the output once `ready`, nothing
   * for a failed one. The voice term of the quota (`eventHoldingBytesSum` is the SQL the dashboard
   * reads; this is the figure the in-memory quota sums).
   */
  voiceBytes(eventId: EventId): Promise<number>

  /** The same figure for the voices an archive would carry: `ready` outputs only. */
  totalBytes(eventId: EventId): Promise<number>

  /** How many `ready` voices the event has, for the archive's size estimate. */
  countReady(eventId: EventId): Promise<number>

  /**
   * Take the oldest voice that is due, marking it `running` in the **same transaction** as the read.
   * Worker-wide, like the clip queue's. `null` when nothing is due.
   */
  claimNext(now: Date): Promise<GuestbookEntry | null>

  /**
   * Every voice left `running` by a process that is gone, put back (or given up on once it has
   * spent its attempts: `GuestbookVoice.retry`), in one transaction. Answers what it touched.
   */
  requeueRunning(now: Date): Promise<readonly GuestbookEntry[]>

  /**
   * Delete the reservations older than `olderThan`: the entry **and** its voice, so the row stops
   * holding a quota charge, one of the guest's three places and the unique index. **Rows only**:
   * the caller must not delete bytes by a digest a re-upload may have won in the meantime;
   * `sweepOrphanedMedia` asks the database and is the race-free collector. Answers what went.
   */
  reapReserved(olderThan: Date): Promise<readonly GuestbookEntry[]>

  /**
   * Delete the failed voices that finished before `olderThan` (24 hours): their bytes are already
   * gone, they only served to tell the guest. The entry and the voice, rows only. Answers what went.
   */
  reapFailed(olderThan: Date): Promise<readonly GuestbookEntry[]>
}
