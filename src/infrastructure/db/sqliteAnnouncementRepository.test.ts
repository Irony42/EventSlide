import { describe, expect, it } from 'vitest'
import {
  ANNOUNCEMENT_CONTRACT_FIXTURES,
  announcementRepositoryContract,
} from '../../application/testing/contracts/announcementRepositoryContract'
import { AT } from '../../application/testing/builders'
import { asEventId } from '../../domain/shared/ids'
import { closeDatabase, openDatabase, type Db } from './connection'
import { migrate } from './migrator'
import { migrations } from './migrations'
import { LIST_AROUND_SQL, SqliteAnnouncementRepository } from './sqliteAnnouncementRepository'

const ISO_AT = AT.toISOString()

/** The parents the contract's rows point at; `PRAGMA foreign_keys` is ON for every connection. */
const migratedDatabase = (): Db => {
  const db = openDatabase({ path: ':memory:' })
  migrate(db, migrations)

  for (const id of ANNOUNCEMENT_CONTRACT_FIXTURES.userIds) {
    db.prepare(
      `INSERT INTO users (id, email, password_hash, created_at)
            VALUES (?, ? || '@example.test', 'hash:x', ?)`,
    ).run(id, id, ISO_AT)
  }
  for (const id of ANNOUNCEMENT_CONTRACT_FIXTURES.eventIds) {
    db.prepare(
      `INSERT INTO events (id, owner_id, name, slug, join_code, status, settings, quota_bytes,
                           created_at)
            VALUES (?, 'user-host', ?, ?, ?, 'live', '{}', 1000000000, ?)`,
    ).run(id, id, id, id, ISO_AT)
  }
  return db
}

announcementRepositoryContract('sqlite', async () => {
  const db = migratedDatabase()
  return {
    repo: new SqliteAnnouncementRepository(db),
    dispose: async () => closeDatabase(db),
  }
})

describe('SqliteAnnouncementRepository schema behaviour', () => {
  const insert = (
    db: Db,
    { id = 'a1', kind = 'fullscreen', countdown = 0, text = 'Gâteau', event = 'evt-wedding' } = {},
  ): void => {
    db.prepare(
      `INSERT INTO event_announcements
              (id, event_id, text, at, kind, duration_seconds, countdown_seconds, created_at)
            VALUES (?, ?, ?, ?, ?, 30, ?, ?)`,
    ).run(id, event, text, ISO_AT, kind, countdown, ISO_AT)
  }

  it('refuses a kind outside the closed vocabulary', () => {
    const db = migratedDatabase()

    expect(() => insert(db, { kind: 'banner' })).toThrow(/CHECK constraint failed/)
  })

  it('refuses a discreet announcement that carries a countdown', () => {
    const db = migratedDatabase()

    expect(() => insert(db, { kind: 'discreet', countdown: 60 })).toThrow(/CHECK constraint failed/)
  })

  it('accepts a fullscreen card with a countdown and a discreet one without', () => {
    const db = migratedDatabase()

    insert(db, { id: 'a1', kind: 'fullscreen', countdown: 300 })
    insert(db, { id: 'a2', kind: 'discreet', countdown: 0 })

    expect(db.prepare(`SELECT COUNT(*) AS n FROM event_announcements`).get()).toEqual({ n: 2 })
  })

  it('takes the announcements with the event when the event is purged', async () => {
    const db = migratedDatabase()
    insert(db)

    db.prepare(`DELETE FROM events WHERE id = 'evt-wedding'`).run()

    expect(await new SqliteAnnouncementRepository(db).listByEvent(asEventId('evt-wedding'))).toEqual(
      [],
    )
    expect(db.prepare(`SELECT COUNT(*) AS n FROM event_announcements`).get()).toEqual({ n: 0 })
  })

  it('refuses a row whose event does not exist', () => {
    const db = migratedDatabase()

    expect(() => insert(db, { event: 'no-such-event' })).toThrow(/FOREIGN KEY constraint failed/)
  })

  it('refuses to read a row whose text the domain refuses', async () => {
    const db = migratedDatabase()
    insert(db, { text: '' })

    await expect(
      new SqliteAnnouncementRepository(db).listByEvent(asEventId('evt-wedding')),
    ).rejects.toThrow(/corrupt/)
  })

  it('reads the wall window through the (event_id, at) index, with the adapter own statement', () => {
    const db = migratedDatabase()

    const plan = db
      .prepare<[string, string, number], { detail: string }>(
        `EXPLAIN QUERY PLAN ${LIST_AROUND_SQL}`,
      )
      .all('evt-wedding', ISO_AT, 20)
      .map((row) => row.detail)
      .join(' | ')

    expect(plan).toContain('idx_event_announcements_event_at')
    expect(plan).not.toMatch(/SCAN event_announcements/)
  })
})
