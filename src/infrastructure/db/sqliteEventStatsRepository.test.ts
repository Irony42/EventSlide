import { describe, expect, it } from 'vitest'
import { aGuest, aPhoto, aReaction } from '../../application/testing/builders'
import {
  eventStatsRepositoryContract,
  STATS_CONTRACT_FIXTURES,
} from '../../application/testing/contracts/eventStatsRepositoryContract'
import { asEventId, asGuestId, asPhotoId } from '../../domain/shared/ids'
import { closeDatabase, openDatabase, type Db } from './connection'
import { migrations } from './migrations'
import { migrate } from './migrator'
import { SqliteEventStatsRepository, STATS_SQL } from './sqliteEventStatsRepository'
import { SqliteGuestRepository } from './sqliteGuestRepository'
import { SqlitePhotoRepository } from './sqlitePhotoRepository'
import { SqliteReactionRepository } from './sqliteReactionRepository'

const ISO_AT = '2026-06-20T21:00:00.000Z'

const migratedDatabase = (): Db => {
  const db = openDatabase({ path: ':memory:' })
  migrate(db, migrations)
  for (const id of STATS_CONTRACT_FIXTURES.userIds) {
    db.prepare(
      `INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ? || '@example.test', 'hash:x', ?)`,
    ).run(id, id, ISO_AT)
  }
  for (const id of STATS_CONTRACT_FIXTURES.eventIds) {
    db.prepare(
      `INSERT INTO events (id, owner_id, name, slug, join_code, status, settings, quota_bytes, created_at)
       VALUES (?, 'user-host', ?, ?, ?, 'live', '{}', 1000000000, ?)`,
    ).run(id, id, id, id, ISO_AT)
  }
  return db
}

const worldOf = (db: Db) => {
  const photos = new SqlitePhotoRepository(db)
  const guests = new SqliteGuestRepository(db)
  const reactions = new SqliteReactionRepository(db)
  return {
    addGuest: (guest: Parameters<SqliteGuestRepository['save']>[0]) => guests.save(guest),
    addPhoto: (photo: Parameters<SqlitePhotoRepository['save']>[0]) => photos.save(photo),
    addReaction: (reaction: Parameters<SqliteReactionRepository['save']>[0]) =>
      reactions.save(reaction),
    takeDown: (eventId: Parameters<SqlitePhotoRepository['setTakenDown']>[0], photoId: string) =>
      photos.setTakenDown(eventId, asPhotoId(photoId), new Date(ISO_AT)),
    deletePhoto: (eventId: Parameters<SqlitePhotoRepository['delete']>[0], photoId: string) =>
      photos.delete(eventId, asPhotoId(photoId)),
    // Photographs and reactions go with the guest row (`ON DELETE CASCADE`).
    deleteGuest: (eventId: Parameters<SqliteGuestRepository['delete']>[0], guestId: string) =>
      guests.delete(eventId, asGuestId(guestId)),
  }
}

eventStatsRepositoryContract('sqlite', async () => {
  const db = migratedDatabase()
  return {
    repo: new SqliteEventStatsRepository(db),
    world: worldOf(db),
    dispose: async () => closeDatabase(db),
  }
})

describe('SqliteEventStatsRepository query plans', () => {
  it('never scans photos or reactions whole, whatever the aggregate', async () => {
    const db = migratedDatabase()
    const world = worldOf(db)
    const A = asEventId('evt-a')
    await world.addGuest(aGuest({ id: 'g1', eventId: 'evt-a' }))
    await world.addGuest(aGuest({ id: 'g2', eventId: 'evt-b' }))
    for (let index = 0; index < 30; index += 1) {
      await world.addGuest(aGuest({ id: `a${index}`, eventId: 'evt-a' }))
      await world.addGuest(aGuest({ id: `b${index}`, eventId: 'evt-b' }))
    }
    // Two events of the same size: with one event holding every row, scanning the table is
    // honestly the cheapest plan and the test would be asserting against the planner's good sense.
    for (let index = 0; index < 200; index += 1) {
      for (const [event, guest] of [
        ['evt-a', 'g1'],
        ['evt-b', 'g2'],
      ] as const) {
        await world.addPhoto(
          aPhoto({
            id: `${event}-p${index}`,
            eventId: event,
            author: { kind: 'guest', id: guest },
            status: 'published',
          }),
        )
      }
    }
    await world.addReaction(
      aReaction({ id: 'r1', eventId: 'evt-a', photoId: 'evt-a-p1', guestId: 'g1' }),
    )
    db.exec('ANALYZE')

    const params: Record<keyof typeof STATS_SQL, readonly string[]> = {
      byStatus: [A],
      byQuarter: [A],
      guests: [A],
      senders: [A],
      reactions: [A, A],
      contributors: [A, A, A, A],
    }
    for (const [name, sql] of Object.entries(STATS_SQL)) {
      const plan = db
        .prepare<string[], { detail: string }>(`EXPLAIN QUERY PLAN ${sql}`)
        .all(...params[name as keyof typeof STATS_SQL])
        .map((row) => row.detail)
      const scans = plan.filter((detail) => /^SCAN (photos|reactions)\b/.test(detail))
      expect(scans, `${name}: ${plan.join(' | ')}`).toEqual([])
    }
    closeDatabase(db)
  })
})
