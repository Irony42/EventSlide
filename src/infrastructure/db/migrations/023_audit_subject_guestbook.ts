import type { Migration } from '../migrator'

/**
 * A new subject type for the audit log: `guestbook` (spec 01, PR 6, the operator's take-down
 * of one guestbook message by its id).
 *
 * `audit_log.subject_type` is a `CHECK` list, and widening one in SQLite means rebuilding the
 * table (migration 009 says as much, and chose its list wide to avoid exactly this; a guestbook
 * message was not in it). The rebuild is done the careful way, because this table's triggers
 * refuse every rewrite:
 *
 * 1. the three triggers and the two indexes are dropped first (they would otherwise follow the
 *    table through the rename, or refuse the copy);
 * 2. the old table is renamed aside and the new one created, **identical to 009's except for the
 *    list**;
 * 3. every row is copied with its own `seq`, and the table's `AUTOINCREMENT` counter is carried
 *    over, so a `seq` that was pruned is never handed out again;
 * 4. the old table is dropped and the triggers and indexes are recreated, unchanged.
 *
 * `audit_prune_gate` is untouched. No row changes and none is added or lost: `migrator.test.ts`
 * checks the copy. Kept in one file so renumbering it after another migration lands is a two-line
 * change.
 */
export const migration023: Migration = {
  id: 23,
  name: 'audit_subject_guestbook',
  sql: `
      DROP TRIGGER IF EXISTS audit_log_no_update;
      DROP TRIGGER IF EXISTS audit_log_no_delete;
      DROP TRIGGER IF EXISTS audit_log_no_overwrite;
      DROP INDEX IF EXISTS idx_audit_client;
      DROP INDEX IF EXISTS idx_audit_actor_user;

      ALTER TABLE audit_log RENAME TO audit_log_before_023;

      CREATE TABLE audit_log (
        seq            INTEGER PRIMARY KEY AUTOINCREMENT CHECK (seq > 0),
        at             TEXT    NOT NULL,
        actor_user_id  TEXT    REFERENCES users (id) ON DELETE SET NULL,
        actor_kind     TEXT    NOT NULL
                               CHECK (actor_kind IN ('operator', 'member', 'system', 'integration')),
        actor_label    TEXT    CHECK (actor_label IS NULL OR length(actor_label) <= 80),
        action         TEXT    NOT NULL CHECK (length(action) BETWEEN 1 AND 80),
        subject_type   TEXT    NOT NULL
                               CHECK (subject_type IN ('client', 'account', 'invitation', 'event',
                                                       'photo', 'report', 'access_request',
                                                       'guestbook')),
        subject_id     TEXT    NOT NULL CHECK (length(subject_id) BETWEEN 1 AND 64),
        client_id      TEXT,
        details        TEXT    NOT NULL DEFAULT '{}'
                               CHECK (json_valid(details) AND json_type(details) = 'object')
      );

      INSERT INTO audit_log (seq, at, actor_user_id, actor_kind, actor_label, action, subject_type,
                             subject_id, client_id, details)
        SELECT seq, at, actor_user_id, actor_kind, actor_label, action, subject_type,
               subject_id, client_id, details
          FROM audit_log_before_023
         ORDER BY seq;

      -- AUTOINCREMENT never reuses a seq, even one pruned from the top: carry the old counter over.
      UPDATE sqlite_sequence
         SET seq = MAX(seq, COALESCE((SELECT seq FROM sqlite_sequence
                                       WHERE name = 'audit_log_before_023'), 0))
       WHERE name = 'audit_log';

      DROP TABLE audit_log_before_023;

      CREATE INDEX idx_audit_client ON audit_log (client_id, seq);

      CREATE INDEX idx_audit_actor_user
        ON audit_log (actor_user_id)
        WHERE actor_user_id IS NOT NULL;

      CREATE TRIGGER audit_log_no_update
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

      CREATE TRIGGER audit_log_no_delete
        BEFORE DELETE ON audit_log
        WHEN (SELECT open FROM audit_prune_gate WHERE id = 1) IS NOT 1
      BEGIN
        SELECT RAISE(ABORT, 'audit_log rows are deleted only by the retention sweep');
      END;

      CREATE TRIGGER audit_log_no_overwrite
        BEFORE INSERT ON audit_log
        WHEN EXISTS (SELECT 1 FROM audit_log WHERE seq = new.seq)
      BEGIN
        SELECT RAISE(ABORT, 'audit_log rows are never overwritten');
      END;
  `,
}
