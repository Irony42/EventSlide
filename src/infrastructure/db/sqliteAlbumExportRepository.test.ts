import { describe, expect, it } from 'vitest'
import {
  ALBUM_EXPORT_CONTRACT_FIXTURES,
  albumExportRepositoryContract,
} from '../../application/testing/contracts/albumExportRepositoryContract'
import { requestExport } from '../../domain/exports/albumExport'
import { EXPORT_FAILURE_CODES, EXPORT_STALE_REASONS } from '../../domain/exports/albumExportStatus'
import { asEventId, asUserId } from '../../domain/shared/ids'
import { closeDatabase, openDatabase, type Db } from './connection'
import { migrate } from './migrator'
import { migrations } from './migrations'
import { SqliteAlbumExportRepository } from './sqliteAlbumExportRepository'

const AT = '2026-12-01T10:00:00.000Z'
const WEDDING = asEventId('evt-wedding')
const HOST = asUserId(ALBUM_EXPORT_CONTRACT_FIXTURES.userId)

const migratedDatabase = (): Db => {
  const db = openDatabase({ path: ':memory:' })
  migrate(db, migrations)
  db.prepare(
    `INSERT INTO users (id, email, password_hash, created_at)
          VALUES ('user-host', 'host@example.test', 'hash:x', ?)`,
  ).run(AT)
  const insertEvent = db.prepare(
    `INSERT INTO events (id, owner_id, name, slug, join_code, status, settings, quota_bytes, created_at)
          VALUES (@id, 'user-host', @id, @id, @id, 'live', '{}', 1000000000, @at)`,
  )
  for (const id of ALBUM_EXPORT_CONTRACT_FIXTURES.eventIds) insertEvent.run({ id, at: AT })
  return db
}

albumExportRepositoryContract('sqlite', async () => {
  const db = migratedDatabase()
  return { repo: new SqliteAlbumExportRepository(db), dispose: async () => closeDatabase(db) }
})

describe('SqliteAlbumExportRepository', () => {
  it('is removed with its event, requests included (the purge reaches both tables)', async () => {
    const db = migratedDatabase()
    const repo = new SqliteAlbumExportRepository(db)
    await repo.request(requestExport(WEDDING, HOST, new Date(AT)))

    db.prepare(`DELETE FROM events WHERE id = 'evt-wedding'`).run()

    expect(await repo.find(WEDDING)).toBeNull()
    expect(db.prepare(`SELECT COUNT(*) AS n FROM event_exports`).get()).toEqual({ n: 0 })
    expect(db.prepare(`SELECT COUNT(*) AS n FROM event_export_requests`).get()).toEqual({ n: 0 })
    closeDatabase(db)
  })

  it('keeps the archive when the account that asked for it is deleted', async () => {
    const db = migratedDatabase()
    const repo = new SqliteAlbumExportRepository(db)
    db.prepare(
      `INSERT INTO users (id, email, password_hash, created_at)
          VALUES ('user-asker', 'asker@example.test', 'hash:x', ?)`,
    ).run(AT)
    await repo.request(requestExport(WEDDING, asUserId('user-asker'), new Date(AT)))

    db.prepare(`DELETE FROM users WHERE id = 'user-asker'`).run()

    expect((await repo.find(WEDDING))?.requestedBy).toBeNull()
    closeDatabase(db)
  })

  it('accepts every closed code of the domain, and refuses one that is not', async () => {
    const db = migratedDatabase()
    const repo = new SqliteAlbumExportRepository(db)
    const insert = db.prepare(
      `UPDATE event_exports SET failure = ?, stale_reason = ? WHERE event_id = 'evt-wedding'`,
    )
    await repo.request(requestExport(WEDDING, HOST, new Date(AT)))

    for (const code of EXPORT_FAILURE_CODES) insert.run(code, null)
    for (const reason of EXPORT_STALE_REASONS) insert.run(null, reason)

    expect(() => insert.run('a free message', null)).toThrow(/CHECK/)
    expect(() => insert.run(null, 'because I said so')).toThrow(/CHECK/)
    closeDatabase(db)
  })

  it.each([
    ['failure', "UPDATE event_exports SET failure = 'a sentence'"],
    ['stale_reason', "UPDATE event_exports SET stale_reason = 'because'"],
  ])('refuses to read a row whose %s was tampered with', async (field, update) => {
    const db = migratedDatabase()
    const repo = new SqliteAlbumExportRepository(db)
    await repo.request(requestExport(WEDDING, HOST, new Date(AT)))
    db.pragma('ignore_check_constraints = ON')
    db.prepare(update).run()

    await expect(repo.find(WEDDING)).rejects.toThrow(new RegExp(`unreadable ${field}`))
    closeDatabase(db)
  })

  it('refuses to read a row whose status was tampered with', async () => {
    const db = migratedDatabase()
    const repo = new SqliteAlbumExportRepository(db)
    await repo.request(requestExport(WEDDING, HOST, new Date(AT)))
    db.pragma('ignore_check_constraints = ON')
    db.prepare(`UPDATE event_exports SET status = 'weird'`).run()

    await expect(repo.find(WEDDING)).rejects.toThrow(/unreadable status/)
    closeDatabase(db)
  })
})
