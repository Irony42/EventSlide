import { describe, expect, it } from 'vitest'
import { closeDatabase, openDatabase, type Db } from './connection'
import { MigrationError, migrate, status, type Migration } from './migrator'
import { migrations } from './migrations'
import { BLOCKING_REUPLOAD_SQL, HOLDING_BYTES_SQL } from './clipJobStatusSql'
import { CLIP_JOB_STATUSES } from '../../domain/clips/clipJobStatus'

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
      'event_missions',
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
        'idx_event_missions_event',
        'idx_event_missions_event_prompt',
        'idx_events_join_code',
        'idx_events_slug',
        'idx_guests_event_seen',
        'idx_photos_event_author',
        'idx_photos_event_mission',
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

describe('migration 003, short video clips', () => {
  const columnNames = (db: Db, table: string): string[] =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((row) => row.name)

  /** One photograph, in an album as 002 alone could hold it: no clip columns anywhere. */
  const seedPreClips = (db: Db): void => {
    db.prepare(
      `INSERT INTO users (id, email, password_hash, created_at)
            VALUES ('u1', 'hote@example.test', 'hash:x', '2026-06-20T09:00:00.000Z')`,
    ).run()
    db.prepare(
      `INSERT INTO events (id, owner_id, name, slug, join_code, status, settings,
                           quota_bytes, created_at)
            VALUES ('e1', 'u1', 'Camille & Sacha', 'camille-et-sacha', 'H7K2QM', 'live',
                    '{"moderation":"manual"}', 1000, '2026-06-20T09:00:00.000Z')`,
    ).run()
    db.prepare(
      `INSERT INTO guests (id, event_id, joined_at, last_seen_at)
            VALUES ('g1', 'e1', '2026-06-20T21:00:00.000Z', '2026-06-20T21:00:00.000Z')`,
    ).run()
    db.prepare(
      `INSERT INTO photos (id, event_id, author_guest_id, status, content_hash, width, height,
                           byte_size, created_at)
            VALUES ('p1', 'e1', 'g1', 'published', '${'a'.repeat(64)}', 1200, 800, 90000,
                    '2026-06-20T21:05:00.000Z')`,
    ).run()
  }

  it('gives photos the three facet columns', () => {
    const db = freshDb()
    migrate(db, migrations)

    expect(columnNames(db, 'photos')).toEqual(
      expect.arrayContaining(['media_kind', 'duration_ms', 'poster_hash']),
    )
    closeDatabase(db)
  })

  it('creates the queue as a table of its own, because a transcoding clip is not a photo', () => {
    const db = freshDb()
    migrate(db, migrations)

    expect(tableNames(db)).toContain('clip_jobs')
    closeDatabase(db)
  })

  it('pins the frozen status literals in the schema to the predicates that define them', () => {
    // **One rule, three spellings, and only two of them can move.** The live queries are
    // rendered from `holdsStagedBytes` and `blocksReupload` (`clipJobStatusSql.ts`); the
    // migration's `CHECK` and partial indexes are append-only and carry frozen literals.
    // A sixth status added to the domain and to one predicate would otherwise be counted
    // by the quota and rejected by the CHECK, or blocked by the unique index and
    // invisible to the dedupe — and nothing would say so until a venue.
    //
    // Each object is read **separately**. Concatenating them and asking whether a status
    // appeared anywhere passed a schema whose index knew a status its `CHECK` did not,
    // which is the likeliest drift of the three: adding a status to a partial index is a
    // DROP/CREATE in a new migration, while changing a `CHECK` in SQLite needs a table
    // rebuild. The symptom would have been every write of such a row failing with
    // "CHECK constraint failed" at a venue, with this suite green.
    const db = freshDb()
    migrate(db, migrations)

    const ddlOf = (name: string): string => {
      const row = db
        .prepare<[string], { readonly sql: string }>(`SELECT sql FROM sqlite_master WHERE name = ?`)
        .get(name)
      if (row === undefined) throw new Error(`no schema object named ${name}`)
      return row.sql
    }

    // The status `CHECK` on the table itself, and nothing else in the DDL.
    const check = /CHECK \(status IN \(([^)]*)\)\)/.exec(ddlOf('clip_jobs'))
    expect(check).not.toBeNull()
    const admitted = (check?.[1] ?? '')
      .split(',')
      .map((part) => part.trim().replaceAll("'", ''))
      .filter((part) => part.length > 0)
      .sort()

    // Both directions: every status the domain has is admitted, and the column admits
    // nothing the domain has never heard of.
    expect(admitted).toEqual([...CLIP_JOB_STATUSES].sort())

    // The two partial indexes carry exactly the two predicates' sets, each asserted
    // against its own object.
    expect(ddlOf('idx_clip_jobs_event_source')).toContain(
      `WHERE status IN (${BLOCKING_REUPLOAD_SQL})`,
    )
    expect(ddlOf('idx_clip_jobs_active')).toContain(`WHERE status IN (${HOLDING_BYTES_SQL})`)
    closeDatabase(db)
  })

  it('creates every index the queue’s queries are written against', () => {
    const db = freshDb()
    migrate(db, migrations)

    expect(indexNames(db)).toEqual(
      expect.arrayContaining([
        'idx_clip_jobs_event_source',
        'idx_clip_jobs_due',
        'idx_clip_jobs_active',
        'idx_clip_jobs_running',
        'idx_clip_jobs_event_created',
        'idx_photos_event_poster',
      ]),
    )
    closeDatabase(db)
  })

  it('plans every queue query against an index rather than a table scan', () => {
    // Existence is not the property that matters — **use** is. An index the planner
    // declines to take is a row in `sqlite_master` and a full scan of every clip the
    // venue has ever accepted. That is exactly what happened when recovery was asked to
    // borrow the `status IN (...)` partial index: `SCAN clip_jobs`, plus a temp B-tree
    // for the ORDER BY, at every boot. So each of the five queries below is asserted by
    // its plan, in the shape the repository actually writes it.
    const db = freshDb()
    migrate(db, migrations)

    const planOf = (sql: string): string =>
      (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[])
        .map((row) => row.detail)
        .join('; ')

    // The retry on venue Wi-Fi. The status filter is in the query because the index is
    // partial: SQLite takes a partial index only when the query's WHERE implies the
    // index's, so dropping those three statuses here would silently turn this back into
    // a scan of every clip the venue has ever accepted.
    expect(
      planOf(
        `SELECT id FROM clip_jobs
          WHERE event_id = 'e1' AND source_hash = 'x'
            AND status IN ('reserved', 'queued', 'running', 'done')`,
      ),
    ).toContain('idx_clip_jobs_event_source')

    // And the shape that must **not** be written: the same query with the status filter
    // dropped. SQLite takes a partial index only when the query's WHERE implies the
    // index's, so this one cannot seek the digest at all — it falls back to the
    // event_id-led index and walks every clip that event has ever accepted. Asserting the
    // negative is what catches the next caller who writes it that way.
    expect(
      planOf(`SELECT id FROM clip_jobs WHERE event_id = 'e1' AND source_hash = 'x'`),
    ).not.toContain('idx_clip_jobs_event_source')

    // The worker asking what is due.
    expect(
      planOf(
        `SELECT id FROM clip_jobs
          WHERE status = 'queued' AND not_before <= '2026-06-20T21:00:00.000Z'
          ORDER BY not_before ASC, created_at ASC, id ASC
          LIMIT 1`,
      ),
    ).toContain('idx_clip_jobs_due')

    // Backpressure, on a guest's upload.
    expect(
      planOf(`SELECT COUNT(*) FROM clip_jobs WHERE status IN ('reserved', 'queued', 'running')`),
    ).toContain('idx_clip_jobs_active')

    // The quota's half over the queue, on the same request.
    expect(
      planOf(
        `SELECT SUM(source_byte_size) FROM clip_jobs
          WHERE event_id = 'e1' AND status IN ('reserved', 'queued', 'running')`,
      ),
    ).toContain('idx_clip_jobs_active')

    // "Who else names these bytes?", on every photo delete and every object the media
    // sweep considers. Two seeks rather than one `OR`, because SQLite will not take two
    // different indexes for an `OR` across two columns — it scanned the whole album.
    const referencing = planOf(
      `SELECT id FROM photos WHERE event_id = 'e1' AND content_hash = 'x'
        UNION
       SELECT id FROM photos WHERE event_id = 'e1' AND poster_hash = 'x'`,
    )
    expect(referencing).toContain('idx_photos_event_hash')
    expect(referencing).toContain('idx_photos_event_poster')
    expect(referencing).not.toContain('SCAN photos')

    // Crash recovery, at every boot. The ordering comes from the index rather than from
    // a temp B-tree, which is what `created_at` is doing in it.
    const recovery = planOf(
      `SELECT id FROM clip_jobs WHERE status = 'running' ORDER BY created_at ASC`,
    )
    expect(recovery).toContain('idx_clip_jobs_running')
    expect(recovery).not.toContain('TEMP B-TREE')
    expect(recovery).not.toContain('SCAN clip_jobs')
    closeDatabase(db)
  })

  it('refuses a queue row that names neither a guest nor a host', () => {
    // The same one-author rule `photos` carries. A job with no author is a job whose
    // clip nobody can be told about, and whose deletion follows nobody's erasure.
    const db = freshDb()
    migrate(db, migrations)
    seedPreClips(db)

    expect(() =>
      db
        .prepare(
          `INSERT INTO clip_jobs (id, event_id, photo_id, status, source_hash, source_byte_size,
                                  attempts, created_at, updated_at, not_before)
                VALUES ('c1', 'e1', 'p9', 'queued', '${'b'.repeat(64)}', 100, 0,
                        '2026-06-20T21:00:00.000Z', '2026-06-20T21:00:00.000Z',
                        '2026-06-20T21:00:00.000Z')`,
        )
        .run(),
    ).toThrow(/CHECK constraint failed: clip_jobs_one_author/)
    closeDatabase(db)
  })

  it('keeps a photograph that existed before clips did, and calls it a photograph', () => {
    // The upgrade path, on somebody's wedding album. `media_kind` has to arrive as
    // `'photo'` on every existing row with no backfill, or the mapper refuses a row that
    // carries half a clip facet and the album stops loading.
    const db = freshDb()
    migrate(
      db,
      migrations.filter((migration) => migration.id < 3),
    )
    seedPreClips(db)

    migrate(db, migrations)

    expect(
      db
        .prepare(
          `SELECT status, byte_size, media_kind, duration_ms, poster_hash
             FROM photos WHERE id = 'p1'`,
        )
        .get(),
    ).toEqual({
      status: 'published',
      byte_size: 90000,
      media_kind: 'photo',
      duration_ms: null,
      poster_hash: null,
    })
    closeDatabase(db)
  })
})

describe('migration 004, the site-level role', () => {
  const columnNames = (db: Db, table: string): string[] =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((row) => row.name)

  const siteRoles = (db: Db): { id: string; site_role: string }[] =>
    db.prepare(`SELECT id, site_role FROM users ORDER BY id`).all() as {
      id: string
      site_role: string
    }[]

  /**
   * A box that has been running since before any of this existed: the account the
   * bootstrap created, and a second one it invited afterwards.
   *
   * The insert order is deliberately the reverse of the creation order, because the
   * backfill must pick the oldest account rather than the first row SQLite happens to
   * return.
   */
  const seedPreSiteRole = (db: Db): void => {
    db.prepare(
      `INSERT INTO users (id, email, password_hash, created_at)
            VALUES ('u-invited', 'lea@example.test', 'hash:y', '2026-06-20T11:00:00.000Z')`,
    ).run()
    db.prepare(
      `INSERT INTO users (id, email, password_hash, created_at, last_login_at,
                          must_change_password)
            VALUES ('u-bootstrap', 'hote@example.test', 'hash:x', '2026-06-20T09:00:00.000Z',
                    '2026-06-20T10:00:00.000Z', 1)`,
    ).run()
  }

  it('adds the column, and an account created before it arrives as an ordinary one', () => {
    const db = freshDb()
    migrate(db, migrations)

    expect(columnNames(db, 'users')).toEqual(expect.arrayContaining(['site_role']))
    db.prepare(
      `INSERT INTO users (id, email, password_hash, created_at)
            VALUES ('u9', 'neuf@example.test', 'hash:z', '2026-06-20T09:00:00.000Z')`,
    ).run()

    expect(siteRoles(db)).toEqual([{ id: 'u9', site_role: 'none' }])
    closeDatabase(db)
  })

  it('refuses a site role the domain does not have, in the database rather than only in code', () => {
    const db = freshDb()
    migrate(db, migrations)

    expect(() =>
      db
        .prepare(
          `INSERT INTO users (id, email, password_hash, created_at, site_role)
                VALUES ('u9', 'neuf@example.test', 'hash:z', '2026-06-20T09:00:00.000Z', 'admin')`,
        )
        .run(),
    ).toThrow(/CHECK constraint failed/)
    closeDatabase(db)
  })

  it('makes the oldest account the operator, and leaves every other account alone', () => {
    // The upgrade path, on a box that has been running weddings for a year. The oldest
    // account is the one `bootstrapOwner` created — it only ever runs against an empty
    // table — and the invited moderator beside it must gain nothing.
    const db = freshDb()
    migrate(
      db,
      migrations.filter((migration) => migration.id < 4),
    )
    seedPreSiteRole(db)

    migrate(db, migrations)

    expect(siteRoles(db)).toEqual([
      { id: 'u-bootstrap', site_role: 'operator' },
      { id: 'u-invited', site_role: 'none' },
    ])
    closeDatabase(db)
  })

  it('keeps every other field of the account it promotes', () => {
    const db = freshDb()
    migrate(
      db,
      migrations.filter((migration) => migration.id < 4),
    )
    seedPreSiteRole(db)

    migrate(db, migrations)

    expect(
      db
        .prepare(
          `SELECT email, password_hash, created_at, last_login_at, must_change_password,
                  disabled_at
             FROM users WHERE id = 'u-bootstrap'`,
        )
        .get(),
    ).toEqual({
      email: 'hote@example.test',
      password_hash: 'hash:x',
      created_at: '2026-06-20T09:00:00.000Z',
      last_login_at: '2026-06-20T10:00:00.000Z',
      must_change_password: 1,
      disabled_at: null,
    })
    closeDatabase(db)
  })

  it('promotes nobody when the first account is switched off, rather than the next one along', () => {
    // The scenario this exists for: a photographer hands the studio over, the successor
    // switches the founder's login off rather than deleting it (`events.owner_id` is ON
    // DELETE RESTRICT), and the box is then upgraded. Walking past the disabled row to
    // "the oldest account that is not disabled" does not find the installer — it finds
    // whoever was invited first, which on a box that has run weddings for a year is a
    // bride who moderated one evening two summers ago.
    //
    // So the migration promotes the genuinely first account, or nobody. A box with no
    // operator loses nothing today: `requireOperator` is mounted on no production route,
    // and §10.4 — the first item that needs one — is also the item that ships a way to
    // appoint one. A box with the *wrong* operator is a grant nothing can revoke, made
    // invisibly at upgrade time, that every later item of section 10 builds on.
    const db = freshDb()
    migrate(
      db,
      migrations.filter((migration) => migration.id < 4),
    )
    seedPreSiteRole(db)
    db.prepare(
      `UPDATE users SET disabled_at = '2026-06-21T09:00:00.000Z' WHERE id = 'u-bootstrap'`,
    ).run()

    migrate(db, migrations)

    expect(siteRoles(db)).toEqual([
      { id: 'u-bootstrap', site_role: 'none' },
      { id: 'u-invited', site_role: 'none' },
    ])
    closeDatabase(db)
  })

  it('promotes nobody on a box where every account is switched off', () => {
    // The same rule read from the other end, and a rule the comment stated with nothing
    // asserting it. An entirely disabled box comes out of the upgrade exactly as it went
    // in.
    const db = freshDb()
    migrate(
      db,
      migrations.filter((migration) => migration.id < 4),
    )
    seedPreSiteRole(db)
    db.prepare(`UPDATE users SET disabled_at = '2026-06-21T09:00:00.000Z'`).run()

    migrate(db, migrations)

    expect(siteRoles(db)).toEqual([
      { id: 'u-bootstrap', site_role: 'none' },
      { id: 'u-invited', site_role: 'none' },
    ])
    closeDatabase(db)
  })

  it('picks one account deterministically when two share a creation instant', () => {
    // A restored or seeded database can hold two accounts stamped the same second, and a
    // migration that then depends on SQLite's row order promotes a different account on
    // two machines from the same backup. The tie-break on `id` is what makes the answer
    // the same one twice, and it is a rule with no guard if nothing asserts it.
    const db = freshDb()
    migrate(
      db,
      migrations.filter((migration) => migration.id < 4),
    )
    for (const id of ['u-b', 'u-a']) {
      db.prepare<[string, string]>(
        `INSERT INTO users (id, email, password_hash, created_at)
              VALUES (?, ?, 'hash:x', '2026-06-20T09:00:00.000Z')`,
      ).run(id, `${id}@example.test`)
    }

    migrate(db, migrations)

    expect(siteRoles(db)).toEqual([
      { id: 'u-a', site_role: 'operator' },
      { id: 'u-b', site_role: 'none' },
    ])
    closeDatabase(db)
  })

  it('promotes nobody on a fresh install, where first-run bootstrap creates the operator', () => {
    const db = freshDb()

    migrate(db, migrations)

    expect(siteRoles(db)).toEqual([])
    closeDatabase(db)
  })
})

describe('migration 005, photo missions', () => {
  const columnNames = (db: Db, table: string): string[] =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((row) => row.name)

  const tableNames = (db: Db): string[] =>
    (
      db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as {
        name: string
      }[]
    ).map((row) => row.name)

  const AT = '2026-06-20T21:00:00.000Z'

  /** One album as 004 alone could hold it: no missions table, no tag on a photograph. */
  const seedPreMissions = (db: Db): void => {
    db.prepare(
      `INSERT INTO users (id, email, password_hash, created_at)
            VALUES ('u1', 'hote@example.test', 'hash:x', '2026-06-20T09:00:00.000Z')`,
    ).run()
    db.prepare(
      `INSERT INTO events (id, owner_id, name, slug, join_code, status, settings,
                           quota_bytes, created_at)
            VALUES ('e1', 'u1', 'Camille & Sacha', 'camille-et-sacha', 'H7K2QM', 'live',
                    '{"moderation":"manual"}', 1000, '2026-06-20T09:00:00.000Z')`,
    ).run()
    db.prepare(
      `INSERT INTO guests (id, event_id, joined_at, last_seen_at)
            VALUES ('g1', 'e1', '${AT}', '${AT}')`,
    ).run()
    db.prepare(
      `INSERT INTO photos (id, event_id, author_guest_id, status, content_hash, width, height,
                           byte_size, created_at)
            VALUES ('p1', 'e1', 'g1', 'published', '${'a'.repeat(64)}', 1200, 800, 90000,
                    '2026-06-20T21:05:00.000Z')`,
    ).run()
  }

  const insertMission = (db: Db, id: string, prompt: string, scope = 'guest'): void => {
    db.prepare<[string, string, string]>(
      `INSERT INTO event_missions (id, event_id, prompt, scope, created_at)
            VALUES (?, 'e1', ?, ?, '${AT}')`,
    ).run(id, prompt, scope)
  }

  it('creates the missions table and gives photos the one nullable tag', () => {
    const db = freshDb()
    migrate(db, migrations)

    expect(tableNames(db)).toContain('event_missions')
    expect(columnNames(db, 'event_missions')).toEqual([
      'id',
      'event_id',
      'prompt',
      'scope',
      'created_at',
    ])
    expect(columnNames(db, 'photos')).toEqual(expect.arrayContaining(['mission_id']))
    closeDatabase(db)
  })

  it('stores no completion at all, because it is derived from the photographs', () => {
    // The schema-level guard for the decision in `domain/missions/missionProgress.ts`. A
    // column here would need unsetting from five places, and the first one anybody
    // forgot would leave a wall saying "fait" over a photograph just taken down.
    const db = freshDb()
    migrate(db, migrations)

    expect(columnNames(db, 'event_missions')).not.toContain('completed_at')
    expect(columnNames(db, 'event_missions')).not.toContain('completed_by')
    closeDatabase(db)
  })

  it('refuses a scope the domain does not have, in the database rather than only in code', () => {
    const db = freshDb()
    migrate(db, migrations)
    seedPreMissions(db)

    expect(() => insertMission(db, 'm1', 'un selfie', 'room')).toThrow(/CHECK constraint failed/)
    closeDatabase(db)
  })

  it('refuses the same prompt twice in one event, so a double-tapped form is one row', () => {
    const db = freshDb()
    migrate(db, migrations)
    seedPreMissions(db)
    insertMission(db, 'm1', 'un selfie avec les maries')

    expect(() => insertMission(db, 'm2', 'un selfie avec les maries')).toThrow(/UNIQUE constraint/)
    closeDatabase(db)
  })

  it('lets two events each ask for the same thing', () => {
    const db = freshDb()
    migrate(db, migrations)
    seedPreMissions(db)
    db.prepare(
      `INSERT INTO events (id, owner_id, name, slug, join_code, status, settings,
                           quota_bytes, created_at)
            VALUES ('e2', 'u1', 'Gala', 'gala', 'ZZZ999', 'live', '{}', 1000, '${AT}')`,
    ).run()
    insertMission(db, 'm1', 'un selfie avec les maries')

    expect(() =>
      db
        .prepare(
          `INSERT INTO event_missions (id, event_id, prompt, scope, created_at)
                VALUES ('m2', 'e2', 'un selfie avec les maries', 'guest', '${AT}')`,
        )
        .run(),
    ).not.toThrow()
    closeDatabase(db)
  })

  it('takes the missions with the event when the event is purged', () => {
    const db = freshDb()
    migrate(db, migrations)
    seedPreMissions(db)
    insertMission(db, 'm1', 'un selfie avec les maries')

    db.prepare(`DELETE FROM events WHERE id = 'e1'`).run()

    expect(db.prepare(`SELECT COUNT(*) AS n FROM event_missions`).get()).toEqual({ n: 0 })
    closeDatabase(db)
  })

  it('unfiles a photograph when its mission is deleted, and keeps the photograph', () => {
    // `SET NULL`, never `CASCADE`. A host removing a mistyped prompt has not asked for
    // the photographs filed under it to leave the album, and `CASCADE` there would put a
    // data-loss operation one keystroke away from a typo fix.
    const db = freshDb()
    migrate(db, migrations)
    seedPreMissions(db)
    insertMission(db, 'm1', 'un selfie avec les maries')
    db.prepare(`UPDATE photos SET mission_id = 'm1' WHERE id = 'p1'`).run()

    db.prepare(`DELETE FROM event_missions WHERE id = 'm1'`).run()

    expect(db.prepare(`SELECT id, mission_id FROM photos WHERE id = 'p1'`).get()).toEqual({
      id: 'p1',
      mission_id: null,
    })
    closeDatabase(db)
  })

  it('refuses a tag naming a mission that does not exist', () => {
    const db = freshDb()
    migrate(db, migrations)
    seedPreMissions(db)

    expect(() =>
      db.prepare(`UPDATE photos SET mission_id = 'ghost' WHERE id = 'p1'`).run(),
    ).toThrow(/FOREIGN KEY constraint failed/)
    closeDatabase(db)
  })

  it('answers the counting query from the index alone, without touching the album', () => {
    // The one query that reads `mission_id`, and it runs on every wall refresh for eight
    // hours. Covering and partial: `status` filters it, `author_guest_id` makes the
    // DISTINCT possible, and the index is the size of the tagged photographs rather than
    // of the evening.
    const db = freshDb()
    migrate(db, migrations)
    const planOf = (sql: string): string =>
      (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[])
        .map((row) => row.detail)
        .join('; ')

    const plan = planOf(
      `SELECT mission_id, COUNT(*) AS n, COUNT(DISTINCT author_guest_id) AS guests
         FROM photos
        WHERE event_id = 'e1' AND mission_id IS NOT NULL AND status = 'published'
        GROUP BY mission_id`,
    )

    expect(plan).toContain('idx_photos_event_mission')
    expect(plan).not.toContain('SCAN photos')
    closeDatabase(db)
  })

  it('keeps a photograph that existed before missions did, and files it under nothing', () => {
    // The upgrade path, on somebody's wedding album. The column has to arrive as NULL on
    // every existing row with no backfill and no table rebuild.
    const db = freshDb()
    migrate(
      db,
      migrations.filter((migration) => migration.id < 5),
    )
    seedPreMissions(db)

    migrate(db, migrations)

    expect(
      db.prepare(`SELECT status, byte_size, mission_id FROM photos WHERE id = 'p1'`).get(),
    ).toEqual({ status: 'published', byte_size: 90000, mission_id: null })
    closeDatabase(db)
  })
})
