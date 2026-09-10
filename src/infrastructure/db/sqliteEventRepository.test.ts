import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { EventSummary } from '../../application/ports/eventRepository'
import { AT, anEvent, anEventSettings } from '../../application/testing/builders'
import {
  EVENT_CONTRACT_FIXTURES,
  eventRepositoryContract,
} from '../../application/testing/contracts/eventRepositoryContract'
import { asEventId, asUserId } from '../../domain/shared/ids'
import { closeDatabase, openDatabase, type Db } from './connection'
import { migrations } from './migrations'
import { migrate } from './migrator'
import { SqliteEventRepository } from './sqliteEventRepository'

/**
 * The shared contract, plus what only the adapter can be asked: the cascade, the unique
 * indexes, the dashboard join, and what happens when a row no longer parses.
 */

const HOST = asUserId('user-host')
const MOD = asUserId('user-mod')

/**
 * `events.owner_id` is a foreign key, so every host a fixture names must exist first.
 * The builder's own default owner is read off the builder rather than retyped, because
 * the contract's unscoped fixtures rely on it.
 */
const FIXTURE_USER_IDS: readonly string[] = [
  ...EVENT_CONTRACT_FIXTURES.userIds,
  anEvent().ownerId,
  HOST,
  MOD,
]

const migratedDb = (): Db => {
  const db = openDatabase({ path: ':memory:' })
  migrate(db, migrations)
  return db
}

const seedUsers = (db: Db, ids: readonly string[]): void => {
  const insert = db.prepare(
    `INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)`,
  )
  for (const id of new Set(ids)) {
    insert.run(id, `${id}@example.test`, 'hash:un-mot-de-passe-solide', AT.toISOString())
  }
}

/** `length(content_hash) = 64` is a schema CHECK; only distinctness matters here. */
const hashFor = (photoId: string): string =>
  Buffer.from(photoId).toString('hex').padEnd(64, '0').slice(0, 64)

const insertGuest = (db: Db, guestId: string, eventId: string): void => {
  db.prepare(
    `INSERT INTO guests (id, event_id, display_name, joined_at, last_seen_at)
     VALUES (?, ?, 'Léa', ?, ?)`,
  ).run(guestId, eventId, AT.toISOString(), AT.toISOString())
}

interface PhotoSeed {
  readonly id: string
  readonly eventId: string
  readonly guestId: string
  readonly status: string
  readonly byteSize: number
}

const insertPhoto = (db: Db, seed: PhotoSeed): void => {
  db.prepare(
    `INSERT INTO photos (id, event_id, author_guest_id, status, content_hash,
                         width, height, byte_size, created_at)
     VALUES (?, ?, ?, ?, ?, 4032, 3024, ?, ?)`,
  ).run(
    seed.id,
    seed.eventId,
    seed.guestId,
    seed.status,
    hashFor(seed.id),
    seed.byteSize,
    AT.toISOString(),
  )
}

const insertReaction = (db: Db, id: string, eventId: string, photoId: string, guestId: string) => {
  db.prepare(
    `INSERT INTO reactions (id, event_id, photo_id, guest_id, kind, created_at)
     VALUES (?, ?, ?, ?, 'love', ?)`,
  ).run(id, eventId, photoId, guestId, AT.toISOString())
}

const insertMembership = (db: Db, eventId: string, userId: string, role: string): void => {
  db.prepare(
    `INSERT INTO event_memberships (event_id, user_id, role, granted_at) VALUES (?, ?, ?, ?)`,
  ).run(eventId, userId, role, AT.toISOString())
}

interface EventRowCounts {
  readonly photos: number
  readonly guests: number
  readonly reactions: number
  readonly memberships: number
}

const countIn = (db: Db, table: string, eventId: string): number => {
  const row = db
    .prepare<[string], { count: number }>(
      `SELECT COUNT(*) AS count FROM ${table} WHERE event_id = ?`,
    )
    .get(eventId)
  // -1 rather than 0: an unreadable count must fail the assertion, not satisfy it.
  return row?.count ?? -1
}

const rowCountsFor = (db: Db, eventId: string): EventRowCounts => ({
  photos: countIn(db, 'photos', eventId),
  guests: countIn(db, 'guests', eventId),
  reactions: countIn(db, 'reactions', eventId),
  memberships: countIn(db, 'event_memberships', eventId),
})

/** better-sqlite3 exposes a stable `code`; the message is not part of the contract. */
const sqliteCodeOf = (thrown: unknown): string =>
  thrown instanceof Error && 'code' in thrown && typeof thrown.code === 'string'
    ? thrown.code
    : `not a SqliteError: ${String(thrown)}`

const rejectionOf = async (action: () => Promise<unknown>): Promise<unknown> => {
  try {
    await action()
  } catch (thrown) {
    return thrown
  }
  return new Error('the action resolved instead of rejecting')
}

eventRepositoryContract('sqlite', async () => {
  const db = migratedDb()
  seedUsers(db, FIXTURE_USER_IDS)

  return {
    repo: new SqliteEventRepository(db),
    dispose: async () => closeDatabase(db),
  }
})

describe('SqliteEventRepository', () => {
  let db: Db
  let repo: SqliteEventRepository

  beforeEach(() => {
    db = migratedDb()
    seedUsers(db, FIXTURE_USER_IDS)
    repo = new SqliteEventRepository(db)
  })

  afterEach(() => {
    closeDatabase(db)
  })

  // ------------------------------------------------------------- uniqueness --

  it.each([
    {
      index: 'slug',
      second: anEvent({ id: 'evt-2', slug: 'camille-et-sacha', joinCode: 'ZZZZZZ' }),
    },
    {
      index: 'join code',
      second: anEvent({ id: 'evt-2', slug: 'gala-annuel', joinCode: 'H7K2QM' }),
    },
  ])('refuses at the unique index a second event holding the same $index', async ({ second }) => {
    await repo.save(anEvent({ id: 'evt-1', slug: 'camille-et-sacha', joinCode: 'H7K2QM' }))

    const thrown = await rejectionOf(() => repo.save(second))

    expect(sqliteCodeOf(thrown)).toBe('SQLITE_CONSTRAINT_UNIQUE')
  })

  it('refuses an event whose owner is not an account', async () => {
    const thrown = await rejectionOf(() => repo.save(anEvent({ id: 'evt-1', ownerId: 'ghost' })))

    expect(sqliteCodeOf(thrown)).toBe('SQLITE_CONSTRAINT_FOREIGNKEY')
  })

  // -------------------------------------------------------------- dashboard --

  describe('dashboard row', () => {
    /**
     * Two events, each with its own guest, photos and bytes. Every count below is
     * therefore also a tenant-isolation assertion: a missing `event_id` in any of the
     * four subqueries changes the number.
     */
    beforeEach(async () => {
      await repo.save(anEvent({ id: 'evt-mine', ownerId: HOST }))
      await repo.save(
        anEvent({ id: 'evt-other', ownerId: HOST, slug: 'gala-annuel', joinCode: 'ZZZZZZ' }),
      )

      insertGuest(db, 'guest-mine', 'evt-mine')
      insertPhoto(db, {
        id: 'photo-mine-1',
        eventId: 'evt-mine',
        guestId: 'guest-mine',
        status: 'published',
        byteSize: 2_000,
      })
      insertPhoto(db, {
        id: 'photo-mine-2',
        eventId: 'evt-mine',
        guestId: 'guest-mine',
        status: 'pending',
        byteSize: 1_000,
      })

      insertGuest(db, 'guest-other-1', 'evt-other')
      insertGuest(db, 'guest-other-2', 'evt-other')
      insertPhoto(db, {
        id: 'photo-other-1',
        eventId: 'evt-other',
        guestId: 'guest-other-1',
        status: 'pending',
        byteSize: 9_000,
      })
    })

    const counts: readonly { field: keyof EventSummary; expected: number }[] = [
      { field: 'photoCount', expected: 2 },
      { field: 'pendingCount', expected: 1 },
      { field: 'guestCount', expected: 1 },
      { field: 'usedBytes', expected: 3_000 },
    ]

    it.each(counts)('reports $field for that event alone', async ({ field, expected }) => {
      const summaries = await repo.listForUser(HOST)

      expect(summaries.find((summary) => summary.id === 'evt-mine')?.[field]).toBe(expected)
    })
  })

  it('lists an event the user only moderates, because a moderator needs it too', async () => {
    await repo.save(anEvent({ id: 'evt-1', ownerId: HOST }))
    insertMembership(db, 'evt-1', MOD, 'moderator')

    const summaries = await repo.listForUser(MOD)

    expect(summaries.map((summary) => summary.id)).toEqual(['evt-1'])
  })

  // ---------------------------------------------------------------- cascade --

  describe('deleting an event', () => {
    beforeEach(async () => {
      await repo.save(anEvent({ id: 'evt-1', ownerId: HOST }))
      await repo.save(
        anEvent({ id: 'evt-2', ownerId: HOST, slug: 'gala-annuel', joinCode: 'ZZZZZZ' }),
      )

      for (const eventId of ['evt-1', 'evt-2']) {
        insertGuest(db, `guest-${eventId}`, eventId)
        insertPhoto(db, {
          id: `photo-${eventId}`,
          eventId,
          guestId: `guest-${eventId}`,
          status: 'published',
          byteSize: 1_000,
        })
        insertReaction(db, `reaction-${eventId}`, eventId, `photo-${eventId}`, `guest-${eventId}`)
        insertMembership(db, eventId, MOD, 'moderator')
      }
    })

    it('cascades to its photos, guests, reactions and memberships', async () => {
      await repo.delete(asEventId('evt-1'))

      expect(rowCountsFor(db, 'evt-1')).toEqual({
        photos: 0,
        guests: 0,
        reactions: 0,
        memberships: 0,
      })
    })

    it('leaves another event rows untouched', async () => {
      await repo.delete(asEventId('evt-1'))

      expect(rowCountsFor(db, 'evt-2')).toEqual({
        photos: 1,
        guests: 1,
        reactions: 1,
        memberships: 1,
      })
    })
  })

  // ------------------------------------------------------------ corrupt rows --

  describe('a row the domain refuses', () => {
    it.each([
      { column: 'name', value: '' },
      { column: 'slug', value: 'Not A Slug' },
      { column: 'join_code', value: 'nope' },
      { column: 'created_at', value: 'samedi soir' },
    ])('refuses to hydrate an event whose $column no longer parses', async ({ column, value }) => {
      await repo.save(anEvent({ id: 'evt-1' }))
      db.prepare(`UPDATE events SET ${column} = ? WHERE id = ?`).run(value, 'evt-1')

      await expect(repo.findById(asEventId('evt-1'))).rejects.toThrow()
    })

    const valid = anEventSettings().toProps()

    /** A settings blob a host really chose, with one field as a corrupt row holds it. */
    const json = (patch: Record<string, unknown>): string => JSON.stringify({ ...valid, ...patch })

    it.each([
      { holds: 'not JSON at all', stored: 'samedi soir' },
      { holds: 'a JSON value that is not an object', stored: 'null' },
      { holds: 'a JSON array', stored: '[]' },
      { holds: 'an unknown moderation mode', stored: json({ moderation: 'ai' }) },
      { holds: 'a non-boolean flag', stored: json({ allowCaptions: 'oui' }) },
      { holds: 'a missing flag', stored: json({ allowGuestSelfDelete: undefined }) },
      { holds: 'a non-numeric window', stored: json({ guestSelfDeleteGraceSeconds: '900' }) },
      { holds: 'a retention the domain refuses', stored: json({ retentionDays: 0 }) },
    ])('refuses to hydrate an event whose stored settings hold $holds', async ({ stored }) => {
      await repo.save(anEvent({ id: 'evt-1' }))
      db.prepare(`UPDATE events SET settings = ? WHERE id = ?`).run(stored, 'evt-1')

      await expect(repo.findById(asEventId('evt-1'))).rejects.toThrow()
    })

    it('refuses to hydrate an event whose status is outside the lifecycle', async () => {
      await repo.save(anEvent({ id: 'evt-1' }))
      // The column carries a CHECK, so only a hand-edited database reaches this state —
      // which is what the pragma reproduces.
      db.pragma('ignore_check_constraints = ON')
      db.prepare(`UPDATE events SET status = 'cancelled' WHERE id = ?`).run('evt-1')

      await expect(repo.findById(asEventId('evt-1'))).rejects.toThrow()
    })
  })
})
