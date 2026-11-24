import { describe, expect, it } from 'vitest'
import {
  GUEST_RSVP_CONTRACT_FIXTURES,
  guestRsvpRepositoryContract,
} from '../../application/testing/contracts/guestRsvpRepositoryContract'
import { aRsvp, RSVP_AT } from '../../domain/guestRsvps/testing/rsvpFixtures'
import { asEventId, asGuestRsvpId } from '../../domain/shared/ids'
import { SqliteEventRepository } from './sqliteEventRepository'
import { SqliteEventStatsRepository } from './sqliteEventStatsRepository'
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

describe('SqliteGuestRsvpRepository: the note of a guest who cannot come (spec 30, lot 4)', () => {
  const WEDDING = asEventId('evt-wedding')

  /** A reply that said no, with the guest and the guestbook entry its note made. */
  const withANote = async (db: Db, id = 'rsvp-no') => {
    const repo = new SqliteGuestRsvpRepository(db)
    await repo.admit(aRsvp({ eventId: 'evt-wedding', id, answer: 'no' }), NONE)
    db.prepare(
      `INSERT INTO guests (id, event_id, display_name, joined_at, last_seen_at, via_rsvp)
            VALUES (?, 'evt-wedding', 'Léa', ?, ?, 1)`,
    ).run(`guest-${id}`, ISO_AT, ISO_AT)
    db.prepare(
      `INSERT INTO guestbook_entries (id, event_id, guest_id, body, status, created_at)
            VALUES (?, 'evt-wedding', ?, 'Dommage', 'published', ?)`,
    ).run(`entry-${id}`, `guest-${id}`, ISO_AT)
    expect(await repo.claimAbsentNote(WEDDING, asGuestRsvpId(id), `guest-${id}`)).toBe(true)
    return repo
  }
  const count = (db: Db, table: string): number =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n

  it('goes with the reply: its author and the entry are erased in the same write', async () => {
    const db = migratedDatabase()
    const repo = await withANote(db)

    expect(await repo.delete(WEDDING, asGuestRsvpId('rsvp-no'))).toBe(true)

    expect([count(db, 'guest_rsvps'), count(db, 'guests'), count(db, 'guestbook_entries')]).toEqual(
      [0, 0, 0],
    )
    closeDatabase(db)
  })

  it('leaves a reply that has no note, and a guest of the party, alone', async () => {
    const db = migratedDatabase()
    const repo = await withANote(db)
    await repo.admit(aRsvp({ eventId: 'evt-wedding', id: 'rsvp-plain', answer: 'no' }), NONE)
    db.prepare(
      `INSERT INTO guests (id, event_id, display_name, joined_at, last_seen_at)
            VALUES ('guest-party', 'evt-wedding', 'Hugo', ?, ?)`,
    ).run(ISO_AT, ISO_AT)

    await repo.delete(WEDDING, asGuestRsvpId('rsvp-plain'))

    expect(count(db, 'guests')).toBe(2)
    expect(count(db, 'guestbook_entries')).toBe(1)
    closeDatabase(db)
  })

  it('never deletes a guest of the party that a stray id points at', async () => {
    const db = migratedDatabase()
    const repo = new SqliteGuestRsvpRepository(db)
    await repo.admit(aRsvp({ eventId: 'evt-wedding', id: 'rsvp-no', answer: 'no' }), NONE)
    db.prepare(
      `INSERT INTO guests (id, event_id, display_name, joined_at, last_seen_at)
            VALUES ('guest-party', 'evt-wedding', 'Hugo', ?, ?)`,
    ).run(ISO_AT, ISO_AT)
    db.prepare(`UPDATE guest_rsvps SET absent_note_guest_id = 'guest-party'`).run()

    await repo.delete(WEDDING, asGuestRsvpId('rsvp-no'))

    expect(count(db, 'guests')).toBe(1)
    closeDatabase(db)
  })

  it('goes with the retention sweep: the expired reply’s author and entry too, the others stay', async () => {
    const db = migratedDatabase()
    const repo = await withANote(db)
    // The second event's reply is not expired and keeps its note.
    await repo.admit(aRsvp({ eventId: 'evt-gala', id: 'rsvp-gala', answer: 'no' }), NONE)
    db.prepare(
      `INSERT INTO guests (id, event_id, display_name, joined_at, last_seen_at, via_rsvp)
            VALUES ('guest-gala', 'evt-gala', 'Zoé', ?, ?, 1)`,
    ).run(ISO_AT, ISO_AT)
    await repo.claimAbsentNote(asEventId('evt-gala'), asGuestRsvpId('rsvp-gala'), 'guest-gala')
    db.prepare(
      `UPDATE events SET closed_at = '2020-01-01T00:00:00.000Z' WHERE id = 'evt-wedding'`,
    ).run()

    expect(await repo.deleteExpired(new Date('2026-11-23T00:00:00.000Z'))).toBe(1)

    expect(db.prepare(`SELECT id FROM guests`).all()).toEqual([{ id: 'guest-gala' }])
    expect(count(db, 'guestbook_entries')).toBe(0)
    expect(count(db, 'guest_rsvps')).toBe(1)
    closeDatabase(db)
  })

  it('goes with the event: the purge takes the replies, the authors and the entries', async () => {
    const db = migratedDatabase()
    await withANote(db)

    db.prepare(`DELETE FROM events WHERE id = 'evt-wedding'`).run()

    expect([count(db, 'guest_rsvps'), count(db, 'guests'), count(db, 'guestbook_entries')]).toEqual(
      [0, 0, 0],
    )
    closeDatabase(db)
  })

  it('counts no author as a guest of the party: not on the dashboard, not in the statistics', async () => {
    const db = migratedDatabase()
    await withANote(db)
    db.prepare(
      `INSERT INTO guests (id, event_id, display_name, joined_at, last_seen_at)
            VALUES ('guest-party', 'evt-wedding', 'Hugo', ?, ?)`,
    ).run(ISO_AT, ISO_AT)

    const events = new SqliteEventRepository(db)
    const stats = new SqliteEventStatsRepository(db)

    expect((await events.countsOf(WEDDING)).guestCount).toBe(1)
    expect((await stats.readDerived(WEDDING)).guests.joined).toBe(1)
    closeDatabase(db)
  })
})
