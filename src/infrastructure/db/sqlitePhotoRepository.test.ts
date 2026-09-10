import type Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  PHOTO_CONTRACT_FIXTURES,
  photoRepositoryContract,
} from '../../application/testing/contracts/photoRepositoryContract'
import type { PhotoPage } from '../../application/ports/photoRepository'
import { AT, aPhoto, atPlus, type AuthorInput } from '../../application/testing/builders'
import type { PhotoReview } from '../../domain/photos/photo'
import { asEventId, asPhotoId } from '../../domain/shared/ids'
import { closeDatabase, openDatabase, type Db } from './connection'
import { migrate } from './migrator'
import { migrations } from './migrations'
import { SqlitePhotoRepository } from './sqlitePhotoRepository'

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')
const SAM: AuthorInput = { kind: 'guest', id: 'guest-sam' }
const AUTOMATIC: PhotoReview = { kind: 'automatic', at: AT }
const ISO_AT = AT.toISOString()

/**
 * `photos` carries foreign keys to `events`, `guests` and `users`, and
 * `PRAGMA foreign_keys` is ON for every connection — so a photo fixture needs its
 * parents to exist first. Raw SQL rather than the sibling repositories: this harness
 * must keep working while those adapters are still being written.
 *
 * `guest-1` is not in the contract's fixture list but is `aPhoto()`'s default author,
 * which most contract cases rely on.
 */
const GUEST_EVENTS: Readonly<Record<string, string>> = { 'guest-sam': 'evt-gala' }

const seedForeignRows = (db: Db): void => {
  const insertUser = db.prepare<{ readonly id: string; readonly at: string }>(
    `INSERT INTO users (id, email, password_hash, created_at)
          VALUES (@id, @id || '@example.test', 'hash:x', @at)`,
  )
  const insertEvent = db.prepare<{ readonly id: string; readonly at: string }>(
    `INSERT INTO events (id, owner_id, name, slug, join_code, status, settings, quota_bytes,
                         created_at)
          VALUES (@id, 'user-host', @id, @id, @id, 'live', '{}', 1000000000, @at)`,
  )
  const insertGuest = db.prepare<{
    readonly id: string
    readonly eventId: string
    readonly at: string
  }>(
    `INSERT INTO guests (id, event_id, display_name, joined_at, last_seen_at)
          VALUES (@id, @eventId, NULL, @at, @at)`,
  )

  for (const id of PHOTO_CONTRACT_FIXTURES.userIds) insertUser.run({ id, at: ISO_AT })
  for (const id of PHOTO_CONTRACT_FIXTURES.eventIds) insertEvent.run({ id, at: ISO_AT })
  for (const id of [...PHOTO_CONTRACT_FIXTURES.guestIds, 'guest-1']) {
    insertGuest.run({ id, eventId: GUEST_EVENTS[id] ?? 'evt-wedding', at: ISO_AT })
  }
}

const migratedDatabase = (): Db => {
  const db = openDatabase({ path: ':memory:' })
  migrate(db, migrations)
  seedForeignRows(db)
  return db
}

photoRepositoryContract('sqlite', async () => {
  const db = migratedDatabase()
  return {
    repo: new SqlitePhotoRepository(db),
    dispose: async () => closeDatabase(db),
  }
})

// --------------------------------------------------------------- raw row access --

/** The `photos` row as SQLite holds it, for the assertions that are about columns. */
interface RawPhoto {
  readonly id: string
  readonly event_id: string
  readonly author_guest_id: string | null
  readonly author_user_id: string | null
  readonly status: string
  readonly content_hash: string
  readonly width: number
  readonly height: number
  readonly byte_size: number
  readonly caption: string | null
  readonly created_at: string
  readonly review_kind: string | null
  readonly reviewed_at: string | null
  readonly reviewed_by_user_id: string | null
}

const RAW_COLUMNS = `
  id, event_id, author_guest_id, author_user_id, status, content_hash,
  width, height, byte_size, caption, created_at,
  review_kind, reviewed_at, reviewed_by_user_id
`

const RAW_DEFAULTS: RawPhoto = {
  id: 'p-raw',
  event_id: 'evt-wedding',
  author_guest_id: 'guest-lea',
  author_user_id: null,
  status: 'pending',
  content_hash: 'a'.repeat(64),
  width: 4032,
  height: 3024,
  byte_size: 2_400_000,
  caption: null,
  created_at: ISO_AT,
  review_kind: null,
  reviewed_at: null,
  reviewed_by_user_id: null,
}

/**
 * Writes a row the schema would refuse.
 *
 * `ignore_check_constraints` is the only way to reach the mapper's corrupt-row guards,
 * and those guards are what stop a hand-edited database from projecting a photo nobody
 * can be shown to have approved.
 */
const insertRawPhoto = (db: Db, overrides: Partial<RawPhoto>): void => {
  db.pragma('ignore_check_constraints = ON')
  db.prepare<RawPhoto>(
    `INSERT INTO photos (${RAW_COLUMNS})
          VALUES (@id, @event_id, @author_guest_id, @author_user_id, @status, @content_hash,
                  @width, @height, @byte_size, @caption, @created_at,
                  @review_kind, @reviewed_at, @reviewed_by_user_id)`,
  ).run({ ...RAW_DEFAULTS, ...overrides })
  db.pragma('ignore_check_constraints = OFF')
}

const readRawPhoto = (db: Db, photoId: string): RawPhoto | undefined =>
  db.prepare<[string], RawPhoto>(`SELECT ${RAW_COLUMNS} FROM photos WHERE id = ?`).get(photoId)

const countPhotoRows = (db: Db): number =>
  db.prepare<[], { readonly count: number }>(`SELECT COUNT(*) AS count FROM photos`).get()?.count ??
  0

const countReactionRows = (db: Db): number =>
  db.prepare<[], { readonly count: number }>(`SELECT COUNT(*) AS count FROM reactions`).get()
    ?.count ?? 0

const insertReaction = (db: Db, photoId: string): void => {
  db.prepare<[string, string]>(
    `INSERT INTO reactions (id, event_id, photo_id, guest_id, kind, created_at)
          VALUES ('reaction-1', 'evt-wedding', ?, 'guest-lea', 'love', ?)`,
  ).run(photoId, ISO_AT)
}

// ------------------------------------------------------------- lazy-read probe --

type AnyStatement = Database.Statement<unknown[], unknown>

interface RowCounter {
  pulled: number
}

const countingRows = function* (
  rows: IterableIterator<unknown>,
  counter: RowCounter,
): IterableIterator<unknown> {
  for (const row of rows) {
    counter.pulled += 1
    yield row
  }
}

const countingStatement = (statement: AnyStatement, counter: RowCounter): AnyStatement =>
  new Proxy(statement, {
    get: (target, property, receiver) =>
      property === 'iterate'
        ? (...params: unknown[]) => countingRows(target.iterate(...params), counter)
        : Reflect.get(target, property, receiver),
  })

/**
 * A connection that counts the rows the adapter actually pulls out of SQLite.
 *
 * Laziness is only observable from outside as "how many rows left the statement", and
 * that number is the whole point of streaming the export: a four-thousand-photo album
 * read into an array before the first entry is written is how a self-hosted box runs
 * out of memory.
 */
const countingConnection = (db: Db, counter: RowCounter): Db =>
  new Proxy(db, {
    get: (target, property, receiver) =>
      property === 'prepare'
        ? (sql: string) => countingStatement(target.prepare(sql), counter)
        : Reflect.get(target, property, receiver),
  })

// ------------------------------------------------------------------------ tests --

const requireCursor = (page: PhotoPage): string => {
  if (page.nextCursor === null) throw new Error('expected a page to report a next cursor')
  return page.nextCursor
}

const forgeCursor = (payload: unknown): string =>
  Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')

const idsOf = (page: PhotoPage): readonly string[] => page.items.map((photo) => photo.id)

describe('SqlitePhotoRepository', () => {
  let db: Db
  let repo: SqlitePhotoRepository

  beforeEach(() => {
    db = migratedDatabase()
    repo = new SqlitePhotoRepository(db)
  })

  afterEach(() => {
    closeDatabase(db)
  })

  /** Five photos, one second apart, so `p5` is newest and the order is unambiguous. */
  const seedFivePhotos = async (): Promise<void> => {
    await repo.saveMany([
      aPhoto({ id: 'p1', eventId: WEDDING, createdAt: atPlus(1_000) }),
      aPhoto({ id: 'p2', eventId: WEDDING, createdAt: atPlus(2_000) }),
      aPhoto({ id: 'p3', eventId: WEDDING, createdAt: atPlus(3_000) }),
      aPhoto({ id: 'p4', eventId: WEDDING, createdAt: atPlus(4_000) }),
      aPhoto({ id: 'p5', eventId: WEDDING, createdAt: atPlus(5_000) }),
    ])
  }

  // ------------------------------------------------------------ author columns --

  const authorCases: readonly {
    readonly label: string
    readonly author: AuthorInput
    readonly guestColumn: string | null
    readonly userColumn: string | null
  }[] = [
    {
      label: 'a guest upload',
      author: { kind: 'guest', id: 'guest-lea' },
      guestColumn: 'guest-lea',
      userColumn: null,
    },
    {
      label: 'a host upload',
      author: { kind: 'host', id: 'user-host' },
      guestColumn: null,
      userColumn: 'user-host',
    },
  ]

  it.each(authorCases)(
    'writes exactly one author column for $label',
    async ({ author, guestColumn, userColumn }) => {
      await repo.save(aPhoto({ id: 'p1', eventId: WEDDING, author }))

      const row = readRawPhoto(db, 'p1')

      expect(row?.author_guest_id).toBe(guestColumn)
      expect(row?.author_user_id).toBe(userColumn)
    },
  )

  it('credits nobody with an automatic decision', async () => {
    await repo.save(
      aPhoto({ id: 'p1', eventId: WEDDING, status: 'published', review: { kind: 'automatic' } }),
    )

    const row = readRawPhoto(db, 'p1')

    expect(row?.review_kind).toBe('automatic')
    expect(row?.reviewed_by_user_id).toBeNull()
  })

  // --------------------------------------------------------------------- saves --

  it('keeps the reactions a photo collected when the photo is saved again', async () => {
    // INSERT OR REPLACE would delete the row first, and reactions cascade from photos:
    // a host publishing a photo would silently wipe the room's reactions to it.
    await repo.save(aPhoto({ id: 'p1', eventId: WEDDING, status: 'pending' }))
    insertReaction(db, 'p1')

    await repo.save(aPhoto({ id: 'p1', eventId: WEDDING, status: 'published' }))

    expect(countReactionRows(db)).toBe(1)
  })

  it('commits no row of a batch when one photo duplicates a content hash', async () => {
    // 1.0 fired one insert per file through Promise.all, so a duplicate in the fifth
    // file left four rows committed and the guest unable to tell which photos landed.
    const stored = aPhoto({ id: 'p1', eventId: WEDDING })
    await repo.save(stored)

    await expect(
      repo.saveMany([
        aPhoto({ id: 'p2', eventId: WEDDING }),
        aPhoto({ id: 'p3', eventId: WEDDING, contentHash: stored.contentHash.value }),
      ]),
    ).rejects.toThrow()

    expect(countPhotoRows(db)).toBe(1)
  })

  // ---------------------------------------------------------------- pagination --

  it('pages through the album returning every photo exactly once, in order', async () => {
    await seedFivePhotos()

    const first = await repo.list(WEDDING, { limit: 2 })
    const second = await repo.list(WEDDING, { limit: 2, cursor: requireCursor(first) })
    const third = await repo.list(WEDDING, { limit: 2, cursor: requireCursor(second) })

    expect([...idsOf(first), ...idsOf(second), ...idsOf(third)]).toEqual([
      'p5',
      'p4',
      'p3',
      'p2',
      'p1',
    ])
  })

  it('reports no cursor on the page that exhausts the album', async () => {
    await seedFivePhotos()

    const first = await repo.list(WEDDING, { limit: 2 })
    const second = await repo.list(WEDDING, { limit: 2, cursor: requireCursor(first) })
    const third = await repo.list(WEDDING, { limit: 2, cursor: requireCursor(second) })

    expect(third.nextCursor).toBeNull()
  })

  it('neither repeats nor skips a photo when a newer one arrives between two pages', async () => {
    // The keyset predicate is what makes this hold. Under OFFSET the second page would
    // start one row late, showing p4 twice and losing p2 entirely.
    await seedFivePhotos()
    const first = await repo.list(WEDDING, { limit: 2 })
    await repo.save(aPhoto({ id: 'p6', eventId: WEDDING, createdAt: atPlus(6_000) }))

    const second = await repo.list(WEDDING, { limit: 2, cursor: requireCursor(first) })

    expect([...idsOf(first), ...idsOf(second)]).toEqual(['p5', 'p4', 'p3', 'p2'])
  })

  const forgedCursors: readonly { readonly label: string; readonly cursor: string }[] = [
    { label: 'not base64url of JSON at all', cursor: 'not-a-cursor' },
    { label: 'JSON that is not a pair', cursor: forgeCursor('2026-06-20T21:00:00.000Z') },
    { label: 'a pair of the wrong length', cursor: forgeCursor(['2026-06-20T21:00:00.000Z']) },
    { label: 'a pair that is not two strings', cursor: forgeCursor([1, 2]) },
  ]

  it.each(forgedCursors)('rejects a cursor it did not issue: $label', async ({ cursor }) => {
    // Restarting from page one would show a guest an album that repeats itself forever
    // instead of surfacing the paging bug.
    await expect(repo.list(WEDDING, { cursor })).rejects.toThrow()
  })

  it('matches nothing when the status filter is explicitly empty', async () => {
    await repo.save(aPhoto({ id: 'p1', eventId: WEDDING, status: 'published' }))

    expect(await repo.list(WEDDING, { statuses: [] })).toEqual({ items: [], nextCursor: null })
  })

  it.each([0, -1, 1.5])('rejects a wall playlist limit of %s', async (limit) => {
    await expect(repo.listIdsByStatus(WEDDING, 'published', limit)).rejects.toThrow()
  })

  // ----------------------------------------------------------- bulk moderation --

  it('leaves a photo of another event untouched and out of the ids it returns', async () => {
    await repo.save(aPhoto({ id: 'p-wedding', eventId: WEDDING, status: 'pending' }))
    await repo.save(aPhoto({ id: 'p-gala', eventId: GALA, status: 'pending', author: SAM }))

    const changed = await repo.updateStatuses(
      WEDDING,
      [asPhotoId('p-wedding'), asPhotoId('p-gala')],
      'published',
      AUTOMATIC,
    )

    expect(changed).toEqual(['p-wedding'])
    expect((await repo.findById(GALA, asPhotoId('p-gala')))?.status).toBe('pending')
  })

  // ------------------------------------------------------------------ counters --

  /** Both events populated, every status used, so a missing scope shows up as a sum. */
  const seedMixedFixture = async (): Promise<void> => {
    await repo.saveMany([
      aPhoto({ id: 'w1', eventId: WEDDING, status: 'pending', byteSize: 1_000 }),
      aPhoto({ id: 'w2', eventId: WEDDING, status: 'pending', byteSize: 200 }),
      aPhoto({ id: 'w3', eventId: WEDDING, status: 'published', byteSize: 30 }),
      aPhoto({ id: 'w4', eventId: WEDDING, status: 'hidden', byteSize: 4 }),
      aPhoto({ id: 'w5', eventId: WEDDING, status: 'rejected', byteSize: 5 }),
      aPhoto({ id: 'g1', eventId: GALA, status: 'pending', byteSize: 9_000, author: SAM }),
      aPhoto({ id: 'g2', eventId: GALA, status: 'published', byteSize: 700, author: SAM }),
    ])
  }

  it('counts every status of one event only', async () => {
    await seedMixedFixture()

    expect(await repo.countsByStatus(WEDDING)).toEqual({
      pending: 2,
      published: 1,
      rejected: 1,
      hidden: 1,
    })
  })

  it('sums the bytes of one event only, so a quota is never spent by another party', async () => {
    await seedMixedFixture()

    expect(await repo.totalBytes(WEDDING)).toBe(1_239)
  })

  // -------------------------------------------------------------------- export --

  it('pulls one row per photo the consumer asks for, not the whole album', async () => {
    await repo.saveMany([
      aPhoto({ id: 'p1', eventId: WEDDING, status: 'published', createdAt: atPlus(1_000) }),
      aPhoto({ id: 'p2', eventId: WEDDING, status: 'published', createdAt: atPlus(2_000) }),
      aPhoto({ id: 'p3', eventId: WEDDING, status: 'published', createdAt: atPlus(3_000) }),
    ])
    const counter: RowCounter = { pulled: 0 }
    const streaming = new SqlitePhotoRepository(countingConnection(db, counter))

    for await (const _first of streaming.streamForExport(WEDDING, ['published'])) break

    expect(counter.pulled).toBe(1)
  })

  it('streams nothing when no status is requested', async () => {
    await repo.save(aPhoto({ id: 'p1', eventId: WEDDING, status: 'published' }))
    const streamed: string[] = []

    for await (const photo of repo.streamForExport(WEDDING, [])) streamed.push(photo.id)

    expect(streamed).toEqual([])
  })

  // -------------------------------------------------------------- corrupt rows --

  const corruptRows: readonly { readonly label: string; readonly row: Partial<RawPhoto> }[] = [
    { label: 'no author at all', row: { author_guest_id: null } },
    {
      label: 'a host review with no reviewer',
      row: { review_kind: 'host', reviewed_at: ISO_AT, reviewed_by_user_id: null },
    },
    { label: 'a review kind with no timestamp', row: { review_kind: 'automatic' } },
    { label: 'a content hash that is not a digest', row: { content_hash: 'z'.repeat(64) } },
  ]

  it.each(corruptRows)('refuses to hydrate a row with $label', async ({ row }) => {
    // Photo.restore trusts its input, so the mapper is where a database that no longer
    // matches the schema has to fail — loudly, not by inventing the missing half.
    insertRawPhoto(db, row)

    await expect(repo.findById(WEDDING, asPhotoId('p-raw'))).rejects.toThrow()
  })
})
