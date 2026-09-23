import { describe, expect, it } from 'vitest'
import {
  SHARE_LINK_CONTRACT_FIXTURES,
  shareLinkRepositoryContract,
} from '../../application/testing/contracts/shareLinkRepositoryContract'
import { AT, aShareLink } from '../../application/testing/builders'
import { asEventId, asShareLinkId } from '../../domain/shared/ids'
import { closeDatabase, openDatabase, type Db } from './connection'
import { migrate } from './migrator'
import { migrations } from './migrations'
import { SqliteShareLinkRepository } from './sqliteShareLinkRepository'

const ISO_AT = AT.toISOString()

const seedForeignRows = (db: Db): void => {
  const insertUser = db.prepare<{ readonly id: string; readonly at: string }>(
    `INSERT INTO users (id, email, password_hash, created_at)
          VALUES (@id, @id || '@example.test', 'hash:x', @at)`,
  )
  for (const id of SHARE_LINK_CONTRACT_FIXTURES.userIds) insertUser.run({ id, at: ISO_AT })

  const insertEvent = db.prepare<{ readonly id: string; readonly at: string }>(
    `INSERT INTO events (id, owner_id, name, slug, join_code, status, settings, quota_bytes,
                         created_at)
          VALUES (@id, 'user-1', @id, @id, @id, 'closed', '{}', 1000000000, @at)`,
  )
  for (const id of SHARE_LINK_CONTRACT_FIXTURES.eventIds) insertEvent.run({ id, at: ISO_AT })
}

const migratedDatabase = (): Db => {
  const db = openDatabase({ path: ':memory:' })
  migrate(db, migrations)
  seedForeignRows(db)
  return db
}

shareLinkRepositoryContract('sqlite', async () => {
  const db = migratedDatabase()
  return { repo: new SqliteShareLinkRepository(db), dispose: async () => closeDatabase(db) }
})

describe('SqliteShareLinkRepository schema behaviour', () => {
  it('takes the links with the event when the event is purged', async () => {
    // Retention and a host's own purge both delete the event row. A token for an album
    // that no longer exists must open nothing, and it must not be a row nobody can reach.
    const db = migratedDatabase()
    const repo = new SqliteShareLinkRepository(db)
    await repo.replaceCurrent(aShareLink({ id: 'link-1', eventId: 'evt-wedding' }), AT)

    db.prepare<[string]>(`DELETE FROM events WHERE id = ?`).run('evt-wedding')

    expect(await repo.findById(asShareLinkId('link-1'))).toBeNull()
    closeDatabase(db)
  })

  it('refuses to store anything shaped like a token where the digest belongs', () => {
    // Defence in depth under `ShareLink.create`'s own refusal: a base64url token written
    // by a future caller that bypassed the entity would be every gallery's key in plain
    // text, so the column refuses it too.
    const db = migratedDatabase()

    expect(() =>
      db
        .prepare(
          `INSERT INTO share_links (id, event_id, token_digest, created_by, created_at,
                                    expires_at)
                VALUES ('x', 'evt-wedding', 'Zm9vYmFyYmF6cXV1eC1zZWNyZXQtdG9rZW4tNDNjaGFyc3h4MTIzNDU2Nzg5',
                        'user-1', '${ISO_AT}', '2026-07-20T21:00:00.000Z')`,
        )
        .run(),
    ).toThrow(/CHECK constraint failed/)
    closeDatabase(db)
  })

  it('refuses a link that expires before it was made', () => {
    const db = migratedDatabase()

    expect(() =>
      db
        .prepare(
          `INSERT INTO share_links (id, event_id, token_digest, created_by, created_at,
                                    expires_at)
                VALUES ('x', 'evt-wedding', '${'e'.repeat(64)}', 'user-1', '${ISO_AT}',
                        '2026-01-01T00:00:00.000Z')`,
        )
        .run(),
    ).toThrow(/CHECK constraint failed/)
    closeDatabase(db)
  })

  it('never stores the token, only the digest the entity was built with', async () => {
    const db = migratedDatabase()
    const repo = new SqliteShareLinkRepository(db)
    const link = aShareLink({ id: 'link-1', eventId: 'evt-wedding' })
    await repo.replaceCurrent(link, AT)

    const columns = (db.prepare(`PRAGMA table_info(share_links)`).all() as { name: string }[]).map(
      (column) => column.name,
    )

    expect(columns).not.toContain('token')
    expect(await repo.findCurrent(asEventId('evt-wedding'))).not.toBeNull()
    closeDatabase(db)
  })
})
