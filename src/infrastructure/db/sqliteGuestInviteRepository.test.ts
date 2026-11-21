import { describe, expect, it } from 'vitest'
import {
  GUEST_INVITE_CONTRACT_FIXTURES,
  guestInviteRepositoryContract,
} from '../../application/testing/contracts/guestInviteRepositoryContract'
import { AT, aGuestInvite } from '../../application/testing/builders'
import { asEventId } from '../../domain/shared/ids'
import { closeDatabase, openDatabase, type Db } from './connection'
import { migrate } from './migrator'
import { migrations } from './migrations'
import { SqliteGuestInviteRepository } from './sqliteGuestInviteRepository'

const ISO_AT = AT.toISOString()

/** The parents the contract's rows point at; `PRAGMA foreign_keys` is ON for every connection. */
const migratedDatabase = (): Db => {
  const db = openDatabase({ path: ':memory:' })
  migrate(db, migrations)
  for (const id of GUEST_INVITE_CONTRACT_FIXTURES.userIds) {
    db.prepare(
      `INSERT INTO users (id, email, password_hash, created_at)
            VALUES (?, ? || '@example.test', 'hash:x', ?)`,
    ).run(id, id, ISO_AT)
  }
  for (const id of GUEST_INVITE_CONTRACT_FIXTURES.eventIds) {
    db.prepare(
      `INSERT INTO events (id, owner_id, name, slug, join_code, status, settings, quota_bytes,
                           created_at)
            VALUES (?, 'user-host', ?, ?, ?, 'live', '{}', 1000000000, ?)`,
    ).run(id, id, id, id, ISO_AT)
  }
  return db
}

guestInviteRepositoryContract('sqlite', async () => {
  const db = migratedDatabase()
  return { repo: new SqliteGuestInviteRepository(db), dispose: async () => closeDatabase(db) }
})

describe('SqliteGuestInviteRepository storage', () => {
  it('stores instants as ISO UTC text and the switch as 0 or 1', async () => {
    const db = migratedDatabase()
    await new SqliteGuestInviteRepository(db).save(
      aGuestInvite({
        eventId: 'evt-wedding',
        enabled: true,
        startsAt: '2026-12-13T19:00:00+01:00',
        timeZone: 'Europe/Paris',
      }),
    )

    expect(db.prepare(`SELECT enabled, starts_at, time_zone FROM guest_invites`).get()).toEqual({
      enabled: 1,
      starts_at: '2026-12-13T18:00:00.000Z',
      time_zone: 'Europe/Paris',
    })
    closeDatabase(db)
  })

  it('reads a row a later release would have tightened without failing: the piece becomes empty', async () => {
    const db = migratedDatabase()
    db.prepare(
      `INSERT INTO guest_invites (event_id, token, enabled, title, time_zone, starts_at, language,
                                  updated_at)
       VALUES ('evt-wedding', '7QX0M4TZ2KD9WB3H', 1, ?, 'Mars/Olympus', ?, 'fr', ?)`,
    ).run('x'.repeat(500), '2026-12-13T18:00:00.000Z', ISO_AT)

    const read = await new SqliteGuestInviteRepository(db).findByEvent(asEventId('evt-wedding'))

    expect(read?.content).toMatchObject({ title: null, startsAt: null, timeZone: null })
    closeDatabase(db)
  })

  it('refuses to read a row whose token is corrupt', async () => {
    const db = migratedDatabase()
    db.prepare(
      `INSERT INTO guest_invites (event_id, token, enabled, language, updated_at)
       VALUES ('evt-wedding', 'short', 0, 'fr', ?)`,
    ).run(ISO_AT)

    await expect(
      new SqliteGuestInviteRepository(db).findByEvent(asEventId('evt-wedding')),
    ).rejects.toThrow(/corrupt token/)
    closeDatabase(db)
  })
})
