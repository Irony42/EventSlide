---
name: eventslide-migration
description: Recipe for changing the SQLite schema — writing an append-only numbered migration, indexes and constraints, backfilling data, updating the repository and its contract tests, and the rules that keep an event's photos safe. Use whenever a table, column, index, or constraint changes.
---

# Database migrations

SQLite, accessed through `better-sqlite3` (synchronous, real transactions, `:memory:`
for tests). Migrations live in `src/infrastructure/db/migrations/` and are
**append-only**.

```
src/infrastructure/db/
  connection.ts        opens the DB, sets pragmas
  migrator.ts          discovers, orders, applies, records
  migrations/
    001_initial_schema.ts
    002_photo_perceptual_hash.ts
    index.ts           explicit ordered array — no glob, order must be deterministic
```

## The one rule

**Never edit a migration that exists on `main`.** Someone's wedding album lives in a
database that already applied it. Editing it means their schema and yours silently
diverge, and nothing tells you. Add `00N_fix_….ts` instead.

The migrator records each applied migration by number and by a **checksum of its SQL**.
On startup it refuses to run if a recorded migration's checksum has changed. That is a
deliberate hard failure, not an inconvenience to work around.

## Writing one

```ts
// src/infrastructure/db/migrations/002_photo_perceptual_hash.ts
import type { Migration } from '../migrator'

export const migration002: Migration = {
  id: 2,
  name: 'photo_perceptual_hash',
  up: (db) => {
    db.exec(`
      ALTER TABLE photos ADD COLUMN perceptual_hash TEXT;

      -- Partial index: near-duplicate detection only ever queries hashed rows,
      -- and the index stays small on an event with tens of thousands of photos.
      CREATE INDEX IF NOT EXISTS idx_photos_phash
        ON photos (event_id, perceptual_hash)
        WHERE perceptual_hash IS NOT NULL;
    `)
  },
}
```

- `id` is the next integer. No gaps, no reuse.
- `name` is `snake_case` and describes the change.
- The migrator wraps `up` in a transaction and applies migrations in `id` order.
- Every migration is **idempotent-safe** to re-run against a fresh DB
  (`IF NOT EXISTS`), so tests and first boot behave identically.
- Register it in `migrations/index.ts`. The explicit array is the ordering contract.

There is **no `down`**. Rollback of a schema change on a live album is a data-loss
operation dressed up as a safety feature; a forward fix migration is honest. Restore
from backup if you truly need to go back.

## SQLite specifics that will bite you

- `ALTER TABLE` supports only add-column, rename-column, rename-table, drop-column.
  For anything else use the **12-step dance**: create `photos_new`, copy, drop old,
  rename. Do it inside the transaction the migrator already provides, and never with
  `PRAGMA foreign_keys` on mid-copy.
- `ALTER TABLE … ADD COLUMN` cannot add a `NOT NULL` column without a constant
  default. Add nullable → backfill → enforce in the domain, or rebuild the table.
- **`PRAGMA foreign_keys = ON` is per-connection**, set in `connection.ts`. Foreign
  keys are silently ignored without it — including the `ON DELETE CASCADE` that makes
  event deletion safe.
- WAL mode is set once in `connection.ts`. Do not set journal pragmas in a migration.
- SQLite has no native boolean or date type: `INTEGER 0/1`, and timestamps as
  **ISO-8601 UTC `TEXT`** (sorts lexicographically, readable in a dump, no timezone
  ambiguity). Be consistent — mixed epoch/ISO columns are a bug source.
- `TEXT` comparison is case-sensitive by default. Slugs and join codes are stored
  already-normalised (lowercase slug, uppercase join code) rather than relying on
  `COLLATE NOCASE`, so the index is usable.

## Schema conventions

- Table names plural `snake_case`; column names `snake_case`. Mapping to camelCase
  domain fields happens in the repository, nowhere else.
- Primary keys are application-generated opaque ids (`TEXT`), never `AUTOINCREMENT` —
  ids appear in URLs and must not enumerate.
- Every event-scoped table carries `event_id TEXT NOT NULL REFERENCES events(id) ON
DELETE CASCADE`. That cascade is what makes "delete this event and everything in it"
  correct and atomic.
- Every event-scoped table has an index **leading with `event_id`**, because every
  query filters on it:
  ```sql
  CREATE INDEX idx_photos_event_status_created
    ON photos (event_id, status, created_at DESC);
  ```
- `created_at TEXT NOT NULL` everywhere. `updated_at` where it is actually read.
- Uniqueness is enforced in the database, not only in code:
  ```sql
  CREATE UNIQUE INDEX idx_events_slug      ON events (slug);
  CREATE UNIQUE INDEX idx_events_join_code ON events (join_code);
  CREATE UNIQUE INDEX idx_photos_event_hash ON photos (event_id, content_hash);
  ```
  The last one makes a double-tapped upload a no-op instead of a duplicate slide.
- Use `CHECK` constraints for closed enums (`status IN ('pending','published',
'rejected','hidden')`). The domain validates too — defence in depth, and it documents
  the column.

## Repository and tests

A schema change is not done until:

1. The repository maps the new column both ways (row → domain, domain → row).
2. The **port contract suite** covers the new behaviour
   (`src/application/testing/contracts/`), so the fake and SQLite are both verified.
3. The fake in `src/application/testing/` implements it.
4. A migration test asserts the shape after migrating a fresh `:memory:` DB:

```ts
it('adds the perceptual hash column and its partial index', () => {
  const db = migratedDatabase() // in-memory, all migrations applied
  const columns = db.prepare(`PRAGMA table_info(photos)`).all()
  expect(columns.map((c) => c.name)).toContain('perceptual_hash')

  const indexes = db.prepare(`PRAGMA index_list(photos)`).all()
  expect(indexes.map((i) => i.name)).toContain('idx_photos_phash')
})
```

5. An **upgrade-path test** applies migrations 1…N-1, inserts a realistic row, then
   applies N and asserts the old row survived intact. This is the test that catches a
   table rebuild that silently drops data — the failure mode that loses a customer's
   album.

## Backfills

- Data backfill goes in the **same migration** as the schema change, inside the same
  transaction, so a partially-migrated database cannot exist.
- Expensive backfills (re-hashing every photo, regenerating thumbnails) are **not**
  migrations. Ship a nullable column plus a `npm run db:backfill:<name>` script that is
  resumable and batched, and have the code tolerate `NULL` until it completes.
- Never call `sharp`, the network, or the filesystem from a migration. Migrations touch
  the database only.

## Checklist

- [ ] New file, next `id`, registered in `migrations/index.ts`.
- [ ] No existing migration modified.
- [ ] `IF NOT EXISTS` / additive; safe on a fresh database.
- [ ] `event_id` FK with `ON DELETE CASCADE` on any event-scoped table.
- [ ] Index leading with `event_id` for every query path added.
- [ ] Uniqueness and `CHECK` constraints in the schema, not only in the domain.
- [ ] Timestamps as ISO-8601 UTC `TEXT`.
- [ ] Repository mapping updated both directions.
- [ ] Port contract case added; fake updated; both implementations green.
- [ ] Migration shape test **and** upgrade-path test with a realistic pre-existing row.
- [ ] `npm run db:status` shows it pending, then applied.
