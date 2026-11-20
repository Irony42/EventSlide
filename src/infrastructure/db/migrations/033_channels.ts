import type { Migration } from '../migrator'

/**
 * Messaging channels (spec 27, ADR 0015): a Telegram group sending its photographs to an event.
 *
 * **One file, additive, and nothing that exists is rebuilt.** Three new tables and three new columns
 * with defaults, so a database mid-event is touched by nothing but the addition.
 *
 * ## What a channel is, in the schema
 *
 * - **`guests.channel` / `guests.channel_sender_key`**: a sender becomes a guest without a cookie. The
 *   key is a keyed fingerprint of the channel's own identifier (never the identifier), set when the guest
 *   is created and never changed, both or neither (`CHECK`). The unique index is the guarantee that one
 *   sender is one guest at one event, and it is partial because a guest of the web has neither column.
 *   There is **no table for identities**: erasing the guest row (`/oublier`, `eraseGuestContribution`)
 *   or purging the event removes them.
 * - **`channel_bindings`**: the link from a conversation to an event. It stores the event's id, never the
 *   join code (the code rotates). At most one **active** binding per conversation, held by a partial
 *   unique index; an ended one stays as a record until the event goes.
 * - **`channel_media_jobs`**: the queue between "a message arrived" and "the photograph is stored".
 *   `(channel, conversation_ref, message_ref)` is unique, so an update delivered twice is taken once.
 *   `available_at` is when the worker may take it (a failed attempt waits before the next one).
 *   `sender_name` is the only personal text and is emptied once the job is processed.
 * - **`channel_cursors`**: where the long poll stood (Telegram's `offset`), one row per channel.
 * - **`clients.channels_allowed`**: the client's plan, off for every client that exists (an operator
 *   turns it on by hand), like `books_allowed` and `clips_allowed` but with the opposite default.
 *
 * ## No CHECK on the channel name, on purpose
 *
 * Adding `whatsapp` later must not rebuild a table, so `channel` is free text validated when it is
 * read (`parseChannelKind`); the same goes for a job's `kind`, validated when the row is read, because a future
 * channel may bring a kind of its own. The one closed list kept (`status`) is a frozen literal, pinned by migrator.test.ts.
 *
 * ## Cascades
 *
 * Every table that points at an event cascades from `events`, and the jobs also from the binding
 * they came through, so a purge or an unlinked-then-deleted conversation leaves nothing behind. They
 * never remove bytes: a job holds none (the media is downloaded by the worker and stored by the
 * photograph pipeline).
 *
 * ## The indexes
 *
 * Every foreign key leads an index (migrator.test.ts plans the lookup of each): `event_id` for the
 * bindings and the jobs, `binding_id` for the jobs. `(status, available_at)` is what the worker reads;
 * `(event_id, status)` is what the per-event queue ceiling counts.
 */
export const migration033: Migration = {
  id: 33,
  name: 'channels',
  sql: `
      ALTER TABLE guests ADD COLUMN channel TEXT;
      ALTER TABLE guests ADD COLUMN channel_sender_key TEXT
        CHECK ((channel IS NULL) = (channel_sender_key IS NULL));

      CREATE UNIQUE INDEX IF NOT EXISTS idx_guests_channel_sender
        ON guests (event_id, channel, channel_sender_key)
        WHERE channel IS NOT NULL;

      ALTER TABLE clients ADD COLUMN channels_allowed INTEGER NOT NULL DEFAULT 0
        CHECK (channels_allowed IN (0, 1));

      CREATE TABLE IF NOT EXISTS channel_bindings (
        id                  TEXT PRIMARY KEY,
        event_id            TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,
        channel             TEXT NOT NULL,
        conversation_ref    TEXT NOT NULL,
        conversation_title  TEXT NOT NULL CHECK (length(conversation_title) <= 80),
        bound_at            TEXT NOT NULL,
        unbound_at          TEXT,
        received_count      INTEGER NOT NULL DEFAULT 0 CHECK (received_count >= 0)
      );

      CREATE INDEX IF NOT EXISTS idx_channel_bindings_event
        ON channel_bindings (event_id, bound_at);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_bindings_active
        ON channel_bindings (channel, conversation_ref)
        WHERE unbound_at IS NULL;

      CREATE TABLE IF NOT EXISTS channel_media_jobs (
        id                 TEXT PRIMARY KEY,
        event_id           TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,
        binding_id         TEXT NOT NULL REFERENCES channel_bindings (id) ON DELETE CASCADE,
        channel            TEXT NOT NULL,
        conversation_ref   TEXT NOT NULL,
        message_ref        TEXT NOT NULL,
        sender_key         TEXT NOT NULL,
        sender_name        TEXT,
        kind               TEXT NOT NULL,
        file_ref           TEXT NOT NULL,
        declared_bytes     INTEGER,
        duration_ms        INTEGER,
        declared_name      TEXT NOT NULL,
        declared_mime_type TEXT,
        status             TEXT NOT NULL DEFAULT 'queued'
                             CHECK (status IN ('queued', 'running', 'done', 'failed')),
        failure_code       TEXT,
        attempts           INTEGER NOT NULL DEFAULT 0,
        created_at         TEXT NOT NULL,
        available_at       TEXT NOT NULL,
        updated_at         TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_media_jobs_message
        ON channel_media_jobs (channel, conversation_ref, message_ref);

      CREATE INDEX IF NOT EXISTS idx_channel_media_jobs_event
        ON channel_media_jobs (event_id, status);

      CREATE INDEX IF NOT EXISTS idx_channel_media_jobs_binding
        ON channel_media_jobs (binding_id);

      CREATE INDEX IF NOT EXISTS idx_channel_media_jobs_due
        ON channel_media_jobs (status, available_at);

      CREATE TABLE IF NOT EXISTS channel_cursors (
        channel TEXT PRIMARY KEY,
        cursor  TEXT NOT NULL
      );
  `,
}
