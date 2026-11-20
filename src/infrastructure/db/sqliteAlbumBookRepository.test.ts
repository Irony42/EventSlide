import { describe, expect, it } from 'vitest'
import {
  ALBUM_BOOK_CONTRACT_FIXTURES,
  albumBookRepositoryContract,
} from '../../application/testing/contracts/albumBookRepositoryContract'
import { requestBook } from '../../domain/book/albumBook'
import type { BookPlan } from '../../domain/book/bookPlan'
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
    style: 'classique',
    selection: { kind: 'all' },
    showAuthors: false,
    showCaptions: false,
    includeGuestbook: false,
    printVersion: false,
    timeZone: 'Europe/Paris',
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

  describe('the plan column', () => {
    const wedding = asEventId('evt-wedding')
    const planOf = (extra: Record<string, unknown> = {}): BookPlan =>
      ({
        chapters: [],
        pages: [{ template: 'title', slots: [] }],
        selectedCount: 1,
        counts: { photos: 1, photographers: 1, hearts: 0, messages: 0, voices: 0, videos: 0 },
        includedMessages: 0,
        extraMessages: 0,
        hearts: {},
        photographers: [],
        favouritesPage: null,
        guestbookPage: null,
        ...extra,
      }) as BookPlan

    const running = async (db: Db): Promise<SqliteAlbumBookRepository> => {
      const repo = new SqliteAlbumBookRepository(db)
      await repo.saveRequest(requestBook(wedding, options, new Date(AT)))
      await repo.claimNext(new Date(AT))
      return repo
    }

    it('stores only what the plan schema knows: a plan carrying a guest text is refused at the write', async () => {
      const db = migratedDatabase()
      const repo = await running(db)

      await expect(
        repo.recordPlan(wedding, planOf({ caption: 'Léa, 06 12 34 56 78' })),
      ).rejects.toThrow()

      expect(db.prepare(`SELECT plan_json FROM album_books`).get()).toEqual({ plan_json: null })
      closeDatabase(db)
    })

    it('stores the plan as JSON of ids and numbers', async () => {
      const db = migratedDatabase()
      const repo = await running(db)
      await repo.recordPlan(wedding, planOf())

      const row = db.prepare<[], { plan_json: string }>(`SELECT plan_json FROM album_books`).get()
      expect(JSON.parse(row?.plan_json ?? 'null')).toEqual(planOf())
      closeDatabase(db)
    })

    it.each([
      ['not JSON at all', 'oops'],
      ['an unknown key', JSON.stringify(planOf({ title: 'x' }))],
      [
        'a template that does not exist',
        JSON.stringify({ ...planOf(), pages: [{ template: 'poster', slots: [] }] }),
      ],
    ])('refuses to read a row whose plan is %s', async (_name, plan) => {
      const db = migratedDatabase()
      const repo = await running(db)
      db.pragma('ignore_check_constraints = ON')
      db.prepare(`UPDATE album_books SET plan_json = ?`).run(plan)

      await expect(repo.find(wedding)).rejects.toThrow()
      closeDatabase(db)
    })

    it('refuses to read a row with a print_skipped it does not know', async () => {
      const db = migratedDatabase()
      const repo = await running(db)
      db.pragma('ignore_check_constraints = ON')
      db.prepare(`UPDATE album_books SET print_skipped = 'paper'`).run()

      await expect(repo.find(wedding)).rejects.toThrow(/print_skipped/)
      closeDatabase(db)
    })
  })
})
