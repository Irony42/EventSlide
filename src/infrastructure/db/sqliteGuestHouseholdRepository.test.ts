import { describe, expect, it } from 'vitest'
import {
  GUEST_HOUSEHOLD_CONTRACT_FIXTURES,
  guestHouseholdRepositoryContract,
} from '../../application/testing/contracts/guestHouseholdRepositoryContract'
import { HOUSEHOLD_AT, aHousehold } from '../../domain/guestRsvps/testing/householdFixtures'
import { asEventId } from '../../domain/shared/ids'
import { closeDatabase, openDatabase, type Db } from './connection'
import { migrate } from './migrator'
import { migrations } from './migrations'
import { SqliteGuestHouseholdRepository } from './sqliteGuestHouseholdRepository'

const ISO_AT = HOUSEHOLD_AT.toISOString()

/** The parents the contract's rows point at; `PRAGMA foreign_keys` is ON for every connection. */
const migratedDatabase = (): Db => {
  const db = openDatabase({ path: ':memory:' })
  migrate(db, migrations)
  for (const id of GUEST_HOUSEHOLD_CONTRACT_FIXTURES.userIds) {
    db.prepare(
      `INSERT INTO users (id, email, password_hash, created_at)
            VALUES (?, ? || '@example.test', 'hash:x', ?)`,
    ).run(id, id, ISO_AT)
  }
  for (const id of GUEST_HOUSEHOLD_CONTRACT_FIXTURES.eventIds) {
    db.prepare(
      `INSERT INTO events (id, owner_id, name, slug, join_code, status, settings, quota_bytes,
                           created_at)
            VALUES (?, 'user-host', ?, ?, ?, 'live', '{}', 1000000000, ?)`,
    ).run(id, id, id, id, ISO_AT)
  }
  return db
}

guestHouseholdRepositoryContract('sqlite', async () => {
  const db = migratedDatabase()
  return {
    repo: new SqliteGuestHouseholdRepository(db),
    setEventDates: async (eventId, dates) => {
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
    },
    dispose: async () => closeDatabase(db),
  }
})

describe('SqliteGuestHouseholdRepository storage', () => {
  it('stores instants as ISO UTC text and the token in the clear', async () => {
    const db = migratedDatabase()
    const repo = new SqliteGuestHouseholdRepository(db)
    await repo.addAll(asEventId('evt-wedding'), [aHousehold({ eventId: 'evt-wedding' })])
    await repo.markReminded(
      asEventId('evt-wedding'),
      aHousehold().id,
      new Date('2026-11-24T08:00:00.000Z'),
    )

    expect(
      db
        .prepare(`SELECT token, created_at, updated_at, reminded_at, moments FROM guest_households`)
        .get(),
    ).toEqual({
      token: '7QX0M4TZ2KD9WB3H',
      created_at: ISO_AT,
      updated_at: '2026-11-24T08:00:00.000Z',
      reminded_at: '2026-11-24T08:00:00.000Z',
      moments: null,
    })
    closeDatabase(db)
  })

  it('leaves the moments of lot 4 as they are when the household is changed', async () => {
    const db = migratedDatabase()
    const repo = new SqliteGuestHouseholdRepository(db)
    const household = aHousehold({ eventId: 'evt-wedding' })
    await repo.addAll(asEventId('evt-wedding'), [household])
    db.prepare(`UPDATE guest_households SET moments = '["m-1"]'`).run()

    await repo.update(household.withInput({ name: 'Les Martin', places: 3 }, HOUSEHOLD_AT))

    expect(db.prepare(`SELECT moments FROM guest_households`).get()).toEqual({ moments: '["m-1"]' })
    closeDatabase(db)
  })

  it('refuses to read a row whose token is not one, rather than invent a household', async () => {
    const db = migratedDatabase()
    const repo = new SqliteGuestHouseholdRepository(db)
    await repo.addAll(asEventId('evt-wedding'), [aHousehold({ eventId: 'evt-wedding' })])
    db.prepare(`UPDATE guest_households SET token = 'broken'`).run()

    await expect(repo.listByEvent(asEventId('evt-wedding'))).rejects.toThrow(/malformed token/)
    closeDatabase(db)
  })

  it('goes with its event: deleting the event deletes its households', async () => {
    const db = migratedDatabase()
    await new SqliteGuestHouseholdRepository(db).addAll(asEventId('evt-wedding'), [
      aHousehold({ eventId: 'evt-wedding' }),
    ])

    db.prepare(`DELETE FROM events WHERE id = 'evt-wedding'`).run()

    expect(db.prepare(`SELECT COUNT(*) AS n FROM guest_households`).get()).toEqual({ n: 0 })
    closeDatabase(db)
  })
})
