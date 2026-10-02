import type { Migration } from '../migrator'

/**
 * The append-only audit log (docs/ROADMAP.md §10.8; paid plan P3-07, free plan G2-06).
 *
 * Who created this client, who changed that ceiling, and when. The moment an account can
 * act on data it does not own, "what happened" stops being a question anything else can
 * answer, and an audit log that its own application can rewrite answers it wrongly.
 *
 * ## Append-only is enforced here, not promised there
 *
 * Three triggers, so that no code path — a bug, a hurried `psql`-style fix, a future use
 * case that thinks it is tidying up — can change history by accident:
 *
 * - **`audit_log_no_update`** refuses every `UPDATE` except one: `actor_user_id` going from
 *   a value to `NULL`, with every other column identical, **and the account gone**. That
 *   is exactly what `ON DELETE SET NULL` on the foreign key does when an account is
 *   deleted, and it is the whole erasure procedure: a row holds an opaque id and no
 *   personal data, so dissociating the id is all there is to erase. The account-is-gone
 *   clause is the one addition to the paid plan's trigger: without it the same `UPDATE`
 *   run by hand against a live account would erase *who did it* from any row, and the
 *   trigger would be guarding everything except the one column that matters.
 * - **`audit_log_no_delete`** refuses every `DELETE` while `audit_prune_gate.open` is not
 *   `1`, whatever the age of the row.
 * - **`audit_log_no_overwrite`** refuses an `INSERT` whose `seq` already exists. It is not
 *   decoration: `INSERT OR REPLACE` resolves a conflict by *deleting* the old row, and
 *   SQLite does not fire delete triggers for that unless `recursive_triggers` is on, which
 *   it is not. Without this trigger a single `INSERT OR REPLACE ... (seq, ...)` rewrites
 *   any row of the log past both of the others.
 *
 * What none of this is: protection against someone who can run `DROP TRIGGER` or edit the
 * file. Those are DDL and a disk, and a database cannot defend its own schema from its
 * owner. It guards against the application and against mistakes, which is the failure the
 * log is actually exposed to.
 *
 * ## Retention goes through a permanent gate row
 *
 * The only thing that may delete is the retention sweep. It needs to say so to a trigger
 * that lives in the schema, and a non-`TEMP` trigger cannot read a `TEMP` table, so the
 * switch is an ordinary permanent row: `audit_prune_gate`, one row, `open` 0 or 1. The
 * sweep opens it, deletes, and closes it **inside one transaction**, so a crash or a
 * failing `DELETE` rolls the gate shut with everything else and the committed state of
 * the database always has it closed. `audit_prune_gate_permanent` stops anything deleting
 * the row, because a missing gate row reads as "not open" and the log could then never
 * be pruned again.
 *
 * ## The CHECKs are wider than anything built today
 *
 * `subject_type` admits `photo` (the moderation log of §5.4 shares this storage),
 * `report`, and `access_request` (G8-09's waiting list, which may never be built). Widening
 * a `CHECK` in SQLite means rebuilding the table, and rebuilding a table whose triggers
 * refuse every rewrite is the most expensive way there is to add a word to a list.
 * `actor_kind` carries `member` and `integration` for the same reason.
 *
 * ## No foreign key on `client_id`
 *
 * The history of a client that has since been deleted must outlive the row it describes,
 * and `ON DELETE SET NULL` would be an `UPDATE` the triggers would have to allow.
 *
 * ## Personal data
 *
 * None, by construction: `details` is a JSON object whose keys and kinds each action
 * declares in `domain/audit/auditAction.ts` (numbers, switches, instants, ids; never an
 * address, a name, a caption, a slug or a token), and `actor_user_id` is an opaque id that
 * the foreign key turns into `NULL` when its account is deleted. `json_valid` and
 * `json_type` keep the column an object whatever wrote it.
 *
 * ## Indexes
 *
 * `idx_audit_client (client_id, seq)` answers "this client's trail, newest first", which
 * is the one lookup with a filter. The unfiltered operator view reads the primary key in
 * reverse. Retention scans on `at`: the table is small (operator actions, not guest
 * traffic) and the sweep runs hourly, so an index on `at` would cost every insert to save
 * a scan nobody waits for.
 */
export const migration009: Migration = {
  id: 9,
  name: 'audit_log',
  sql: `
      CREATE TABLE IF NOT EXISTS audit_log (
        -- AUTOINCREMENT, unlike every other key in this schema, on purpose: it is a sequence
        -- number and not an identifier, and it must never be reused after a prune, or a
        -- reader holding the cursor of a row that was pruned would meet a different row.
        -- Positive, because audit_log_no_overwrite reads the seq of an auto-numbered insert as
        -- -1: a hand-written row with that seq would make every later append look like an
        -- overwrite of it.
        seq            INTEGER PRIMARY KEY AUTOINCREMENT CHECK (seq > 0),
        at             TEXT    NOT NULL,
        actor_user_id  TEXT    REFERENCES users (id) ON DELETE SET NULL,
        actor_kind     TEXT    NOT NULL
                               CHECK (actor_kind IN ('operator', 'member', 'system', 'integration')),
        -- A constant a programmer chose ('cloud:stripe-webhook'), never request text.
        actor_label    TEXT    CHECK (actor_label IS NULL OR length(actor_label) <= 80),
        action         TEXT    NOT NULL CHECK (length(action) BETWEEN 1 AND 80),
        subject_type   TEXT    NOT NULL
                               CHECK (subject_type IN ('client', 'account', 'invitation', 'event',
                                                       'photo', 'report', 'access_request')),
        subject_id     TEXT    NOT NULL CHECK (length(subject_id) BETWEEN 1 AND 64),
        -- No REFERENCES: the history of a deleted client survives it.
        client_id      TEXT,
        details        TEXT    NOT NULL DEFAULT '{}'
                               CHECK (json_valid(details) AND json_type(details) = 'object')
      );

      CREATE INDEX IF NOT EXISTS idx_audit_client ON audit_log (client_id, seq);

      -- ------------------------------------------------------------ the retention gate --
      CREATE TABLE IF NOT EXISTS audit_prune_gate (
        id    INTEGER PRIMARY KEY CHECK (id = 1),
        open  INTEGER NOT NULL DEFAULT 0 CHECK (open IN (0, 1))
      );

      INSERT OR IGNORE INTO audit_prune_gate (id, open) VALUES (1, 0);

      -- -------------------------------------------------------------- append-only --
      -- The ON DELETE SET NULL of the foreign key is itself an UPDATE, so this is the one
      -- UPDATE that must be allowed: actor_user_id to NULL, nothing else moving, and the
      -- account no longer there (the parent row is already gone when the action runs).
      CREATE TRIGGER IF NOT EXISTS audit_log_no_update
        BEFORE UPDATE ON audit_log
        WHEN NOT (    old.actor_user_id IS NOT NULL
                  AND new.actor_user_id IS NULL
                  AND NOT EXISTS (SELECT 1 FROM users WHERE id = old.actor_user_id)
                  AND new.seq = old.seq
                  AND new.at = old.at
                  AND new.actor_kind = old.actor_kind
                  AND new.actor_label IS old.actor_label
                  AND new.action = old.action
                  AND new.subject_type = old.subject_type
                  AND new.subject_id = old.subject_id
                  AND new.client_id IS old.client_id
                  AND new.details = old.details)
      BEGIN
        SELECT RAISE(ABORT, 'audit_log is append-only');
      END;

      CREATE TRIGGER IF NOT EXISTS audit_log_no_delete
        BEFORE DELETE ON audit_log
        WHEN (SELECT open FROM audit_prune_gate WHERE id = 1) IS NOT 1
      BEGIN
        SELECT RAISE(ABORT, 'audit_log rows are deleted only by the retention sweep');
      END;

      -- INSERT OR REPLACE deletes the row it replaces without firing delete triggers
      -- (recursive_triggers is off), so a conflicting seq is refused before it gets there.
      CREATE TRIGGER IF NOT EXISTS audit_log_no_overwrite
        BEFORE INSERT ON audit_log
        WHEN EXISTS (SELECT 1 FROM audit_log WHERE seq = new.seq)
      BEGIN
        SELECT RAISE(ABORT, 'audit_log rows are never overwritten');
      END;

      -- A missing gate row would read as "closed" for ever: nothing could prune the log.
      CREATE TRIGGER IF NOT EXISTS audit_prune_gate_permanent
        BEFORE DELETE ON audit_prune_gate
      BEGIN
        SELECT RAISE(ABORT, 'audit_prune_gate is permanent');
      END;
  `,
}
