import { describe, expect, it } from 'vitest'
import {
  CLIP_JOB_CONTRACT_FIXTURES,
  clipJobRepositoryContract,
} from '../../application/testing/contracts/clipJobRepositoryContract'
import { AT, aClipJob, atPlus } from '../../application/testing/builders'
import { asClipJobId, asEventId } from '../../domain/shared/ids'
import { closeDatabase, openDatabase, type Db } from './connection'
import { migrate } from './migrator'
import { migrations } from './migrations'
import type { ClipJob } from '../../domain/clips/clipJob'
import { SqliteClipJobRepository } from './sqliteClipJobRepository'

const ISO_AT = AT.toISOString()
const WEDDING = asEventId('evt-wedding')

/**
 * `clip_jobs` carries foreign keys to `events` and `guests`, and `PRAGMA foreign_keys` is
 * ON for every connection, so a job fixture needs its parents first. `guest-1` is not in
 * the contract's fixture list but is `aClipJob()`'s default author.
 */
const GUEST_EVENTS: Readonly<Record<string, string>> = { 'guest-sam': 'evt-gala' }

const seedForeignRows = (db: Db): void => {
  db.prepare<{ readonly id: string; readonly at: string }>(
    `INSERT INTO users (id, email, password_hash, created_at)
          VALUES (@id, @id || '@example.test', 'hash:x', @at)`,
  ).run({ id: 'user-host', at: ISO_AT })

  const insertEvent = db.prepare<{ readonly id: string; readonly at: string }>(
    `INSERT INTO events (id, owner_id, name, slug, join_code, status, settings, quota_bytes,
                         created_at)
          VALUES (@id, 'user-host', @id, @id, @id, 'live', '{}', 1000000000, @at)`,
  )
  const insertGuest = db.prepare<{
    readonly id: string
    readonly eventId: string
    readonly at: string
  }>(
    `INSERT INTO guests (id, event_id, display_name, joined_at, last_seen_at)
          VALUES (@id, @eventId, NULL, @at, @at)`,
  )

  for (const id of CLIP_JOB_CONTRACT_FIXTURES.eventIds) insertEvent.run({ id, at: ISO_AT })
  for (const id of [...CLIP_JOB_CONTRACT_FIXTURES.guestIds, 'guest-1']) {
    insertGuest.run({ id, eventId: GUEST_EVENTS[id] ?? 'evt-wedding', at: ISO_AT })
  }
}

const migratedDatabase = (): Db => {
  const db = openDatabase({ path: ':memory:' })
  migrate(db, migrations)
  seedForeignRows(db)
  return db
}

clipJobRepositoryContract('sqlite', async () => {
  const db = migratedDatabase()
  let saved = 0

  const repo = new SqliteClipJobRepository(db)

  return {
    repo,
    /**
     * The only insert on this port is `stage`, so an arrange step goes through it with
     * limits that refuse nothing. The unique index still applies, which is what the two
     * duplicate-source cases are about.
     */
    insertJob: async (job): Promise<void> => {
      await repo.stage(job, {
        quotaBytes: Number.MAX_SAFE_INTEGER,
        maxQueuedClips: Number.MAX_SAFE_INTEGER,
      })
    },
    /**
     * A photograph on this event's disk. Raw SQL and a host author: this is a fixture for
     * the *clip* contract, so it must not depend on the photo repository being correct,
     * and `user-host` exists for every event while a guest exists only for its own.
     */
    savePhotoBytes: async (eventId, byteSize): Promise<void> => {
      saved += 1
      db.prepare<[string, string, string, number, string]>(
        `INSERT INTO photos (id, event_id, author_user_id, status, content_hash,
                             width, height, byte_size, created_at)
              VALUES (?, ?, 'user-host', 'published', ?, 1200, 800, ?, ?)`,
      ).run(`photo-${saved}`, eventId, String(saved).padStart(64, 'd'), byteSize, ISO_AT)
    },
    dispose: async () => closeDatabase(db),
  }
})

/**
 * Inserting, for the arrange steps below. `save` is update-only — see the port — so the
 * only door into the table is `stage`, with limits that refuse nothing.
 */
const insertOne = async (repo: SqliteClipJobRepository, job: ClipJob): Promise<void> => {
  await repo.stage(job, {
    quotaBytes: Number.MAX_SAFE_INTEGER,
    maxQueuedClips: Number.MAX_SAFE_INTEGER,
  })
}

describe('SqliteClipJobRepository schema behaviour', () => {
  // "refuses two jobs for the same bytes in one event" now lives in the shared contract,
  // on both `save` and `stage`. It was adapter-only, and that was the hole: the fake did
  // not refuse, so no ring-2 test could reproduce the race the index exists for.

  it('takes a job with the event when the event is purged', async () => {
    // The queue must not outlive the album it belongs to: a staged source whose event is
    // gone would be charged to nothing and transcoded for nobody.
    const db = migratedDatabase()
    const repo = new SqliteClipJobRepository(db)
    await insertOne(repo, aClipJob({ id: 'job-1', eventId: 'evt-wedding' }))

    db.prepare<[string]>(`DELETE FROM events WHERE id = ?`).run('evt-wedding')

    expect(await repo.findById(WEDDING, asClipJobId('job-1'))).toBeNull()
    closeDatabase(db)
  })

  it('refuses a row whose status the schema does not know', async () => {
    // A hand-edited database or a migration bug, surfaced loudly rather than projected.
    const db = migratedDatabase()
    const repo = new SqliteClipJobRepository(db)
    await insertOne(repo, aClipJob({ id: 'job-1', eventId: 'evt-wedding' }))
    // The CHECK constraint forbids this, so producing it takes a deliberate bypass — the
    // point being that the mapper refuses it too rather than trusting the column.
    db.exec(`PRAGMA ignore_check_constraints = ON`)
    db.prepare<[string]>(`UPDATE clip_jobs SET status = 'transcoding' WHERE id = ?`).run('job-1')

    await expect(repo.findById(WEDDING, asClipJobId('job-1'))).rejects.toThrow(
      /does not match the schema/,
    )
    closeDatabase(db)
  })

  it('refuses a row with no author at all', async () => {
    const db = migratedDatabase()
    const repo = new SqliteClipJobRepository(db)
    await insertOne(repo, aClipJob({ id: 'job-1', eventId: 'evt-wedding' }))
    // The CHECK constraint forbids this, so it takes a deliberate bypass to produce.
    db.exec(`PRAGMA ignore_check_constraints = ON`)
    db.prepare<[string]>(`UPDATE clip_jobs SET author_guest_id = NULL WHERE id = ?`).run('job-1')

    await expect(repo.findById(WEDDING, asClipJobId('job-1'))).rejects.toThrow(
      /neither an author guest nor an author user/,
    )
    closeDatabase(db)
  })

  it('stores a host’s own clip against the user rather than a guest', async () => {
    const db = migratedDatabase()
    const repo = new SqliteClipJobRepository(db)

    await insertOne(
      repo,
      aClipJob({ id: 'job-1', eventId: 'evt-wedding', author: { kind: 'host', id: 'user-host' } }),
    )

    expect((await repo.findById(WEDDING, asClipJobId('job-1')))?.author).toEqual({
      kind: 'host',
      userId: 'user-host',
    })
    closeDatabase(db)
  })

  it('keeps timestamps as ISO-8601 text, so they sort in SQL', async () => {
    const db = migratedDatabase()
    const repo = new SqliteClipJobRepository(db)
    await insertOne(
      repo,
      aClipJob({ id: 'job-1', eventId: 'evt-wedding', notBefore: atPlus(5_000) }),
    )

    const row = db
      .prepare<[string], { readonly not_before: string }>(
        `SELECT not_before FROM clip_jobs WHERE id = ?`,
      )
      .get('job-1')

    expect(row?.not_before).toBe(atPlus(5_000).toISOString())
    closeDatabase(db)
  })
})
