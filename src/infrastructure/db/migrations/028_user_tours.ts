import type { Migration } from '../migrator'

/**
 * The guided tours an account has been shown (the console's first-visit tours,
 * `domain/users/guidedTour.ts`).
 *
 * - **One row per account and tour**, the pair as primary key: marking a tour twice is a no-op,
 *   and the key leads with `user_id`, which is the lookup both reads and the cascade make.
 * - **`tour` is a closed vocabulary.** The `CHECK` holds the same list as `GUIDED_TOURS`. SQLite
 *   cannot alter a `CHECK`, so a new tour is a migration that rebuilds the table (copy, drop,
 *   rename); `seenBy` already ignores a row it does not know, so a rollback reads nothing wrong.
 * - **Cascades from `users`.** An account that is deleted takes what it was shown with it.
 */
export const migration028: Migration = {
  id: 28,
  name: 'user_tours',
  sql: `
      CREATE TABLE IF NOT EXISTS user_tours (
        user_id  TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
        tour     TEXT NOT NULL CHECK (tour IN ('eventPage')),
        seen_at  TEXT NOT NULL,

        PRIMARY KEY (user_id, tour)
      );
  `,
}
