import { describe, expect, it } from 'vitest'
import { closeDatabase, openDatabase, type Db } from './connection'
import { MigrationError, migrate, status, type Migration } from './migrator'
import { migrations } from './migrations'

const freshDb = (): Db => openDatabase({ path: ':memory:' })

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
    const order: number[] = []
    const applied = migrate(db, [
      { id: 2, name: 'second', up: () => void order.push(2) },
      { id: 1, name: 'first', up: () => void order.push(1) },
    ])

    expect(order).toEqual([1, 2])
    expect(applied).toEqual([1, 2])
    closeDatabase(db)
  })

  it('is idempotent: a second run applies nothing', () => {
    const db = freshDb()
    let runs = 0
    const list: Migration[] = [{ id: 1, name: 'once', up: () => void runs++ }]

    migrate(db, list)
    const second = migrate(db, list)

    expect(runs).toBe(1)
    expect(second).toEqual([])
    closeDatabase(db)
  })

  it('rolls the whole migration back when its body throws', () => {
    const db = freshDb()
    const failing: Migration[] = [
      {
        id: 1,
        name: 'half_applied',
        up: (inner) => {
          inner.exec(`CREATE TABLE should_not_survive (a TEXT)`)
          throw new Error('boom')
        },
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

  it('refuses to run when an already-applied migration has been edited', () => {
    const db = freshDb()
    migrate(db, [{ id: 1, name: 'original', up: (inner) => inner.exec(`SELECT 1`) }])

    // Same id and name, different body: exactly the mistake that silently diverges
    // the schema of an installation that already ran the first version.
    expect(() =>
      migrate(db, [{ id: 1, name: 'original', up: (inner) => inner.exec(`SELECT 2`) }]),
    ).toThrow(/append-only/)
    closeDatabase(db)
  })

  it('refuses to run against a database migrated by a newer build', () => {
    const db = freshDb()
    migrate(db, [
      { id: 1, name: 'known', up: (inner) => inner.exec(`SELECT 1`) },
      { id: 2, name: 'from_the_future', up: (inner) => inner.exec(`SELECT 1`) },
    ])

    expect(() =>
      migrate(db, [{ id: 1, name: 'known', up: (inner) => inner.exec(`SELECT 1`) }]),
    ).toThrow(/newer version/)
    closeDatabase(db)
  })

  it('rejects a duplicate migration id', () => {
    const db = freshDb()
    expect(() =>
      migrate(db, [
        { id: 1, name: 'a', up: () => {} },
        { id: 1, name: 'b', up: () => {} },
      ]),
    ).toThrow(/Duplicate migration id 1/)
    closeDatabase(db)
  })

  it.each([0, -1, 1.5])('rejects the invalid migration id %s', (id) => {
    const db = freshDb()
    expect(() => migrate(db, [{ id, name: 'bad', up: () => {} }])).toThrow(/positive integer/)
    closeDatabase(db)
  })

  it('reports applied and pending separately', () => {
    const db = freshDb()
    const list: Migration[] = [
      { id: 1, name: 'one', up: (inner) => inner.exec(`SELECT 1`) },
      { id: 2, name: 'two', up: (inner) => inner.exec(`SELECT 1`) },
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
