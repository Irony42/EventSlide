import type { Migration } from '../migrator'

/**
 * Voice messages in the guestbook (spec 25): the recording behind a guestbook_entries row, and
 * the state of its processing.
 *
 * **One table, and it is the whole migration, additive.** A voice message is an entry of the book
 * (same moderation, same removal, same ceilings), so its row in guestbook_entries is the spec 01
 * one and does not change: body (NOT NULL, migration 019) holds the guest's optional line or the
 * empty string, and "this message has no text" is a fact of this table, read by joining. The nine
 * facts of processing mean something only for a voice, so they sit in a child table rather than as
 * nine mostly-empty columns on the book, and a migration that only adds a table is the safest one
 * to apply on an event in progress. The host's setting lives in the settings JSON column (read,
 * never migrated), so nothing touches events.
 *
 * ## The two CHECK lists, frozen
 *
 * A migration never changes meaning, so state and failure carry literals, and migrator.test.ts
 * pins them against the sets of the domain (VOICE_STATES, VOICE_FAILURES), which is what turns
 * "they agree today" into a test. state = 'ready' holds exactly when the output is described
 * (hash, size, duration), all three: a listenable recording that cannot say how long it is does
 * not exist.
 *
 * ## Cascades, and what they do not reach
 *
 * Both foreign keys cascade: deleting an event (the purge) or an entry (a guest's removal or
 * erasure) removes the voice row. **They never remove bytes**: the code deletes those first.
 *
 * ## The indexes, and why each one leads the way it does
 *
 * - the primary key entry_id indexes the foreign key to guestbook_entries and leads with it;
 * - (event_id, state) leads with the foreign key to events (migrator.test.ts plans the lookup of
 *   every foreign key and fails by name) and serves the counts of an event's voices;
 * - (queued_at) over the in-flight states is what the worker and the depth count read, and is
 *   partial because on a healthy box that is a handful of rows;
 * - the unique (event_id, source_hash) over the non-failed states is the idempotency of a retry
 *   after a dropped upload, and a failed voice must not block the guest who sends it again.
 */
export const migration032: Migration = {
  id: 32,
  name: 'guestbook_voices',
  sql: `
      CREATE TABLE IF NOT EXISTS guestbook_voices (
        entry_id         TEXT PRIMARY KEY REFERENCES guestbook_entries (id) ON DELETE CASCADE,
        event_id         TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,
        state            TEXT NOT NULL CHECK (state IN ('reserved', 'queued', 'running', 'ready', 'failed')),
        source_hash      TEXT NOT NULL,
        source_byte_size INTEGER NOT NULL CHECK (source_byte_size > 0),
        audio_hash       TEXT,
        audio_byte_size  INTEGER CHECK (audio_byte_size IS NULL OR audio_byte_size > 0),
        duration_ms      INTEGER CHECK (duration_ms IS NULL OR duration_ms > 0),
        attempts         INTEGER NOT NULL DEFAULT 0,
        failure          TEXT CHECK (failure IS NULL OR failure IN
                           ('unsupportedFormat', 'corrupt', 'notAudio', 'noAudioStream', 'tooLong',
                            'tooShort', 'transcodeFailed', 'timedOut', 'storageFailed')),
        queued_at        TEXT NOT NULL,
        started_at       TEXT,
        finished_at      TEXT,
        CHECK ((state = 'ready') = (audio_hash IS NOT NULL AND audio_byte_size IS NOT NULL
                                    AND duration_ms IS NOT NULL))
      );

      CREATE INDEX IF NOT EXISTS idx_guestbook_voices_event_state
        ON guestbook_voices (event_id, state);

      CREATE INDEX IF NOT EXISTS idx_guestbook_voices_queue
        ON guestbook_voices (queued_at)
        WHERE state IN ('reserved', 'queued', 'running');

      CREATE UNIQUE INDEX IF NOT EXISTS idx_guestbook_voices_source
        ON guestbook_voices (event_id, source_hash)
        WHERE state <> 'failed';
  `,
}
