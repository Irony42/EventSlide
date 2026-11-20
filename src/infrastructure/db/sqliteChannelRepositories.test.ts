import { describe, expect, it } from 'vitest'
import { closeDatabase, openDatabase, type Db } from './connection'
import { migrations } from './migrations'
import { migrate } from './migrator'
import { SqliteChannelBindingRepository } from './sqliteChannelBindingRepository'
import { SqliteChannelCursorStore } from './sqliteChannelCursorStore'
import { SqliteChannelMediaJobRepository } from './sqliteChannelMediaJobRepository'
import { SqliteGuestRepository } from './sqliteGuestRepository'
import { AT, aGuest } from '../../application/testing/builders'
import {
  CHANNEL_CONTRACT_FIXTURES,
  aBinding,
  channelBindingRepositoryContract,
} from '../../application/testing/contracts/channelBindingRepositoryContract'
import { channelCursorStoreContract } from '../../application/testing/contracts/channelCursorStoreContract'
import {
  CHANNEL_JOB_CONTRACT_FIXTURES,
  aJob,
  channelMediaJobRepositoryContract,
} from '../../application/testing/contracts/channelMediaJobRepositoryContract'
import {
  asChannelBindingId,
  asChannelMediaJobId,
  asEventId,
  asGuestId,
} from '../../domain/shared/ids'

/**
 * The SQLite adapters of spec 27, held to the shared contracts, plus what only a real database can
 * say: that a purge cascades through the bindings to the queue, and that a stored value the domain
 * refuses is a loud failure rather than a quiet guess.
 */

const WEDDING = asEventId('evt-wedding')
const OWNER_ID = 'user-owner'

const migratedDatabase = (eventIds: readonly string[]): Db => {
  const db = openDatabase({ path: ':memory:' })
  migrate(db, migrations)
  db.prepare<[string, string, string]>(
    `INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, 'hash:seed', ?)`,
  ).run(OWNER_ID, 'proprietaire@example.test', AT.toISOString())
  const insert = db.prepare<[string, string, string, string, string, string]>(
    `INSERT INTO events (id, owner_id, name, slug, join_code, status, settings, quota_bytes,
                         created_at)
          VALUES (?, ?, ?, ?, ?, 'live', '{}', 1000000000, ?)`,
  )
  for (const id of eventIds) insert.run(id, OWNER_ID, id, id, id.toUpperCase(), AT.toISOString())
  return db
}

const purge = (db: Db) => async (eventId: string) => {
  db.prepare<[string]>(`DELETE FROM events WHERE id = ?`).run(eventId)
}

channelBindingRepositoryContract('sqlite', async () => {
  const db = migratedDatabase(CHANNEL_CONTRACT_FIXTURES.eventIds)
  return {
    repo: new SqliteChannelBindingRepository(db),
    purgeEvent: purge(db),
    dispose: async () => closeDatabase(db),
  }
})

const seedBindings = async (db: Db): Promise<void> => {
  const repo = new SqliteChannelBindingRepository(db)
  for (const [index, binding] of CHANNEL_JOB_CONTRACT_FIXTURES.bindings.entries()) {
    await repo.save(
      aBinding({
        id: binding.id,
        eventId: asEventId(binding.eventId),
        conversationRef: `-9${index}`,
      }),
    )
  }
}

channelMediaJobRepositoryContract('sqlite', async () => {
  const db = migratedDatabase(CHANNEL_JOB_CONTRACT_FIXTURES.eventIds)
  await seedBindings(db)
  return {
    jobs: new SqliteChannelMediaJobRepository(db),
    purgeEvent: purge(db),
    dispose: async () => closeDatabase(db),
  }
})

channelCursorStoreContract('sqlite', async () => {
  const db = migratedDatabase([])
  return { store: new SqliteChannelCursorStore(db), dispose: async () => closeDatabase(db) }
})

describe('the channel tables of migration 033', () => {
  it('takes the queue and the bindings with the event, and keeps another event’s', async () => {
    const db = migratedDatabase(CHANNEL_JOB_CONTRACT_FIXTURES.eventIds)
    await seedBindings(db)
    const jobs = new SqliteChannelMediaJobRepository(db)
    await jobs.enqueue(aJob({ id: 'job-1' }))
    await jobs.enqueue(aJob({ id: 'job-2', messageRef: 'm-2', eventId: asEventId('evt-gala') }))

    db.prepare<[string]>(`DELETE FROM events WHERE id = ?`).run('evt-wedding')

    const count = (table: string): number =>
      (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
    expect(count('channel_bindings')).toBe(1)
    expect(count('channel_media_jobs')).toBe(1)
    closeDatabase(db)
  })

  it('takes the queue of a binding with it, so a deleted binding leaves no job behind', async () => {
    const db = migratedDatabase(CHANNEL_JOB_CONTRACT_FIXTURES.eventIds)
    await seedBindings(db)
    await new SqliteChannelMediaJobRepository(db).enqueue(aJob())

    db.prepare<[string]>(`DELETE FROM channel_bindings WHERE id = ?`).run('bnd-wedding')

    expect(db.prepare(`SELECT COUNT(*) AS n FROM channel_media_jobs`).get()).toEqual({ n: 0 })
    closeDatabase(db)
  })

  it('refuses a binding title longer than the domain allows, as the schema’s last word', () => {
    const db = migratedDatabase(['evt-wedding'])

    expect(() =>
      db
        .prepare(
          `INSERT INTO channel_bindings (id, event_id, channel, conversation_ref, conversation_title,
                                         bound_at)
           VALUES ('b', 'evt-wedding', 'telegram', '-1', ?, '2026-01-01T00:00:00.000Z')`,
        )
        .run('x'.repeat(81)),
    ).toThrow()
    closeDatabase(db)
  })

  it('accepts a channel the domain does not know yet, because the column has no CHECK, and refuses to read it', async () => {
    // Adding a channel later must not rebuild a table; reading one this build does not know is loud.
    const db = migratedDatabase(['evt-wedding'])
    db.prepare(
      `INSERT INTO channel_bindings (id, event_id, channel, conversation_ref, conversation_title,
                                     bound_at)
       VALUES ('b', 'evt-wedding', 'whatsapp', '-1', 't', '2026-01-01T00:00:00.000Z')`,
    ).run()

    await expect(
      new SqliteChannelBindingRepository(db).findActive('telegram', '-1'),
    ).resolves.toBeNull()
    await expect(
      new SqliteChannelBindingRepository(db).findById(WEDDING, asChannelBindingId('b')),
    ).rejects.toThrow(/rejects/)
    closeDatabase(db)
  })

  it('reads a job of a channel this build does not know as a corrupt row', async () => {
    const db = migratedDatabase(CHANNEL_JOB_CONTRACT_FIXTURES.eventIds)
    await seedBindings(db)
    await new SqliteChannelMediaJobRepository(db).enqueue(aJob())
    db.prepare(`UPDATE channel_media_jobs SET channel = 'whatsapp'`).run()

    await expect(
      new SqliteChannelMediaJobRepository(db).findById(WEDDING, aJob().id),
    ).rejects.toThrow(/rejects/)
    closeDatabase(db)
  })

  it('refuses a guest holding one half of a messaging identity', () => {
    const db = migratedDatabase(['evt-wedding'])

    expect(() =>
      db
        .prepare(
          `INSERT INTO guests (id, event_id, display_name, joined_at, last_seen_at, channel)
           VALUES ('g', 'evt-wedding', NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'telegram')`,
        )
        .run(),
    ).toThrow()
    closeDatabase(db)
  })

  it('reads a guest of a channel this build does not know as a corrupt row', async () => {
    const db = migratedDatabase(['evt-wedding'])
    db.prepare(
      `INSERT INTO guests (id, event_id, display_name, joined_at, last_seen_at, channel, channel_sender_key)
       VALUES ('g', 'evt-wedding', NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'whatsapp', 'k')`,
    ).run()

    await expect(new SqliteGuestRepository(db).findById(WEDDING, asGuestId('g'))).rejects.toThrow(
      /rejects/,
    )
    closeDatabase(db)
  })

  it('lets an error that is not a taken conversation through, as it is', async () => {
    const db = migratedDatabase(['evt-wedding'])
    const bindings = new SqliteChannelBindingRepository(db)

    // No such event: the foreign key refuses, which is not "this conversation is taken".
    await expect(
      bindings.save(aBinding({ id: 'bnd-1', eventId: asEventId('evt-ghost') })),
    ).rejects.toThrow(/FOREIGN KEY/u)
    closeDatabase(db)
  })

  it('reads a job whose kind this build does not know as a corrupt row', async () => {
    const db = migratedDatabase(['evt-wedding'])
    await new SqliteChannelBindingRepository(db).save(aBinding({ id: 'bnd-1' }))
    db.prepare(
      `INSERT INTO channel_media_jobs (id, event_id, binding_id, channel, conversation_ref, message_ref, sender_key,
                                      kind, file_ref, declared_name, created_at, available_at, updated_at)
       VALUES ('job-1', 'evt-wedding', 'bnd-1', 'telegram', 'c', 'm', 'k', 'sticker', 'f', 'n',
               '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    ).run()

    await expect(
      new SqliteChannelMediaJobRepository(db).findById(WEDDING, asChannelMediaJobId('job-1')),
    ).rejects.toThrow(/does not know/u)
    closeDatabase(db)
  })

  it('stores a guest of the web exactly as before, with no messaging identity', async () => {
    const db = migratedDatabase(['evt-wedding'])
    const guests = new SqliteGuestRepository(db)

    await guests.save(aGuest({ id: 'guest-web', eventId: 'evt-wedding' }))

    expect(db.prepare(`SELECT channel, channel_sender_key FROM guests`).get()).toEqual({
      channel: null,
      channel_sender_key: null,
    })
    closeDatabase(db)
  })
})
