import type { Migration } from '../migrator'

/**
 * Short video clips (docs/ROADMAP.md 1.4).
 *
 * Two halves, and the split between them is the design.
 *
 * **`photos` gains three nullable columns.** A ready clip is a *facet* of a photo, not a
 * parallel aggregate: it is moderated by the same queue, ordered by the same index,
 * charged to the same quota and deleted by the same cascade. `media_kind` defaults to
 * `'photo'`, so every row that already exists is a photograph without a backfill, and the
 * two clip-only columns are `NULL` for all of them.
 *
 * The per-column `CHECK`s below are what the schema can express. The *coherence* rule —
 * a clip has both a duration and a poster, a photograph has neither — is **not** a
 * constraint here, and saying so plainly is better than implying it: SQLite's
 * `ALTER TABLE ... ADD COLUMN` cannot add a table-level constraint, and rebuilding
 * `photos` to gain one would copy every row of every album that has ever run this
 * schema. It is enforced by the domain, which is the only way to construct a facet, and
 * by `sqlitePhotoRepository`'s mapper, which refuses a row that carries one half of a
 * clip and not the other rather than projecting a slide with no duration.
 *
 * **`clip_jobs` is a table of its own.** A clip that is still transcoding has **no
 * `photos` row at all** — that is the whole point, and it is what makes "a half-encoded
 * clip reached the projector" unrepresentable rather than filtered. The alternative, a
 * fifth `photos.status`, would have widened `isPhotoStatus`, `PhotoStatusCounts`, the
 * queue filter and four exhaustive `Record<PhotoStatus, ...>` tables, and would have
 * offered a moderator "transcoding" as a decision they could take.
 *
 * `source_byte_size` is the reason the quota stays honest while the queue is draining:
 * the staged upload is on the disk the quota exists to protect from the moment it lands,
 * so `SUM(byte_size)` over `photos` alone would under-report the event by the whole
 * contents of the queue — and the media store says that difference means a leak.
 */
export const migration003: Migration = {
  id: 3,
  name: 'clips',
  sql: `
      -- ------------------------------------------------------- photos: the facet --
      -- NOT NULL with a constant default, which is the one shape SQLite's ADD COLUMN
      -- accepts: every existing row is a photograph, and it becomes one with no
      -- backfill and no table rebuild.
      ALTER TABLE photos ADD COLUMN media_kind TEXT NOT NULL DEFAULT 'photo'
        CHECK (media_kind IN ('photo', 'clip'));

      -- Clip only. Milliseconds, INTEGER, because the wall does arithmetic with it.
      ALTER TABLE photos ADD COLUMN duration_ms INTEGER
        CHECK (duration_ms IS NULL OR duration_ms > 0);

      -- Clip only: the digest of the still frame, which is a different file from the
      -- mp4 and therefore a different name. Neither of these is the digest of what the
      -- guest uploaded; that one lives on clip_jobs and never enters this table.
      ALTER TABLE photos ADD COLUMN poster_hash TEXT
        CHECK (poster_hash IS NULL OR length(poster_hash) = 64);

      -- ------------------------------------------------------------- clip_jobs --
      CREATE TABLE IF NOT EXISTS clip_jobs (
        id                TEXT    PRIMARY KEY,
        event_id          TEXT    NOT NULL REFERENCES events (id) ON DELETE CASCADE,

        -- The row this job will produce. Minted at staging, not when the transcode
        -- finishes: a crash between "the photo row landed" and "the job was marked done"
        -- is then a lookup rather than a duplicate or an orphan.
        photo_id          TEXT    NOT NULL,

        -- Exactly one author, as photos does, and cascading for the same reason: erasing
        -- a guest erases what they sent, including what they sent that never arrived.
        author_guest_id   TEXT    REFERENCES guests (id) ON DELETE CASCADE,
        author_user_id    TEXT    REFERENCES users (id)  ON DELETE CASCADE,

        status            TEXT    NOT NULL
                                  CHECK (status IN ('queued', 'running', 'done', 'failed')),

        -- SHA-256 of what the guest uploaded. The idempotency key for a retry on venue
        -- Wi-Fi, and deliberately NOT a photos.content_hash: the source is never stored.
        source_hash       TEXT    NOT NULL CHECK (length(source_hash) = 64),
        source_byte_size  INTEGER NOT NULL CHECK (source_byte_size > 0),

        caption           TEXT,
        attempts          INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        created_at        TEXT    NOT NULL,
        updated_at        TEXT    NOT NULL,
        -- The retry ladder. A queued job is not claimable before this instant.
        not_before        TEXT    NOT NULL,
        failure_code      TEXT,

        CONSTRAINT clip_jobs_one_author CHECK (
          (author_guest_id IS NOT NULL AND author_user_id IS NULL) OR
          (author_guest_id IS NULL AND author_user_id IS NOT NULL)
        )
      );

      -- The retry on venue Wi-Fi. Scoped per event, like the photo hash index beside it,
      -- so two events each own their copy of the same fifteen seconds.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_clip_jobs_event_source
        ON clip_jobs (event_id, source_hash);

      -- The claim: "what, anywhere, is due". Not led by event_id, and deliberately so —
      -- this is the one query in the product that is not scoped to an event, because
      -- there is one worker for the whole box. Partial, so the index stays the size of
      -- the queue rather than the size of every clip ever uploaded.
      CREATE INDEX IF NOT EXISTS idx_clip_jobs_due
        ON clip_jobs (not_before, created_at, id)
        WHERE status = 'queued';

      -- Crash recovery reads exactly this, once, at startup.
      CREATE INDEX IF NOT EXISTS idx_clip_jobs_running
        ON clip_jobs (status)
        WHERE status = 'running';

      -- A guest polling their own clip, and the quota's sum over the staged sources.
      CREATE INDEX IF NOT EXISTS idx_clip_jobs_event_created
        ON clip_jobs (event_id, created_at DESC, id);
  `,
}
