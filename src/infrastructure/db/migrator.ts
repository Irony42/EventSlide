import { createHash } from 'node:crypto'
import type { Db } from './connection'

/**
 * Append-only, numbered, checksummed migrations.
 *
 * There is no `down`. Rolling a schema change back on a live album is a data-loss
 * operation dressed up as a safety feature; a forward fix migration is honest, and a
 * restore from backup is what actually recovers. See
 * `.claude/skills/eventslide-migration/SKILL.md`.
 */

export interface Migration {
  /** Next integer. No gaps, no reuse. */
  readonly id: number
  /** `snake_case`, describes the change. */
  readonly name: string
  /**
   * The SQL this migration applies, run inside a transaction the migrator opens. Must
   * be safe against a fresh database (use `IF NOT EXISTS`), so first boot and a test's
   * `:memory:` database behave identically.
   *
   * A string rather than a `(db) => void`, because the ledger's checksum is taken over
   * it. Hashing a function meant hashing `Function.prototype.toString()`, which is its
   * *source text* — and that differs between the TypeScript source `tsx` runs and the
   * JavaScript `tsc` emits, even though the SQL inside is identical. So the migration
   * applied by `npm run db:migrate` never matched the one the built server verified at
   * boot, and the documented install sequence — migrate, build, start — failed on the
   * last step with "Migration 1 has changed since it was applied". Hashing the SQL
   * hashes exactly what reached the database, which is what the ledger is for.
   */
  readonly sql: string
}

export interface AppliedMigration {
  readonly id: number
  readonly name: string
  readonly checksum: string
  readonly appliedAt: string
}

export interface MigrationStatus {
  readonly applied: readonly AppliedMigration[]
  readonly pending: readonly { readonly id: number; readonly name: string }[]
}

export class MigrationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MigrationError'
  }
}

const LEDGER = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    checksum    TEXT NOT NULL,
    applied_at  TEXT NOT NULL
  )
`

/**
 * Fingerprint of what a migration does.
 *
 * Over the SQL itself, so it is the same whether the migration is loaded from
 * TypeScript source or from the compiled output — see `Migration.sql` for why that
 * mattered. Still coarse: reformatting the SQL changes the checksum. That is the right
 * trade, because it catches the failure the ledger exists to catch — someone edits a
 * migration that has already run somewhere, and two databases silently diverge with
 * nothing to reveal it.
 */
export const checksumOf = (migration: Migration): string =>
  createHash('sha256')
    .update(`${migration.id}:${migration.name}:${migration.sql}`)
    .digest('hex')
    .slice(0, 32)

const readLedger = (db: Db): AppliedMigration[] => {
  db.exec(LEDGER)
  return db
    .prepare(
      `SELECT id, name, checksum, applied_at AS appliedAt
         FROM schema_migrations
        ORDER BY id`,
    )
    .all() as AppliedMigration[]
}

const assertWellFormed = (migrations: readonly Migration[]): void => {
  const seen = new Set<number>()
  for (const migration of migrations) {
    if (!Number.isInteger(migration.id) || migration.id < 1) {
      throw new MigrationError(`Migration id must be a positive integer, got ${migration.id}`)
    }
    if (seen.has(migration.id)) {
      throw new MigrationError(`Duplicate migration id ${migration.id}`)
    }
    seen.add(migration.id)
  }
}

const ordered = (migrations: readonly Migration[]): readonly Migration[] =>
  [...migrations].sort((a, b) => a.id - b.id)

/**
 * Applies every pending migration in id order, each in its own transaction.
 *
 * Refuses to proceed — loudly, before touching anything — if a migration already
 * recorded in the ledger has a different checksum, or if the ledger contains an id the
 * code no longer knows about (a database migrated by a newer build).
 */
export const migrate = (db: Db, migrations: readonly Migration[]): readonly number[] => {
  assertWellFormed(migrations)
  const all = ordered(migrations)
  const applied = readLedger(db)
  const appliedById = new Map(applied.map((row) => [row.id, row]))
  const knownIds = new Set(all.map((migration) => migration.id))

  for (const row of applied) {
    if (!knownIds.has(row.id)) {
      throw new MigrationError(
        `The database has migration ${row.id} (${row.name}) applied, but this build does not ` +
          `know it. This database was migrated by a newer version of EventSlide; downgrading ` +
          `is not supported.`,
      )
    }
  }

  for (const migration of all) {
    const record = appliedById.get(migration.id)
    if (record && record.checksum !== checksumOf(migration)) {
      throw new MigrationError(
        `Migration ${migration.id} (${migration.name}) has changed since it was applied on ` +
          `${record.appliedAt}. Migrations are append-only: add a new one instead of editing ` +
          `this one, or the schema of existing installations no longer matches the code.`,
      )
    }
  }

  const record = db.prepare(
    `INSERT INTO schema_migrations (id, name, checksum, applied_at) VALUES (?, ?, ?, ?)`,
  )

  const justApplied: number[] = []
  for (const migration of all) {
    if (appliedById.has(migration.id)) continue

    // One transaction per migration: the schema change and any backfill inside it
    // either both land or neither does, so a partially-migrated database cannot exist.
    const run = db.transaction(() => {
      db.exec(migration.sql)
      record.run(migration.id, migration.name, checksumOf(migration), new Date().toISOString())
    })

    try {
      run()
    } catch (cause) {
      throw new MigrationError(
        `Migration ${migration.id} (${migration.name}) failed and was rolled back: ` +
          `${cause instanceof Error ? cause.message : String(cause)}`,
      )
    }
    justApplied.push(migration.id)
  }

  return justApplied
}

/** Powers `npm run db:status`. Read-only. */
export const status = (db: Db, migrations: readonly Migration[]): MigrationStatus => {
  assertWellFormed(migrations)
  const applied = readLedger(db)
  const appliedIds = new Set(applied.map((row) => row.id))

  return {
    applied,
    pending: ordered(migrations)
      .filter((migration) => !appliedIds.has(migration.id))
      .map((migration) => ({ id: migration.id, name: migration.name })),
  }
}
