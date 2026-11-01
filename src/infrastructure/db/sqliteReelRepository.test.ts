import { describe, expect, it } from 'vitest'
import {
  REEL_CONTRACT_FIXTURES,
  reelRepositoryContract,
} from '../../application/testing/contracts/reelRepositoryContract'
import { AT } from '../../application/testing/builders'
import { closeDatabase, openDatabase, type Db } from './connection'
import { migrate } from './migrator'
import { migrations } from './migrations'
import { SqlitePhotoRepository } from './sqlitePhotoRepository'
import { SqliteReelRepository } from './sqliteReelRepository'

const ISO_AT = AT.toISOString()

const migratedDatabase = (): Db => {
  const db = openDatabase({ path: ':memory:' })
  migrate(db, migrations)
  for (const id of REEL_CONTRACT_FIXTURES.userIds) {
    db.prepare(
      `INSERT INTO users (id, email, password_hash, created_at)
            VALUES (?, ? || '@example.test', 'hash:x', ?)`,
    ).run(id, id, ISO_AT)
  }
  for (const id of REEL_CONTRACT_FIXTURES.eventIds) {
    db.prepare(
      `INSERT INTO events (id, owner_id, name, slug, join_code, status, settings, quota_bytes,
                           created_at)
            VALUES (?, 'user-host', ?, ?, ?, 'live', '{}', 1000000000, ?)`,
    ).run(id, id, id, id, ISO_AT)
  }
  // `aPhoto()`'s default author, which the contract's photographs carry.
  db.prepare(
    `INSERT INTO guests (id, event_id, display_name, joined_at, last_seen_at)
          VALUES ('guest-1', 'evt-wedding', NULL, ?, ?)`,
  ).run(ISO_AT, ISO_AT)
  return db
}

reelRepositoryContract('sqlite', async () => {
  const db = migratedDatabase()
  return {
    repo: new SqliteReelRepository(db),
    photos: new SqlitePhotoRepository(db),
    placeEventsInClient: async (clientId, eventIds): Promise<void> => {
      db.prepare<[string, string, string]>(
        `INSERT OR IGNORE INTO clients (id, name, created_at) VALUES (?, ?, ?)`,
      ).run(clientId, clientId, ISO_AT)
      const attach = db.prepare<[string, string]>(`UPDATE events SET client_id = ? WHERE id = ?`)
      for (const eventId of eventIds) attach.run(clientId, eventId)
    },
    dispose: async () => closeDatabase(db),
  }
})

describe('highlight_reels, as the schema holds it', () => {
  it('is deleted with its event (the cascade) and holds one row per event', () => {
    const db = migratedDatabase()
    const insert = db.prepare(
      `INSERT INTO highlight_reels (id, event_id, status, photo_ids, attempts, not_before,
                                    created_at, updated_at)
            VALUES (?, 'evt-wedding', 'queued', '[]', 0, ?, ?, ?)`,
    )
    insert.run('r1', ISO_AT, ISO_AT, ISO_AT)

    expect(() => insert.run('r2', ISO_AT, ISO_AT, ISO_AT)).toThrow(/UNIQUE/)

    db.prepare(`DELETE FROM events WHERE id = 'evt-wedding'`).run()
    expect(db.prepare(`SELECT COUNT(*) AS n FROM highlight_reels`).get()).toEqual({ n: 0 })
    closeDatabase(db)
  })

  it('refuses a status outside the five, and a digest that is not 64 characters', () => {
    const db = migratedDatabase()
    const insert = (status: string, hash: string | null) =>
      db
        .prepare(
          `INSERT INTO highlight_reels (id, event_id, status, photo_ids, attempts, not_before,
                                        output_hash, created_at, updated_at)
                VALUES ('r1', 'evt-wedding', ?, '[]', 0, ?, ?, ?, ?)`,
        )
        .run(status, ISO_AT, hash, ISO_AT, ISO_AT)

    expect(() => insert('reserved', null)).toThrow(/CHECK/)
    expect(() => insert('done', 'abc')).toThrow(/CHECK/)
    expect(() => insert('done', 'a'.repeat(64))).not.toThrow()
    closeDatabase(db)
  })

  it('fails loudly on a row that is not what the schema promised', () => {
    const db = migratedDatabase()
    db.prepare(
      `INSERT INTO highlight_reels (id, event_id, status, photo_ids, attempts, not_before,
                                    created_at, updated_at)
            VALUES ('r1', 'evt-wedding', 'queued', 'not json', 0, ?, ?, ?)`,
    ).run(ISO_AT, ISO_AT, ISO_AT)

    return expect(new SqliteReelRepository(db).findByEvent(REEL_EVENT)).rejects.toThrow(/photo_ids/)
  })
})

const REEL_EVENT = REEL_CONTRACT_FIXTURES.eventIds[0] as unknown as Parameters<
  SqliteReelRepository['findByEvent']
>[0]
