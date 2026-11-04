import { describe, expect, it } from 'vitest'
import {
  CHALLENGE_CONTRACT_FIXTURES,
  challengeRepositoryContract,
} from '../../application/testing/contracts/challengeRepositoryContract'
import { AT, aMission } from '../../application/testing/builders'
import { asChallengeId, asEventId } from '../../domain/shared/ids'
import { closeDatabase, openDatabase, type Db } from './connection'
import { migrate } from './migrator'
import { migrations } from './migrations'
import { SqliteChallengeRepository } from './sqliteChallengeRepository'
import { SqliteMissionRepository } from './sqliteMissionRepository'
import { SqlitePhotoRepository } from './sqlitePhotoRepository'

const ISO_AT = AT.toISOString()

/** The parents the contract's rows point at; `PRAGMA foreign_keys` is ON for every connection. */
const migratedDatabase = (): Db => {
  const db = openDatabase({ path: ':memory:' })
  migrate(db, migrations)

  for (const id of CHALLENGE_CONTRACT_FIXTURES.userIds) {
    db.prepare(
      `INSERT INTO users (id, email, password_hash, created_at)
            VALUES (?, ? || '@example.test', 'hash:x', ?)`,
    ).run(id, id, ISO_AT)
  }
  for (const id of CHALLENGE_CONTRACT_FIXTURES.eventIds) {
    db.prepare(
      `INSERT INTO events (id, owner_id, name, slug, join_code, status, settings, quota_bytes,
                           created_at)
            VALUES (?, 'user-host', ?, ?, ?, 'live', '{}', 1000000000, ?)`,
    ).run(id, id, id, id, ISO_AT)
  }
  for (const id of CHALLENGE_CONTRACT_FIXTURES.guestIds) {
    db.prepare(
      `INSERT INTO guests (id, event_id, display_name, joined_at, last_seen_at)
            VALUES (?, 'evt-wedding', NULL, ?, ?)`,
    ).run(id, ISO_AT, ISO_AT)
  }
  return db
}

challengeRepositoryContract('sqlite', async () => {
  const db = migratedDatabase()
  return {
    repo: new SqliteChallengeRepository(db),
    photos: new SqlitePhotoRepository(db),
    missions: new SqliteMissionRepository(db),
    dispose: async () => closeDatabase(db),
  }
})

describe('SqliteChallengeRepository schema behaviour', () => {
  const seedMission = async (db: Db): Promise<void> =>
    new SqliteMissionRepository(db).save(
      aMission({ id: 'm1', eventId: 'evt-wedding', prompt: 'un selfie' }),
    )

  const insert = (db: Db, prompt = 'un selfie'): void => {
    db.prepare(
      `INSERT INTO event_challenges (id, event_id, mission_id, prompt, started_at, ends_at)
            VALUES ('c1', 'evt-wedding', 'm1', ?, ?, ?)`,
    ).run(prompt, ISO_AT, ISO_AT)
  }

  it('takes the challenges with the event when the event is purged', async () => {
    const db = migratedDatabase()
    await seedMission(db)
    insert(db)

    db.prepare(`DELETE FROM events WHERE id = 'evt-wedding'`).run()

    expect(await new SqliteChallengeRepository(db).findLatest(asEventId('evt-wedding'))).toBeNull()
  })

  it('keeps the challenge, with its frozen prompt, when its mission is deleted', async () => {
    const db = migratedDatabase()
    await seedMission(db)
    insert(db)

    db.prepare(`DELETE FROM event_missions WHERE id = 'm1'`).run()

    const kept = await new SqliteChallengeRepository(db).findLatest(asEventId('evt-wedding'))
    expect(kept?.missionId).toBeNull()
    expect(kept?.prompt.value).toBe('un selfie')
    expect(kept?.id).toBe(asChallengeId('c1'))
  })

  it('refuses to read a row whose prompt the domain refuses', async () => {
    const db = migratedDatabase()
    await seedMission(db)
    insert(db, '')

    await expect(
      new SqliteChallengeRepository(db).findLatest(asEventId('evt-wedding')),
    ).rejects.toThrow(/corrupt/)
  })
})
