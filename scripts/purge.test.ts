import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as FsMediaStoreModule from '../src/infrastructure/media/fsMediaStore'
import type * as PruneAuditLogModule from '../src/application/usecases/audit/pruneAuditLog'
import { aClient, anEvent } from '../src/application/testing/builders'
import type { MediaStore } from '../src/application/ports/mediaStore'
import { closeDatabase, openDatabase, type Db } from '../src/infrastructure/db/connection'
import { migrations } from '../src/infrastructure/db/migrations'
import { migrate } from '../src/infrastructure/db/migrator'
import { SqliteClientRepository } from '../src/infrastructure/db/sqliteClientRepository'
import { SqliteEventRepository } from '../src/infrastructure/db/sqliteEventRepository'

/**
 * What a switch the tests flip to make one collaborator fail, because a disk that refuses to
 * delete and an audit prune that throws cannot be produced honestly on a temp directory.
 * Both wrappers delegate to the real thing unless told otherwise.
 */
const failures = vi.hoisted(() => ({ deleteEventFor: null as string | null, auditPrune: false }))

vi.mock('../src/infrastructure/media/fsMediaStore', async (importActual) => {
  const actual = await importActual<typeof FsMediaStoreModule>()
  return {
    ...actual,
    createFsMediaStore: (...args: Parameters<typeof actual.createFsMediaStore>): MediaStore => {
      const real = actual.createFsMediaStore(...args)
      return {
        ...real,
        deleteEvent: async (eventId) => {
          if (failures.deleteEventFor === eventId) throw new Error('disk is read-only')
          return real.deleteEvent(eventId)
        },
      }
    },
  }
})

vi.mock('../src/application/usecases/audit/pruneAuditLog', async (importActual) => {
  const actual = await importActual<typeof PruneAuditLogModule>()
  return {
    ...actual,
    makePruneAuditLog: (...args: Parameters<typeof actual.makePruneAuditLog>) => {
      const real = actual.makePruneAuditLog(...args)
      return async () => {
        if (failures.auditPrune) throw new Error('audit table is locked')
        return real()
      }
    },
  }
})

// Imported after the mocks are declared (vi.mock is hoisted, so this is for the reader).
import { run } from './purge'

/**
 * The purge command as an operator runs it: argument parsing, what is printed, the exit code,
 * and above all what it does and does not touch. `--dry-run` promises "no file and no row", the
 * real run promises the same steps as the server's timer.
 */

const capture = async (call: () => Promise<number>): Promise<{ code: number; out: string }> => {
  const lines: string[] = []
  const record = (...args: unknown[]): void =>
    void lines.push(
      args.map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg))).join(' '),
    )
  const spies = [
    vi.spyOn(console, 'log').mockImplementation(record),
    vi.spyOn(console, 'warn').mockImplementation(record),
    vi.spyOn(console, 'error').mockImplementation(record),
  ]
  try {
    return { code: await call(), out: lines.join('\n') }
  } finally {
    for (const spy of spies) spy.mockRestore()
  }
}

const LONG_AGO = new Date('2020-01-01T00:00:00.000Z')
/** Far enough ahead that no clock this suite runs on has reached it. */
const FAR_AHEAD = new Date('2999-01-01T00:00:00.000Z')

const sha = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')

/** Every file under a directory with its content hash: the "media tree" a dry run must not change. */
const treeHash = (root: string, base = root): string[] =>
  readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(root, entry.name)
      return entry.isDirectory()
        ? treeHash(path, base)
        : [`${path.slice(base.length)}:${sha(path)}`]
    })
    .sort()

describe('npm run purge', () => {
  let root: string
  let databasePath: string
  let mediaRoot: string

  const env = (): NodeJS.ProcessEnv => ({
    NODE_ENV: 'production',
    DATABASE_PATH: databasePath,
    MEDIA_ROOT: mediaRoot,
  })

  const inDatabase = async <T>(use: (db: Db) => T | Promise<T>): Promise<T> => {
    const db = openDatabase({ path: databasePath })
    try {
      return await use(db)
    } finally {
      closeDatabase(db)
    }
  }

  const count = (db: Db, sql: string): number =>
    db.prepare<[], { n: number }>(`SELECT count(*) AS n FROM ${sql}`).get()?.n ?? -1

  const storeMedia = async (eventId: string): Promise<string> => {
    const shard = join(mediaRoot, eventId, 'thumb', 'aa')
    await mkdir(shard, { recursive: true })
    await writeFile(join(shard, `${'a'.repeat(64)}.jpg`), `pretend jpeg of ${eventId}`)
    return join(mediaRoot, eventId)
  }

  const insertAudit = (db: Db, at: Date, subject: string): void => {
    db.prepare(
      `INSERT INTO audit_log (at, actor_kind, action, subject_type, subject_id)
       VALUES (?, 'system', 'test.action', 'event', ?)`,
    ).run(at.toISOString(), subject)
  }

  beforeEach(async () => {
    failures.deleteEventFor = null
    failures.auditPrune = false
    root = await mkdtemp(join(tmpdir(), 'eventslide-purge-cli-'))
    databasePath = join(root, 'data', 'eventslide.sqlite')
    mediaRoot = join(root, 'media')

    const db = openDatabase({ path: databasePath })
    migrate(db, migrations)
    db.prepare(
      `INSERT INTO users (id, email, display_name, password_hash, created_at, must_change_password)
       VALUES ('user-1', 'camille@eventslide.test', 'Camille', 'not-a-real-hash',
               '2026-09-01T10:00:00.000Z', 0)`,
    ).run()
    const events = new SqliteEventRepository(db)
    // One album past its retention, one that is still running.
    await events.save(
      anEvent({
        id: 'due-event',
        slug: 'due-event',
        joinCode: 'H7K2QP',
        ownerId: 'user-1',
        status: 'closed',
        closedAt: LONG_AGO,
        settings: { retentionDays: 1 },
      }),
    )
    await events.save(
      anEvent({
        id: 'live-event',
        slug: 'live-event',
        joinCode: 'H7K2QR',
        ownerId: 'user-1',
        status: 'live',
      }),
    )
    closeDatabase(db)
    await storeMedia('due-event')
    await storeMedia('live-event')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  describe('--dry-run', () => {
    it('lists what is due and leaves the database and the media tree exactly as they were', async () => {
      // The rollback journal mode: a read-write open converts the file to WAL and rewrites its
      // header, so any non-read-only open is visible in the bytes below.
      await inDatabase((db) => db.pragma('journal_mode = DELETE'))
      const dbBefore = sha(databasePath)
      const mtimeBefore = statSync(databasePath).mtimeMs
      const treeBefore = treeHash(mediaRoot)

      const { code, out } = await capture(() => run(['--dry-run'], env()))

      expect(code).toBe(0)
      expect(out).toContain('Due for purge (1):')
      expect(out).toContain('due-event')
      expect(out).not.toContain('live-event')
      expect(out).toContain('Dry run: nothing was deleted.')
      expect(sha(databasePath)).toBe(dbBefore)
      expect(statSync(databasePath).mtimeMs).toBe(mtimeBefore)
      expect(existsSync(`${databasePath}-wal`)).toBe(false)
      expect(treeHash(mediaRoot)).toEqual(treeBefore)
    })

    it('does not finalise a client or prune the audit log either', async () => {
      await inDatabase(async (db) => {
        await new SqliteClientRepository(db).save(
          aClient({ id: 'gone-client', purgeAfter: LONG_AGO }),
        )
        insertAudit(db, LONG_AGO, 'old-subject')
      })

      const { code } = await capture(() => run(['--dry-run'], env()))

      expect(code).toBe(0)
      await inDatabase((db) => {
        expect(count(db, `clients WHERE id = 'gone-client'`)).toBe(1)
        expect(count(db, `audit_log WHERE subject_id = 'old-subject'`)).toBe(1)
      })
    })

    it('refuses a database path that does not exist, exits 1 and creates nothing', async () => {
      const missing = join(root, 'nope', 'eventslide.sqlite')

      const { code, out } = await capture(() =>
        run(['--dry-run'], { ...env(), DATABASE_PATH: missing }),
      )

      expect(code).toBe(1)
      expect(out).toContain(`there is no database at ${missing}`)
      expect(existsSync(join(root, 'nope'))).toBe(false)
    })
  })

  describe('a real run', () => {
    it('deletes the due event and its media, keeps the live one, and exits 0', async () => {
      const { code, out } = await capture(() => run([], env()))

      expect(code).toBe(0)
      expect(out).toContain('Purged 1 event(s).')
      expect(existsSync(join(mediaRoot, 'due-event'))).toBe(false)
      expect(existsSync(join(mediaRoot, 'live-event'))).toBe(true)
      await inDatabase((db) => {
        expect(count(db, `events WHERE id = 'due-event'`)).toBe(0)
        expect(count(db, `events WHERE id = 'live-event'`)).toBe(1)
      })
    })

    it('deletes the purged event book file with the album, as the timer does', async () => {
      const books = join(mediaRoot, '.books')
      await mkdir(books, { recursive: true })
      await writeFile(join(books, 'due-event.pdf'), 'pretend pdf')
      await writeFile(join(books, 'live-event.pdf'), 'pretend pdf')

      const { code } = await capture(() => run([], env()))

      expect(code).toBe(0)
      expect(existsSync(join(books, 'due-event.pdf'))).toBe(false)
      expect(existsSync(join(books, 'live-event.pdf'))).toBe(true)
    })

    it('finalises an offboarded client and prunes old audit rows, as the timer does', async () => {
      await inDatabase(async (db) => {
        await new SqliteClientRepository(db).save(
          aClient({ id: 'gone-client', purgeAfter: LONG_AGO }),
        )
        insertAudit(db, LONG_AGO, 'old-subject')
        insertAudit(db, FAR_AHEAD, 'recent-subject')
      })

      const { code } = await capture(() => run([], env()))

      expect(code).toBe(0)
      await inDatabase((db) => {
        expect(count(db, `clients WHERE id = 'gone-client'`)).toBe(0)
        expect(count(db, `audit_log WHERE subject_id = 'old-subject'`)).toBe(0)
        expect(count(db, `audit_log WHERE subject_id = 'recent-subject'`)).toBe(1)
      })
    })

    it('runs the same follow-up when no event is due', async () => {
      await inDatabase((db) => db.prepare(`DELETE FROM events WHERE id = 'due-event'`).run())
      await inDatabase(async (db) => {
        await new SqliteClientRepository(db).save(
          aClient({ id: 'gone-client', purgeAfter: LONG_AGO }),
        )
        insertAudit(db, LONG_AGO, 'old-subject')
      })

      const { code, out } = await capture(() => run([], env()))

      expect(code).toBe(0)
      expect(out).toContain('Nothing is due for purge.')
      await inDatabase((db) => {
        expect(count(db, `clients WHERE id = 'gone-client'`)).toBe(0)
        expect(count(db, `audit_log WHERE subject_id = 'old-subject'`)).toBe(0)
      })
    })

    it('exits 1 and names the event when its media cannot be deleted', async () => {
      failures.deleteEventFor = 'due-event'

      const { code, out } = await capture(() => run([], env()))

      expect(code).toBe(1)
      expect(out).toContain('Failed to purge 1 event(s):')
      expect(out).toContain('due-event')
      expect(existsSync(join(mediaRoot, 'due-event'))).toBe(true)
      // The row goes first and the bytes second: a media failure leaves files with no row.
      await inDatabase((db) => expect(count(db, `events WHERE id = 'due-event'`)).toBe(0))
    })

    it('exits 1 when a follow-up step fails, and still reports the purge', async () => {
      failures.auditPrune = true

      const { code, out } = await capture(() => run([], env()))

      expect(code).toBe(1)
      expect(out).toContain('Purged 1 event(s).')
      expect(out).toContain('audit log prune failed')
      expect(out).toContain('audit table is locked')
    })

    it('refuses to reconcile media when MEDIA_ROOT is a home directory', async () => {
      await inDatabase((db) => db.prepare(`DELETE FROM events WHERE id = 'due-event'`).run())
      const home = homedir()
      const before = readdirSync(home).sort()

      const { code, out } = await capture(() => run([], { ...env(), MEDIA_ROOT: home }))

      expect(code).toBe(0)
      expect(out).toContain('Not reconciling media: MEDIA_ROOT is not a directory of its own.')
      expect(readdirSync(home).sort()).toEqual(before)
    })

    it('refuses a database path that does not exist and creates nothing', async () => {
      const missing = join(root, 'nope', 'eventslide.sqlite')

      const { code, out } = await capture(() => run([], { ...env(), DATABASE_PATH: missing }))

      expect(code).toBe(1)
      expect(out).toContain('there is no database at')
      expect(existsSync(join(root, 'nope'))).toBe(false)
    })

    it('points at the server and db:migrate when the database has no schema yet', async () => {
      const empty = join(root, 'empty.sqlite')
      closeDatabase(openDatabase({ path: empty }))

      const { code, out } = await capture(() => run([], { ...env(), DATABASE_PATH: empty }))

      expect(code).toBe(1)
      expect(out).toContain('Purge failed: no such table')
      expect(out).toContain('Start the server once')
    })

    it('reports a configuration error as a failure, not a crash', async () => {
      const { code, out } = await capture(() => run([], { NODE_ENV: 'production', PORT: 'x' }))

      expect(code).toBe(1)
      expect(out).toContain('Purge failed:')
    })
  })
})
