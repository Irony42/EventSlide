import type { Migration } from '../migrator'

/**
 * Proof that an account accepted the terms of use, kept for as long as the account lives
 * (legal alignment; G2-20 followed up).
 *
 * Accepting an invitation on a box that asks for terms already wrote the audit entry
 * `account.termsAccepted {version}`. That entry is pruned with the rest of the log
 * (`AUDIT_RETENTION_DAYS`, 365 days by default), so an account that outlived it had no proof
 * of what it agreed to. These two columns carry **the latest acceptance** of the account: the
 * version (`LEGAL_TERMS_VERSION` as it was) and the instant. They go with the account when it is
 * deleted, which is the erasure, and are never read as a requirement: nothing refuses a sign-in
 * because they are empty or old.
 *
 * `NULL` is "no acceptance on record": every account of a box that asks for no terms, and every
 * account that accepted before the box asked.
 *
 * **Backfill.** An account whose acceptance is still in the audit log gets its latest one copied
 * over, so the proof the log holds today is not lost the day it is pruned. The actor of that
 * entry is the account itself (`acceptInvitation` writes it so).
 */
export const migration015: Migration = {
  id: 15,
  name: 'user_terms_acceptance',
  sql: `
      ALTER TABLE users ADD COLUMN terms_version TEXT;
      ALTER TABLE users ADD COLUMN terms_accepted_at TEXT;

      UPDATE users
         SET terms_version = (SELECT json_extract(a.details, '$.version')
                                FROM audit_log a
                               WHERE a.actor_user_id = users.id AND a.action = 'account.termsAccepted'
                               ORDER BY a.seq DESC LIMIT 1),
             terms_accepted_at = (SELECT a.at
                                    FROM audit_log a
                                   WHERE a.actor_user_id = users.id AND a.action = 'account.termsAccepted'
                                   ORDER BY a.seq DESC LIMIT 1)
       WHERE EXISTS (SELECT 1 FROM audit_log a
                      WHERE a.actor_user_id = users.id AND a.action = 'account.termsAccepted');
    `,
}
