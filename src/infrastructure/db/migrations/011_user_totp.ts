import type { Migration } from '../migrator'

/**
 * The operator's second factor (docs/ROADMAP.md §10.1; free plan G2-13, paid plan P3-15).
 *
 * ## `user_totp` — one authenticator per account
 *
 * - **`secret_enc`, never the secret.** AES-256-GCM under `MFA_ENCRYPTION_KEY`, written as
 *   `iv.tag.ciphertext` in base64url. A backup archive, or a restore rehearsed on a laptop,
 *   clones no authenticator. The `CHECK` refuses the likeliest mistake — a caller writing the
 *   base32 secret itself, which has no `.` in it — by requiring exactly two.
 * - **`key_version`** says which key sealed the row, so rotating `MFA_ENCRYPTION_KEY` is a
 *   re-seal of the rows that name an old version and not a flag day.
 * - **`confirmed_at` is the whole state machine.** A row with it `NULL` is a secret that was
 *   shown on screen and never proven: the account is **not** enrolled, signs in as it always
 *   did, and the next enrolment attempt replaces the row. Only a confirmed row asks for a code.
 * - **`last_used_step`** is the replay refusal. The step of the last accepted code is stored,
 *   and a code is accepted only for a step strictly later — one conditional `UPDATE`, so two
 *   requests carrying one code cannot both win. The `CHECK` ties it to a confirmed row.
 * - **Cascades from `users`.** An account that is deleted takes its authenticator with it.
 *
 * ## `user_recovery_codes` — what is left when the phone is gone
 *
 * - **`code_digest`, never the code.** SHA-256 of the canonical code as lower-case hex, the
 *   same construction as `account_tokens`; the `CHECK` has the same shape and refuses the
 *   same mistake.
 * - **It references `user_totp`, not `users`.** A recovery code means something only beside a
 *   factor, so removing the factor removes them in the same statement, and the table cannot
 *   hold codes for an account that is not enrolled.
 * - **`used_at`** makes a code single-use; the row is kept, not deleted, so a regenerated set
 *   and a spent one are not confused and the count of what remains is a query, not a guess.
 */
export const migration011: Migration = {
  id: 11,
  name: 'user_totp',
  sql: `
      CREATE TABLE IF NOT EXISTS user_totp (
        user_id        TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,

        -- iv.tag.ciphertext, base64url: exactly two dots, which no base32 secret has.
        secret_enc     TEXT NOT NULL
                       CHECK (length(secret_enc) - length(replace(secret_enc, '.', '')) = 2
                              AND secret_enc NOT GLOB '*[^A-Za-z0-9_.-]*'),
        key_version    INTEGER NOT NULL DEFAULT 1 CHECK (key_version >= 1),
        created_at     TEXT NOT NULL,
        confirmed_at   TEXT,
        last_used_step INTEGER CHECK (last_used_step IS NULL OR last_used_step >= 0),

        CHECK (last_used_step IS NULL OR confirmed_at IS NOT NULL)
      );

      CREATE TABLE IF NOT EXISTS user_recovery_codes (
        user_id     TEXT NOT NULL REFERENCES user_totp (user_id) ON DELETE CASCADE,

        -- SHA-256 of the canonical code, lower-case hex.
        code_digest TEXT NOT NULL
                    CHECK (length(code_digest) = 64
                           AND code_digest NOT GLOB '*[^0-9a-f]*'),
        used_at     TEXT,

        PRIMARY KEY (user_id, code_digest)
      );
  `,
}
