import { describe, expect, it } from 'vitest'
import {
  MISSION_CONTRACT_FIXTURES,
  missionRepositoryContract,
} from '../../application/testing/contracts/missionRepositoryContract'
import { AT, aMission, aPhoto } from '../../application/testing/builders'
import { asEventId, asMissionId, asPhotoId } from '../../domain/shared/ids'
import { closeDatabase, openDatabase, type Db } from './connection'
import { migrate } from './migrator'
import { migrations } from './migrations'
import { SqliteMissionRepository } from './sqliteMissionRepository'
import { SqlitePhotoRepository } from './sqlitePhotoRepository'

const ISO_AT = AT.toISOString()
const WEDDING = asEventId('evt-wedding')

/**
 * `event_missions` cascades from `events`, and the photographs the contract seeds carry
 * foreign keys to `events`, `guests` and `users`. `PRAGMA foreign_keys` is ON for every
 * connection, so the parents have to exist first.
 *
 * `guest-1` is not one of the contract's named guests: it is `aPhoto()`'s default author,
 * which the cases that are not about *who* sent a photograph leave alone.
 */
const GUEST_EVENTS: Readonly<Record<string, string>> = { 'guest-gala': 'evt-gala' }

const seedForeignRows = (db: Db): void => {
  const insertUser = db.prepare<{ readonly id: string; readonly at: string }>(
    `INSERT INTO users (id, email, password_hash, created_at)
          VALUES (@id, @id || '@example.test', 'hash:x', @at)`,
  )
  for (const id of MISSION_CONTRACT_FIXTURES.userIds) insertUser.run({ id, at: ISO_AT })

  const insertEvent = db.prepare<{ readonly id: string; readonly at: string }>(
    `INSERT INTO events (id, owner_id, name, slug, join_code, status, settings, quota_bytes,
                         created_at)
          VALUES (@id, 'user-host', @id, @id, @id, 'live', '{}', 1000000000, @at)`,
  )
  for (const id of MISSION_CONTRACT_FIXTURES.eventIds) insertEvent.run({ id, at: ISO_AT })

  const insertGuest = db.prepare<{
    readonly id: string
    readonly eventId: string
    readonly at: string
  }>(
    `INSERT INTO guests (id, event_id, display_name, joined_at, last_seen_at)
          VALUES (@id, @eventId, NULL, @at, @at)`,
  )
  for (const id of [...MISSION_CONTRACT_FIXTURES.guestIds, 'guest-1']) {
    insertGuest.run({ id, eventId: GUEST_EVENTS[id] ?? 'evt-wedding', at: ISO_AT })
  }
}

const migratedDatabase = (): Db => {
  const db = openDatabase({ path: ':memory:' })
  migrate(db, migrations)
  seedForeignRows(db)
  return db
}

missionRepositoryContract('sqlite', async () => {
  const db = migratedDatabase()
  return {
    repo: new SqliteMissionRepository(db),
    photos: new SqlitePhotoRepository(db),
    dispose: async () => closeDatabase(db),
  }
})

describe('SqliteMissionRepository schema behaviour', () => {
  it('takes the missions with the event when the event is purged', async () => {
    // The cascade `purgeEvent` relies on. A prompt belonging to an album that is gone
    // would be a row nothing can reach and nothing can delete.
    const db = migratedDatabase()
    const repo = new SqliteMissionRepository(db)
    await repo.save(aMission({ id: 'm1', eventId: 'evt-wedding' }))

    db.prepare<[string]>(`DELETE FROM events WHERE id = ?`).run('evt-wedding')

    expect(await repo.findById(WEDDING, asMissionId('m1'))).toBeNull()
    closeDatabase(db)
  })

  it('refuses a stored scope the domain does not have, rather than projecting it', async () => {
    // A hand-edited or restored row. The wall is the one surface where rendering
    // whatever the column holds costs the room its evening, so the mapper fails loudly.
    const db = migratedDatabase()
    const repo = new SqliteMissionRepository(db)
    await repo.save(aMission({ id: 'm1', eventId: 'evt-wedding' }))
    // The `CHECK` refuses this on the way in, which is the point — so the only way to
    // produce the row this guard is for is to switch the constraint off, exactly as a
    // restore from a hand-edited dump would.
    db.pragma('ignore_check_constraints = ON')
    db.prepare(`UPDATE event_missions SET scope = 'room' WHERE id = 'm1'`).run()
    db.pragma('ignore_check_constraints = OFF')

    await expect(repo.findById(WEDDING, asMissionId('m1'))).rejects.toThrow(/unknown scope/)
    closeDatabase(db)
  })

  it('refuses a stored prompt the domain would not accept', async () => {
    const db = migratedDatabase()
    const repo = new SqliteMissionRepository(db)
    await repo.save(aMission({ id: 'm1', eventId: 'evt-wedding' }))
    db.prepare<[string]>(`UPDATE event_missions SET prompt = ? WHERE id = 'm1'`).run(
      'x'.repeat(200),
    )

    await expect(repo.findById(WEDDING, asMissionId('m1'))).rejects.toThrow(/prompt the domain/)
    closeDatabase(db)
  })

  it('stores the tag on the photograph and reads it back', async () => {
    // The other half of the mapper: `mission_id` has to survive a round trip through
    // `photos`, or a guest's tag is accepted and silently forgotten.
    const db = migratedDatabase()
    const missions = new SqliteMissionRepository(db)
    const photos = new SqlitePhotoRepository(db)
    await missions.save(aMission({ id: 'm1', eventId: 'evt-wedding' }))

    await photos.save(aPhoto({ id: 'p1', eventId: 'evt-wedding', missionId: 'm1' }))

    expect((await photos.findById(WEDDING, asPhotoId('p1')))?.missionId).toBe('m1')
    closeDatabase(db)
  })

  it('keeps the tag when the photograph is moderated', async () => {
    // `save` is the update path, and an update that dropped the column would unfile
    // every photograph the moment a host published it — which is the moment it starts
    // counting.
    const db = migratedDatabase()
    const missions = new SqliteMissionRepository(db)
    const photos = new SqlitePhotoRepository(db)
    await missions.save(aMission({ id: 'm1', eventId: 'evt-wedding' }))
    await photos.save(aPhoto({ id: 'p1', eventId: 'evt-wedding', missionId: 'm1' }))

    await photos.save(
      aPhoto({ id: 'p1', eventId: 'evt-wedding', missionId: 'm1', status: 'published' }),
    )

    expect((await photos.findById(WEDDING, asPhotoId('p1')))?.missionId).toBe('m1')
    closeDatabase(db)
  })

  it('refuses a photograph tagged with a mission that does not exist', async () => {
    const db = migratedDatabase()
    const photos = new SqlitePhotoRepository(db)

    await expect(
      photos.save(aPhoto({ id: 'p1', eventId: 'evt-wedding', missionId: 'ghost' })),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/)
    closeDatabase(db)
  })
})
