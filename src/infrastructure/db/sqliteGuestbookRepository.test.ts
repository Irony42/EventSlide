import { describe, expect, it } from 'vitest'
import {
  GUESTBOOK_CONTRACT_FIXTURES,
  crowdGuestId,
  guestbookRepositoryContract,
} from '../../application/testing/contracts/guestbookRepositoryContract'
import { AT, aGuestbookEntry } from '../../application/testing/builders'
import { asEventId, asGuestbookEntryId, asGuestId } from '../../domain/shared/ids'
import { closeDatabase, openDatabase, type Db } from './connection'
import { migrate } from './migrator'
import { migrations } from './migrations'
import { SqliteGuestbookRepository } from './sqliteGuestbookRepository'

const ISO_AT = AT.toISOString()
const WEDDING = asEventId('evt-wedding')
const LEA = asGuestId('guest-lea')

/**
 * `guestbook_entries` has foreign keys to `events`, `guests` and `users`, and `PRAGMA foreign_keys`
 * is ON for every connection, so the parents the contract names have to exist first. Every guest
 * sits at the wedding: the gala cases are about the entries' own `event_id`, which is what a
 * cross-event read would have to get wrong.
 */
const seedForeignRows = (db: Db): void => {
  const insertUser = db.prepare<{ readonly id: string; readonly at: string }>(
    `INSERT INTO users (id, email, password_hash, created_at)
          VALUES (@id, @id || '@example.test', 'hash:x', @at)`,
  )
  for (const id of GUESTBOOK_CONTRACT_FIXTURES.userIds) insertUser.run({ id, at: ISO_AT })

  const insertEvent = db.prepare<{ readonly id: string; readonly at: string }>(
    `INSERT INTO events (id, owner_id, name, slug, join_code, status, settings, quota_bytes,
                         created_at)
          VALUES (@id, 'user-host', @id, @id, @id, 'live', '{}', 1000000000, @at)`,
  )
  for (const id of GUESTBOOK_CONTRACT_FIXTURES.eventIds) insertEvent.run({ id, at: ISO_AT })

  const insertGuest = db.prepare<{
    readonly id: string
    readonly eventId: string
    readonly at: string
  }>(
    `INSERT INTO guests (id, event_id, display_name, joined_at, last_seen_at)
          VALUES (@id, @eventId, NULL, @at, @at)`,
  )
  for (const id of GUESTBOOK_CONTRACT_FIXTURES.guestIds) {
    insertGuest.run({ id, eventId: 'evt-wedding', at: ISO_AT })
  }
  for (let n = 0; n < GUESTBOOK_CONTRACT_FIXTURES.crowd; n += 1) {
    insertGuest.run({ id: crowdGuestId(n), eventId: 'evt-wedding', at: ISO_AT })
  }
}

const migratedDatabase = (): Db => {
  const db = openDatabase({ path: ':memory:' })
  migrate(db, migrations)
  seedForeignRows(db)
  return db
}

const stored = (db: Db): SqliteGuestbookRepository => new SqliteGuestbookRepository(db)

guestbookRepositoryContract('sqlite', async () => {
  const db = migratedDatabase()
  return {
    repo: stored(db),
    takeDown: (eventId, entryId, at) => {
      db.prepare<[string, string, string]>(
        `UPDATE guestbook_entries SET taken_down_at = ? WHERE event_id = ? AND id = ?`,
      ).run(at.toISOString(), eventId, entryId)
    },
    dispose: async () => closeDatabase(db),
  }
})

describe('SqliteGuestbookRepository schema behaviour', () => {
  const firstEntry = aGuestbookEntry({ id: 'e1', eventId: 'evt-wedding', guestId: 'guest-lea' })

  it('takes the messages with the event when the event is purged', async () => {
    const db = migratedDatabase()
    await stored(db).admit(firstEntry)

    db.prepare<[string]>(`DELETE FROM events WHERE id = ?`).run('evt-wedding')

    expect(db.prepare(`SELECT COUNT(*) AS n FROM guestbook_entries`).get()).toEqual({ n: 0 })
    closeDatabase(db)
  })

  it('takes a guest messages with the guest row', async () => {
    const db = migratedDatabase()
    const repo = stored(db)
    await repo.admit(firstEntry)

    db.prepare<[string]>(`DELETE FROM guests WHERE id = ?`).run('guest-lea')

    expect(await repo.countByGuest(WEDDING, LEA)).toBe(0)
    closeDatabase(db)
  })

  it('refuses a stored body the domain does not accept, rather than projecting it', async () => {
    const db = migratedDatabase()
    const repo = stored(db)
    await repo.admit(firstEntry)
    db.prepare(`UPDATE guestbook_entries SET body = '' WHERE id = 'e1'`).run()

    await expect(repo.findById(WEDDING, asGuestbookEntryId('e1'))).rejects.toThrow(/refuses/)
    closeDatabase(db)
  })

  it('refuses a stored status the machine does not have', async () => {
    const db = migratedDatabase()
    const repo = stored(db)
    await repo.admit(firstEntry)
    db.pragma('ignore_check_constraints = ON')
    db.prepare(`UPDATE guestbook_entries SET status = 'weird' WHERE id = 'e1'`).run()
    db.pragma('ignore_check_constraints = OFF')

    await expect(repo.findById(WEDDING, asGuestbookEntryId('e1'))).rejects.toThrow(/unknown status/)
    closeDatabase(db)
  })

  it('reads a host decision back with its reviewer', async () => {
    const db = migratedDatabase()
    const repo = stored(db)
    await repo.admit(firstEntry)
    db.prepare(
      `UPDATE guestbook_entries
          SET status = 'published', review_kind = 'host', reviewed_at = ?, reviewed_by_user_id = 'user-host'`,
    ).run(ISO_AT)

    const entry = await repo.findById(WEDDING, asGuestbookEntryId('e1'))

    expect(entry?.review).toEqual({ kind: 'host', userId: 'user-host', at: AT })
    closeDatabase(db)
  })

  it('reads a review whose reviewer was deleted as no review', async () => {
    // reviewed_by_user_id is ON DELETE SET NULL: a host-reviewed row whose host is gone must
    // still be readable.
    const db = migratedDatabase()
    const repo = stored(db)
    await repo.admit(firstEntry)
    db.prepare(
      `UPDATE guestbook_entries
          SET status = 'published', review_kind = 'host', reviewed_at = ?, reviewed_by_user_id = NULL`,
    ).run(ISO_AT)

    const entry = await repo.findById(WEDDING, asGuestbookEntryId('e1'))

    expect(entry?.status).toBe('published')
    expect(entry?.review).toBeNull()
    closeDatabase(db)
  })
})
