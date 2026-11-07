import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabase, openDatabase, type Db } from '../src/infrastructure/db/connection'
import { migrations } from '../src/infrastructure/db/migrations'
import { migrate } from '../src/infrastructure/db/migrator'
import { run } from './seedDemo'

/**
 * `npm run db:seed:demo` as a person runs it. The two things worth holding down: it refuses a
 * database that already holds an account (the demo owner's password is published in the
 * script), and on an empty one it seeds through the real use cases.
 */

const capture = async (call: () => Promise<number>): Promise<{ code: number; out: string }> => {
  const lines: string[] = []
  const record = (...args: unknown[]): void => void lines.push(args.map(String).join(' '))
  const log = vi.spyOn(console, 'log').mockImplementation(record)
  const error = vi.spyOn(console, 'error').mockImplementation(record)
  try {
    return { code: await call(), out: lines.join('\n') }
  } finally {
    log.mockRestore()
    error.mockRestore()
  }
}

describe('npm run db:seed:demo', () => {
  let root: string
  let databasePath: string

  const env = (): NodeJS.ProcessEnv => ({
    // The maintenance default: production unless said otherwise, which is the posture the
    // refusal has to hold in.
    NODE_ENV: 'production',
    DATABASE_PATH: databasePath,
    MEDIA_ROOT: join(root, 'media'),
  })

  const inDatabase = <T>(use: (db: Db) => T): T => {
    const db = openDatabase({ path: databasePath })
    try {
      return use(db)
    } finally {
      closeDatabase(db)
    }
  }

  const count = (db: Db, table: string): number =>
    db.prepare<[], { n: number }>(`SELECT count(*) AS n FROM ${table}`).get()?.n ?? -1

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'eventslide-seed-cli-'))
    databasePath = join(root, 'eventslide.sqlite')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('refuses a database that already holds an account, exits 1 and adds nothing', async () => {
    inDatabase((db) => {
      migrate(db, migrations)
      db.prepare(
        `INSERT INTO users (id, email, display_name, password_hash, created_at, must_change_password)
         VALUES ('user-1', 'real-host@eventslide.test', 'Camille', 'not-a-real-hash',
                 '2026-09-01T10:00:00.000Z', 0)`,
      ).run()
    })

    const { code, out } = await capture(() => run(env()))

    expect(code).toBe(1)
    expect(out).toContain('Refusing to seed: this database already holds an account')
    expect(out).not.toContain('Password')
    inDatabase((db) => {
      expect(count(db, 'users')).toBe(1)
      expect(count(db, 'events')).toBe(0)
    })
  })

  it('seeds an empty database: a live event, its guests, and photos with a moderation queue', async () => {
    const { code, out } = await capture(() => run(env()))

    expect(code).toBe(0)
    expect(out).toContain('Demo event seeded.')
    expect(out).toContain('/e/camille-et-sacha/display')
    expect(existsSync(databasePath)).toBe(true)
    inDatabase((db) => {
      expect(count(db, 'users')).toBe(1)
      expect(
        db
          .prepare<[], { status: string }>(
            `SELECT status FROM events WHERE slug = 'camille-et-sacha'`,
          )
          .get()?.status,
      ).toBe('live')
      expect(count(db, 'guests')).toBe(3)
      expect(count(db, 'photos')).toBe(8)
      // The last two stay pending on purpose, so the console has a queue.
      expect(count(db, `photos WHERE status = 'pending'`)).toBe(2)
    })
  }, 60_000)

  it('reports a configuration error as a failure, not a crash', async () => {
    const { code } = await capture(() => run({ NODE_ENV: 'production', PORT: 'not-a-port' }))

    expect(code).toBe(1)
  })
})
