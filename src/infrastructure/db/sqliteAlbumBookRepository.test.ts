import { describe, expect, it } from 'vitest'
import {
  ALBUM_BOOK_CONTRACT_FIXTURES,
  albumBookRepositoryContract,
} from '../../application/testing/contracts/albumBookRepositoryContract'
import { requestBook } from '../../domain/book/albumBook'
import { asEventId } from '../../domain/shared/ids'
import { closeDatabase, openDatabase, type Db } from './connection'
import { migrate } from './migrator'
import { migrations } from './migrations'
import { SqliteAlbumBookRepository } from './sqliteAlbumBookRepository'

const AT = '2026-11-01T10:00:00.000Z'

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
  for (const id of ALBUM_BOOK_CONTRACT_FIXTURES.eventIds) insertEvent.run({ id, at: AT })
  return db
}

albumBookRepositoryContract('sqlite', async () => {
  const db = migratedDatabase()
  return { repo: new SqliteAlbumBookRepository(db), dispose: async () => closeDatabase(db) }
})

describe('SqliteAlbumBookRepository', () => {
  const options = {
    title: 'T',
    subtitle: '',
    language: 'en',
    layout: 'one',
    showAuthors: false,
    showCaptions: false,
  } as const

  it('is removed with its event, requests included', async () => {
    const db = migratedDatabase()
    const repo = new SqliteAlbumBookRepository(db)
    await repo.saveRequest(requestBook(asEventId('evt-wedding'), options, new Date(AT)))

    db.prepare(`DELETE FROM events WHERE id = 'evt-wedding'`).run()

    expect(await repo.find(asEventId('evt-wedding'))).toBeNull()
    expect(db.prepare(`SELECT COUNT(*) AS n FROM album_book_requests`).get()).toEqual({ n: 0 })
    closeDatabase(db)
  })

  it('refuses to read a row whose options were tampered with', async () => {
    const db = migratedDatabase()
    const repo = new SqliteAlbumBookRepository(db)
    await repo.saveRequest(requestBook(asEventId('evt-wedding'), options, new Date(AT)))
    db.prepare(`UPDATE album_books SET options_json = '{"title":1}'`).run()

    await expect(repo.find(asEventId('evt-wedding'))).rejects.toThrow(/options_json/)
    closeDatabase(db)
  })

  it('refuses a status the machine does not have', () => {
    const db = migratedDatabase()
    expect(() =>
      db
        .prepare(
          `INSERT INTO album_books (event_id, status, options_json, requested_at, snapshot_at)
                VALUES ('evt-gala', 'weird', '{}', ?, ?)`,
        )
        .run(AT, AT),
    ).toThrow()
    closeDatabase(db)
  })
})
