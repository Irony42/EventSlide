import { describe, expect, it } from 'vitest'
import {
  GUEST_RSVP_CONTRACT_FIXTURES,
  guestRsvpRepositoryContract,
} from '../../application/testing/contracts/guestRsvpRepositoryContract'
import { aRsvp, RSVP_AT } from '../../domain/guestRsvps/testing/rsvpFixtures'
import { asEventId } from '../../domain/shared/ids'
import { closeDatabase, openDatabase, type Db } from './connection'
import { migrate } from './migrator'
import { migrations } from './migrations'
import { SqliteGuestRsvpRepository } from './sqliteGuestRsvpRepository'

const ISO_AT = RSVP_AT.toISOString()
const NONE = { capacity: null } as const

/** The parents the contract's rows point at; `PRAGMA foreign_keys` is ON for every connection. */
const migratedDatabase = (): Db => {
  const db = openDatabase({ path: ':memory:' })
  migrate(db, migrations)
  for (const id of GUEST_RSVP_CONTRACT_FIXTURES.userIds) {
    db.prepare(
      `INSERT INTO users (id, email, password_hash, created_at)
            VALUES (?, ? || '@example.test', 'hash:x', ?)`,
    ).run(id, id, ISO_AT)
  }
  for (const id of GUEST_RSVP_CONTRACT_FIXTURES.eventIds) {
    db.prepare(
      `INSERT INTO events (id, owner_id, name, slug, join_code, status, settings, quota_bytes,
                           created_at)
            VALUES (?, 'user-host', ?, ?, ?, 'live', '{}', 1000000000, ?)`,
    ).run(id, id, id, id, ISO_AT)
  }
  return db
}

/** What the expiry reads: `events.closed_at` and the invitation's `starts_at`. */
const setDates =
  (db: Db) =>
  async (
    eventId: string,
    dates: { readonly closedAt: Date | null; readonly startsAt: Date | null },
  ): Promise<void> => {
    db.prepare(`UPDATE events SET closed_at = ? WHERE id = ?`).run(
      dates.closedAt?.toISOString() ?? null,
      eventId,
    )
    db.prepare(`DELETE FROM guest_invites WHERE event_id = ?`).run(eventId)
    db.prepare(
      `INSERT INTO guest_invites (event_id, token, enabled, starts_at, time_zone, language, updated_at)
            VALUES (?, ?, 1, ?, 'UTC', 'fr', ?)`,
    ).run(
      eventId,
      eventId.padEnd(16, '0').toUpperCase(),
      dates.startsAt?.toISOString() ?? null,
      ISO_AT,
    )
  }

guestRsvpRepositoryContract('sqlite', async () => {
  const db = migratedDatabase()
  return {
    repo: new SqliteGuestRsvpRepository(db),
    addMember: async (eventId, userId) => {
      db.prepare(
        `INSERT INTO event_memberships (event_id, user_id, role, granted_at) VALUES (?, ?, 'owner', ?)`,
      ).run(eventId, userId, ISO_AT)
    },
    setEventDates: setDates(db),
    dispose: async () => closeDatabase(db),
  }
})

describe('SqliteGuestRsvpRepository storage', () => {
  it('stores instants as ISO UTC text, details as JSON, and the digest as given', async () => {
    const db = migratedDatabase()
    await new SqliteGuestRsvpRepository(db).admit(
      aRsvp({ eventId: 'evt-wedding', editTokenHash: 'digest', details: { companions: ['Hugo'] } }),
      NONE,
    )

    expect(
      db
        .prepare(`SELECT edit_token_hash, details, created_at, updated_at, source FROM guest_rsvps`)
        .get(),
    ).toEqual({
      edit_token_hash: 'digest',
      details: expect.stringContaining('"companions":["Hugo"]'),
      created_at: ISO_AT,
      updated_at: ISO_AT,
      source: 'open',
    })
    closeDatabase(db)
  })

  it('reads a row whose details are missing or of another shape without failing', async () => {
    const db = migratedDatabase()
    const repo = new SqliteGuestRsvpRepository(db)
    await repo.admit(aRsvp({ eventId: 'evt-wedding', id: 'r-null' }), NONE)
    await repo.admit(aRsvp({ eventId: 'evt-wedding', id: 'r-odd' }), NONE)
    db.prepare(`UPDATE guest_rsvps SET details = NULL WHERE id = 'r-null'`).run()
    db.prepare(`UPDATE guest_rsvps SET details = '[1,2]' WHERE id = 'r-odd'`).run()

    const list = await repo.listByEvent(asEventId('evt-wedding'))

    expect(list.map((rsvp) => rsvp.details.companions)).toEqual([[], []])
    closeDatabase(db)
  })

  it('goes with its event: deleting the event deletes its replies', async () => {
    const db = migratedDatabase()
    await new SqliteGuestRsvpRepository(db).admit(aRsvp({ eventId: 'evt-wedding' }), NONE)

    db.prepare(`DELETE FROM events WHERE id = 'evt-wedding'`).run()

    expect(db.prepare(`SELECT COUNT(*) AS n FROM guest_rsvps`).get()).toEqual({ n: 0 })
    closeDatabase(db)
  })

  it('refuses a token digest that two replies share', async () => {
    const db = migratedDatabase()
    const repo = new SqliteGuestRsvpRepository(db)
    await repo.admit(aRsvp({ eventId: 'evt-wedding', id: 'r-1', editTokenHash: 'same' }), NONE)

    await expect(
      repo.admit(aRsvp({ eventId: 'evt-gala', id: 'r-2', editTokenHash: 'same' }), NONE),
    ).rejects.toThrow(/UNIQUE/)
    closeDatabase(db)
  })
})
