import type { Migration } from '../migrator'

/**
 * Photo missions (docs/ROADMAP.md §2.1): the host's short list of prompts, and the one
 * field on a photograph that says which prompt it answers.
 *
 * Two halves, and the asymmetry between them is the design.
 *
 * **`event_missions` is a table**, because a prompt is a thing a host creates, edits and
 * deletes one at a time. It is deliberately *not* another key inside `events.settings`,
 * which is the JSON blob every other per-event choice lives in: settings are read as a
 * whole and never queried field by field, and this list is the one per-event
 * configuration that a query has to join against.
 *
 * **Completion is not in it.** There is no `completed_at`, no `completed_by`, no counter.
 * A mission is answered when a **published** photograph names it, counted at read time,
 * and that single choice is what makes the hardest rule in §2.1 hold with nothing to
 * enforce it: a photograph a guest tagged and a moderator then refused stops counting the
 * instant it stops being published. A stored flag would have to be unset by
 * `moderatePhoto`, by `moderatePhotosBulk`, by `deletePhoto`, by a guest's own delete
 * inside the grace window and by the retention purge — and the first of those five
 * anybody forgot would leave a wall saying "fait" over a photograph the host had just
 * taken down, with no way to notice.
 *
 * **`photos` gains one nullable column**, which is the whole of the other half. A tagged
 * photograph is an ordinary photograph: same moderation queue, same wall playlist, same
 * quota, same album export, same cascade. Nothing reads `mission_id` except the counting
 * query below, which is what keeps this item from growing the second gallery §2.1 warns
 * against.
 *
 * ## Why the foreign key is `SET NULL` and not `CASCADE`
 *
 * Deleting a mission must delete a *prompt*, never a photograph. A host who mistypes
 * "la première dance" and removes the row has not asked for the four photographs already
 * filed under it to leave the album — and `CASCADE` there would be a data-loss operation
 * one keystroke away from a typo fix. The photographs survive, unfiled, and the
 * counting query simply stops seeing them.
 *
 * SQLite accepts a `REFERENCES` clause on `ALTER TABLE … ADD COLUMN` only when the new
 * column's default is `NULL`, which this one's is. `PRAGMA foreign_keys` is ON for every
 * connection (`connection.ts`), which is what makes `SET NULL` actually fire rather than
 * be decoration.
 *
 * ## The unique index on the prompt
 *
 * `(event_id, prompt)`, for the same reason `idx_photos_event_hash` exists: a
 * double-submitted form is a no-op rather than two rows on a projector saying the same
 * sentence. It is scoped per event, so two weddings may each ask for a selfie with the
 * couple. `MissionPrompt` normalises whitespace before the value ever reaches here, so
 * "un  selfie" and " un selfie " are one prompt to this index rather than two.
 */
export const migration005: Migration = {
  id: 5,
  name: 'photo_missions',
  sql: `
      -- --------------------------------------------------------- event_missions --
      CREATE TABLE IF NOT EXISTS event_missions (
        id          TEXT PRIMARY KEY,
        event_id    TEXT NOT NULL REFERENCES events (id) ON DELETE CASCADE,

        -- One line, already folded and stripped by MissionPrompt. Stored as the host
        -- typed it: a prompt is content, not interface copy, and nothing translates it.
        prompt      TEXT NOT NULL,

        -- Who the prompt is asked of. 'guest' is answered once per guest, 'event' once
        -- for the room. The closed set is refused by the database as well as by the
        -- domain, and the column documents itself in a dump.
        scope       TEXT NOT NULL CHECK (scope IN ('guest', 'event')),

        created_at  TEXT NOT NULL
      );

      -- The host's own order, which is the order the wall and the checklist read in.
      -- created_at leads because the list is never sorted by anything else, and id
      -- trails so the sort is total and two screens agree.
      CREATE INDEX IF NOT EXISTS idx_event_missions_event
        ON event_missions (event_id, created_at, id);

      -- A double-tapped "Ajouter" is one prompt, not two identical rows on a projector.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_event_missions_event_prompt
        ON event_missions (event_id, prompt);

      -- ---------------------------------------------------------- photos: the tag --
      -- Nullable with no default, which is the one shape SQLite's ADD COLUMN accepts
      -- alongside a REFERENCES clause: every photograph that already exists answers no
      -- mission, and it becomes one with no backfill and no table rebuild.
      ALTER TABLE photos ADD COLUMN mission_id TEXT
        REFERENCES event_missions (id) ON DELETE SET NULL;

      -- The only query that reads the column: per mission, how many published
      -- photographs name it and how many distinct guests sent them.
      --
      -- Covering, so the aggregate never touches the table — author_guest_id is in it
      -- for the DISTINCT, and status for the filter that makes a refused photograph stop
      -- counting. Partial, because the column is NULL for almost every row in an album:
      -- the index is the size of the tagged photographs, not of the evening.
      CREATE INDEX IF NOT EXISTS idx_photos_event_mission
        ON photos (event_id, mission_id, status, author_guest_id)
        WHERE mission_id IS NOT NULL;
  `,
}
