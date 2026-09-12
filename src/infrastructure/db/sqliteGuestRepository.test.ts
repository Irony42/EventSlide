import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, openDatabase, type Db } from './connection'
import { migrations } from './migrations'
import { migrate } from './migrator'
import { SqliteGuestRepository } from './sqliteGuestRepository'
import { AT, aGuest, atPlus } from '../../application/testing/builders'
import {
  GUEST_CONTRACT_FIXTURES,
  guestRepositoryContract,
} from '../../application/testing/contracts/guestRepositoryContract'
import { asEventId, asGuestId } from '../../domain/shared/ids'

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')
const LEA = asGuestId('guest-lea')

const OWNER_ID = 'user-owner'

const migratedDatabase = (): Db => {
  const db = openDatabase({ path: ':memory:' })
  migrate(db, migrations)
  return db
}

/**
 * `guests.event_id` references `events`, which itself needs an owning account, so the
 * contract's fixture events have to exist before the repository is handed over. The
 * rows go in with raw SQL rather than through a sibling adapter: this test must fail
 * for a reason in *this* file.
 */
const seedEvents = (db: Db, eventIds: readonly string[]): void => {
  db.prepare<[string, string, string]>(
    `INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, 'hash:seed', ?)`,
  ).run(OWNER_ID, 'proprietaire@example.test', AT.toISOString())

  const insert = db.prepare<[string, string, string, string, string, string]>(
    `INSERT INTO events (id, owner_id, name, slug, join_code, status, settings, quota_bytes,
                         created_at)
          VALUES (?, ?, ?, ?, ?, 'live', '{}', 1000000000, ?)`,
  )
  eventIds.forEach((eventId, index) => {
    insert.run(eventId, OWNER_ID, eventId, eventId, `CODE${index}`, AT.toISOString())
  })
}

/**
 * A photo authored by a guest, which is what `Guest.photoCount` is derived from.
 * `(event_id, content_hash)` is unique and the column is CHECKed at 64 characters, so
 * the digest comes from the caller's index instead of being shared between fixtures.
 */
const seedPhoto = (db: Db, index: number, eventId: string, guestId: string): void => {
  db.prepare<[string, string, string, string, string]>(
    `INSERT INTO photos (id, event_id, author_guest_id, status, content_hash, width, height,
                         byte_size, created_at)
          VALUES (?, ?, ?, 'pending', ?, 4032, 3024, 2400000, ?)`,
  ).run(`photo-${index}`, eventId, guestId, String(index).padStart(64, '0'), AT.toISOString())
}

interface QueryLog {
  readonly db: Db
  readonly prepared: string[]
}

/**
 * Records the SQL an adapter prepares while forwarding every call to the real
 * database. Not a stub — the rows below are still real rows. It exists so a test can
 * hold the adapter to a promise about the *shape* of its access rather than only about
 * what it returns: presence is polled throughout a party and has to be an index seek.
 */
const withQueryLog = (db: Db): QueryLog => {
  const prepared: string[] = []
  const proxied = new Proxy(db, {
    get: (target, property, receiver) =>
      property === 'prepare'
        ? (source: string) => {
            prepared.push(source)
            return target.prepare(source)
          }
        : Reflect.get(target, property, receiver),
  })

  return { db: proxied, prepared }
}

/** Fail in the arrange step, so a miscounted statement is not reported as a bad plan. */
const onlyQuery = (prepared: readonly string[]): string => {
  const [sql] = prepared
  if (sql === undefined || prepared.length !== 1) {
    throw new Error(`expected exactly one prepared statement, got ${prepared.length}`)
  }
  return sql
}

interface PlanRow {
  readonly detail: string
}

/** SQLite's own account of how it will run a statement, flattened for one assertion. */
const planFor = (db: Db, sql: string, params: readonly string[]): string =>
  db
    .prepare<string[], PlanRow>(`EXPLAIN QUERY PLAN ${sql}`)
    .all(...params)
    .map((step) => step.detail)
    .join(' ')

guestRepositoryContract('sqlite', async () => {
  const db = migratedDatabase()
  seedEvents(db, GUEST_CONTRACT_FIXTURES.eventIds)

  return {
    repo: new SqliteGuestRepository(db),
    dispose: async () => {
      closeDatabase(db)
    },
  }
})

describe('SqliteGuestRepository', () => {
  let db: Db
  let repo: SqliteGuestRepository

  beforeEach(() => {
    db = migratedDatabase()
    seedEvents(db, GUEST_CONTRACT_FIXTURES.eventIds)
    repo = new SqliteGuestRepository(db)
  })

  afterEach(() => {
    closeDatabase(db)
  })

  // ------------------------------------------------------- derived photo count --

  it('derives the photo count from the photos table, which holds the only copy', async () => {
    await repo.save(aGuest({ id: 'guest-lea', eventId: WEDDING }))
    seedPhoto(db, 1, WEDDING, LEA)
    seedPhoto(db, 2, WEDDING, LEA)

    const stored = await repo.findById(WEDDING, LEA)

    expect(stored?.photoCount).toBe(2)
  })

  it('never counts a photo filed under another event towards a guest photo count', async () => {
    await repo.save(aGuest({ id: 'guest-lea', eventId: WEDDING }))
    seedPhoto(db, 1, GALA, LEA)

    const stored = await repo.findById(WEDDING, LEA)

    expect(stored?.photoCount).toBe(0)
  })

  it('discards the photo count carried by a saved guest, because no column stores it', async () => {
    await repo.save(aGuest({ id: 'guest-lea', eventId: WEDDING, photoCount: 7 }))

    const stored = await repo.findById(WEDDING, LEA)

    expect(stored?.photoCount).toBe(0)
  })

  it('derives the photo count when listing the guests of an event too', async () => {
    await repo.save(aGuest({ id: 'guest-lea', eventId: WEDDING }))
    seedPhoto(db, 1, WEDDING, LEA)

    const [stored] = await repo.list(WEDDING)

    expect(stored?.photoCount).toBe(1)
  })

  // ------------------------------------------------------------------- upsert --

  it('keeps a guest photos when that guest is saved again', async () => {
    // `INSERT OR REPLACE` deletes the conflicting row first, and foreign keys are ON,
    // so `photos.author_guest_id … ON DELETE CASCADE` would fire: a guest who renamed
    // themselves — or was merely touched by a heartbeat — would take their own photos
    // off the wall. The upsert on the primary key is what prevents that.
    const guest = aGuest({ id: 'guest-lea', eventId: WEDDING })
    await repo.save(guest)
    seedPhoto(db, 1, WEDDING, LEA)

    await repo.save(guest.touch(atPlus(60_000)))

    expect((await repo.findById(WEDDING, LEA))?.photoCount).toBe(1)
  })

  // -------------------------------------------------------- cross-event writes --

  it('refuses a save that would re-file a guest under another event', async () => {
    // `guests.id` is unique on its own, so a save carrying the wrong event is the one
    // way a write here can reach another event's row. It must fail, not succeed
    // quietly: the caller would go on to grant that guest upload rights at this event.
    await repo.save(aGuest({ id: 'guest-lea', eventId: WEDDING }))

    const moved = repo.save(aGuest({ id: 'guest-lea', eventId: GALA, displayName: 'Pirate' }))

    await expect(moved).rejects.toThrow()
  })

  it('leaves the guest of the other event untouched when such a save is refused', async () => {
    await repo.save(aGuest({ id: 'guest-lea', eventId: WEDDING, displayName: 'Léa' }))
    await expect(
      repo.save(aGuest({ id: 'guest-lea', eventId: GALA, displayName: 'Pirate' })),
    ).rejects.toThrow()

    const stored = await repo.findById(WEDDING, LEA)

    expect(stored?.displayName?.value).toBe('Léa')
  })

  it('never lists a guest at the event a refused save named', async () => {
    await repo.save(aGuest({ id: 'guest-lea', eventId: WEDDING }))
    await expect(repo.save(aGuest({ id: 'guest-lea', eventId: GALA }))).rejects.toThrow()

    expect(await repo.list(GALA)).toEqual([])
  })

  // -------------------------------------------------------------- stored shape --

  it('stores an absent display name as NULL rather than as an empty string', async () => {
    await repo.save(aGuest({ id: 'guest-lea', eventId: WEDDING, displayName: null }))

    const row = db
      .prepare<[string], { readonly display_name: string | null }>(
        `SELECT display_name FROM guests WHERE id = ?`,
      )
      .get(LEA)

    expect(row?.display_name).toBeNull()
  })

  it('refuses to hydrate a guest whose stored display name the domain rejects', async () => {
    // A corrupt row is a bug to surface, not a guest to project as anonymous.
    db.prepare<[string, string]>(
      `INSERT INTO guests (id, event_id, display_name, joined_at, last_seen_at)
            VALUES ('guest-corrupt', 'evt-wedding', '', ?, ?)`,
    ).run(AT.toISOString(), AT.toISOString())

    await expect(repo.findById(WEDDING, asGuestId('guest-corrupt'))).rejects.toThrow()
  })

  // ---------------------------------------------------------------- name batch --

  it('answers a batch wider than one IN list, so a busy wall is not a parameter error', async () => {
    // SQLite caps the bound parameters of a statement — 999 on older builds — so a wall
    // whose window grows past that would fail outright rather than slowly. The adapter
    // chunks; this is the test that fails if someone removes the chunking as ceremony.
    const ids = Array.from({ length: 450 }, (_, index) => `guest-${index}`)
    for (const [index, id] of ids.entries()) {
      await repo.save(aGuest({ id, eventId: WEDDING, displayName: `Invité ${index}` }))
    }

    const names = await repo.findNamesByIds(WEDDING, ids.map(asGuestId))

    expect(names.size).toBe(450)
    expect(names.get(asGuestId('guest-449'))).toBe('Invité 449')
  })

  it('refuses to hydrate a batched name the domain rejects, exactly as findById does', async () => {
    db.prepare<[string, string]>(
      `INSERT INTO guests (id, event_id, display_name, joined_at, last_seen_at)
            VALUES ('guest-corrupt', 'evt-wedding', '', ?, ?)`,
    ).run(AT.toISOString(), AT.toISOString())

    await expect(repo.findNamesByIds(WEDDING, [asGuestId('guest-corrupt')])).rejects.toThrow()
  })

  // -------------------------------------------------------------- access shape --

  it('reads a batch of names in one statement, never one per slide', async () => {
    // The wall is the surface that has to stay smooth for eight hours, and a playlist is
    // many photos by few guests. One statement for the batch is the whole point of the
    // method existing; the projection is names only, so no correlated photo count rides
    // along on a public read.
    await repo.save(aGuest({ id: 'guest-lea', eventId: WEDDING, displayName: 'Léa' }))
    await repo.save(aGuest({ id: 'guest-sacha', eventId: WEDDING, displayName: 'Sacha' }))
    const log = withQueryLog(db)

    await new SqliteGuestRepository(log.db).findNamesByIds(WEDDING, [LEA, asGuestId('guest-sacha')])

    const sql = onlyQuery(log.prepared)
    expect(sql).toContain('event_id = ?')
    expect(sql).not.toContain('COUNT(')
  })

  it('serves the presence count from the event and last-seen index', async () => {
    const log = withQueryLog(db)

    await new SqliteGuestRepository(log.db).countActive(WEDDING, AT)

    expect(planFor(db, onlyQuery(log.prepared), [WEDDING, AT.toISOString()])).toContain(
      'idx_guests_event_seen',
    )
  })
})
