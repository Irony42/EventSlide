import { describe, expect, it } from 'vitest'
import { closeDatabase, openDatabase, type Db } from './connection'
import { MigrationError, migrate, status, type Migration } from './migrator'
import { migrations } from './migrations'

const freshDb = (): Db => openDatabase({ path: ':memory:' })

/**
 * Records the order migrations ran in, in the database itself.
 *
 * A migration is a SQL string, so it cannot push to an array in the test's scope — and
 * that makes for a better test: what the migrator promises is that these statements
 * reached SQLite in id order, and `rowid` is the database's own record of it.
 */
const marks = (n: number): string =>
  `CREATE TABLE IF NOT EXISTS applied_order (n INTEGER); INSERT INTO applied_order (n) VALUES (${n})`

const orderApplied = (db: Db): number[] =>
  (db.prepare(`SELECT n FROM applied_order ORDER BY rowid`).all() as { n: number }[]).map(
    (row) => row.n,
  )

const tableNames = (db: Db): string[] =>
  (
    db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all() as {
      name: string
    }[]
  ).map((row) => row.name)

const indexNames = (db: Db): string[] =>
  (
    db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%' ORDER BY name`,
      )
      .all() as { name: string }[]
  ).map((row) => row.name)

describe('migrator', () => {
  it('applies every pending migration in id order', () => {
    const db = freshDb()
    const applied = migrate(db, [
      { id: 2, name: 'second', sql: marks(2) },
      { id: 1, name: 'first', sql: marks(1) },
    ])

    expect(orderApplied(db)).toEqual([1, 2])
    expect(applied).toEqual([1, 2])
    closeDatabase(db)
  })

  it('is idempotent: a second run applies nothing', () => {
    const db = freshDb()
    const list: Migration[] = [{ id: 1, name: 'once', sql: marks(1) }]

    migrate(db, list)
    const second = migrate(db, list)

    expect(orderApplied(db)).toEqual([1])
    expect(second).toEqual([])
    closeDatabase(db)
  })

  it('rolls the whole migration back when its body throws', () => {
    const db = freshDb()
    const failing: Migration[] = [
      {
        id: 1,
        name: 'half_applied',
        // A valid statement, then one SQLite refuses: the first must not survive the
        // second, which is the whole point of the per-migration transaction.
        sql: `CREATE TABLE should_not_survive (a TEXT); CREATE TABLE (`,
      },
    ]

    expect(() => migrate(db, failing)).toThrow(MigrationError)
    // The table created before the throw must be gone, and the ledger must not
    // record the migration — otherwise a retry would skip it and leave the schema
    // permanently half-built.
    expect(tableNames(db)).not.toContain('should_not_survive')
    expect(status(db, failing).pending.map((row) => row.id)).toEqual([1])
    closeDatabase(db)
  })

  it('names the migration in the failure, and says what SQLite objected to', () => {
    const db = freshDb()
    const failing: Migration[] = [
      {
        id: 1,
        name: 'bad_syntax',
        sql: `CREATE TABLE (`,
      },
    ]

    // The operator runs this from a terminal during an upgrade. The id is what tells
    // them which migration to look at, and SQLite's own words are what tell them why.
    // Since a migration is SQL, the only thing that can raise here is the driver, and it
    // always raises an `Error` — so the `String(cause)` arm in the migrator is defensive
    // and not reachable through this surface.
    expect(() => migrate(db, failing)).toThrow(/Migration 1 \(bad_syntax\).*syntax error/s)
    closeDatabase(db)
  })

  it('refuses to run when an already-applied migration has been edited', () => {
    const db = freshDb()
    migrate(db, [{ id: 1, name: 'original', sql: `SELECT 1` }])

    // Same id and name, different body: exactly the mistake that silently diverges
    // the schema of an installation that already ran the first version.
    expect(() => migrate(db, [{ id: 1, name: 'original', sql: `SELECT 2` }])).toThrow(/append-only/)
    closeDatabase(db)
  })

  it('refuses to run against a database migrated by a newer build', () => {
    const db = freshDb()
    migrate(db, [
      { id: 1, name: 'known', sql: `SELECT 1` },
      { id: 2, name: 'from_the_future', sql: `SELECT 1` },
    ])

    expect(() => migrate(db, [{ id: 1, name: 'known', sql: `SELECT 1` }])).toThrow(/newer version/)
    closeDatabase(db)
  })

  it('rejects a duplicate migration id', () => {
    const db = freshDb()
    expect(() =>
      migrate(db, [
        { id: 1, name: 'a', sql: `SELECT 1` },
        { id: 1, name: 'b', sql: `SELECT 1` },
      ]),
    ).toThrow(/Duplicate migration id 1/)
    closeDatabase(db)
  })

  it.each([0, -1, 1.5])('rejects the invalid migration id %s', (id) => {
    const db = freshDb()
    expect(() => migrate(db, [{ id, name: 'bad', sql: `SELECT 1` }])).toThrow(/positive integer/)
    closeDatabase(db)
  })

  it('reports applied and pending separately', () => {
    const db = freshDb()
    const list: Migration[] = [
      { id: 1, name: 'one', sql: `SELECT 1` },
      { id: 2, name: 'two', sql: `SELECT 1` },
    ]
    migrate(db, [list[0]!])

    const report = status(db, list)

    expect(report.applied.map((row) => row.name)).toEqual(['one'])
    expect(report.pending.map((row) => row.name)).toEqual(['two'])
    expect(report.applied[0]?.appliedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    closeDatabase(db)
  })
})

describe('the real schema', () => {
  it('creates every table the application needs', () => {
    const db = freshDb()
    migrate(db, migrations)

    expect(tableNames(db)).toEqual([
      'clip_jobs',
      'event_memberships',
      'events',
      'guests',
      'photos',
      'reactions',
      'schema_migrations',
      'sessions',
      'users',
    ])
    closeDatabase(db)
  })

  it('indexes every event-scoped query path', () => {
    const db = freshDb()
    migrate(db, migrations)

    expect(indexNames(db)).toEqual(
      expect.arrayContaining([
        'idx_events_join_code',
        'idx_events_slug',
        'idx_guests_event_seen',
        'idx_photos_event_author',
        'idx_photos_event_hash',
        'idx_photos_event_status_created',
        'idx_reactions_guest_recent',
        'idx_reactions_unique',
        'idx_sessions_expires',
        'idx_users_email',
      ]),
    )
    closeDatabase(db)
  })

  it('enforces foreign keys on the connection, which is what makes the cascade real', () => {
    const db = freshDb()
    migrate(db, migrations)

    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(() =>
      db
        .prepare(
          `INSERT INTO guests (id, event_id, joined_at, last_seen_at)
           VALUES ('g1', 'no-such-event', '2026-06-20T21:00:00.000Z', '2026-06-20T21:00:00.000Z')`,
        )
        .run(),
    ).toThrow(/FOREIGN KEY/)
    closeDatabase(db)
  })
})

describe('migration 002, the scheduled opening and closing', () => {
  const columnNames = (db: Db, table: string): string[] =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((row) => row.name)

  /** An event as 001 alone could hold it: a start date for the dashboard, nothing more. */
  const seedPreSchedule = (db: Db): void => {
    db.prepare(
      `INSERT INTO users (id, email, password_hash, created_at)
            VALUES ('u1', 'hote@example.test', 'hash:x', '2026-06-20T09:00:00.000Z')`,
    ).run()
    db.prepare(
      `INSERT INTO events (id, owner_id, name, slug, join_code, status, settings,
                           quota_bytes, created_at, starts_at, closed_at)
            VALUES ('e1', 'u1', 'Camille & Sacha', 'camille-et-sacha', 'H7K2QM', 'live',
                    '{"moderation":"manual"}', 1000, '2026-06-20T09:00:00.000Z',
                    '2026-06-20T17:00:00.000Z', NULL)`,
    ).run()
  }

  it('adds the two schedule columns and the notice column beside them', () => {
    const db = freshDb()
    migrate(db, migrations)

    expect(columnNames(db, 'events')).toEqual(
      expect.arrayContaining(['scheduled_open_at', 'scheduled_close_at', 'schedule_discarded_at']),
    )
    closeDatabase(db)
  })

  it('indexes the sweep, which is the one query in the product not scoped to an event', () => {
    const db = freshDb()
    migrate(db, migrations)

    expect(indexNames(db)).toEqual(
      expect.arrayContaining(['idx_events_scheduled_open', 'idx_events_scheduled_close']),
    )
    closeDatabase(db)
  })

  it('keeps an event that existed before the schedule did, and leaves it unscheduled', () => {
    // The upgrade path, on somebody's wedding album. A `starts_at` this migration
    // deliberately does not touch must come through untouched, and the event must not
    // acquire a timer nobody asked for.
    const db = freshDb()
    migrate(
      db,
      migrations.filter((migration) => migration.id < 2),
    )
    seedPreSchedule(db)

    migrate(db, migrations)

    expect(
      db
        .prepare(
          `SELECT name, status, starts_at, scheduled_open_at, scheduled_close_at,
                  schedule_discarded_at
             FROM events WHERE id = 'e1'`,
        )
        .get(),
    ).toEqual({
      name: 'Camille & Sacha',
      status: 'live',
      starts_at: '2026-06-20T17:00:00.000Z',
      scheduled_open_at: null,
      scheduled_close_at: null,
      schedule_discarded_at: null,
    })
    closeDatabase(db)
  })
})
