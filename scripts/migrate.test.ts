import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabase, openDatabase } from '../src/infrastructure/db/connection'
import { migrations } from '../src/infrastructure/db/migrations'
import { run } from './migrate'

/**
 * `npm run db:migrate` and `npm run db:status` as an operator runs them: what is printed, the
 * exit code, and what is left on disk. The migrator itself is covered by `migrator.test.ts`.
 */

const capture = (call: () => number): { code: number; out: string } => {
  const lines: string[] = []
  const record = (...args: unknown[]): void => void lines.push(args.map(String).join(' '))
  const log = vi.spyOn(console, 'log').mockImplementation(record)
  const error = vi.spyOn(console, 'error').mockImplementation(record)
  try {
    return { code: call(), out: lines.join('\n') }
  } finally {
    log.mockRestore()
    error.mockRestore()
  }
}

describe('npm run db:migrate', () => {
  let root: string
  let databasePath: string

  const env = (): NodeJS.ProcessEnv => ({ NODE_ENV: 'production', DATABASE_PATH: databasePath })

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'eventslide-migrate-cli-'))
    databasePath = join(root, 'data', 'eventslide.sqlite')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('applies every migration to a fresh path and reports them', () => {
    const { code, out } = capture(() => run([], env()))

    expect(code).toBe(0)
    expect(out).toContain(`Applied ${migrations.length} migration(s) to ${databasePath}`)
    expect(existsSync(databasePath)).toBe(true)
  })

  it('says the database is up to date on a second run, and applies nothing', () => {
    capture(() => run([], env()))

    const { code, out } = capture(() => run([], env()))

    expect(code).toBe(0)
    expect(out).toContain(`Database is up to date: ${databasePath}`)
    expect(out).not.toContain('Applied')
  })

  it('exits 1 with the migrator message on a ledger it does not recognise, and closes the file', async () => {
    capture(() => run([], env()))
    const db = openDatabase({ path: databasePath })
    db.prepare(
      `INSERT INTO schema_migrations (id, name, checksum, applied_at) VALUES (?, 'from-the-future', 'x', 'now')`,
    ).run(migrations.length + 100)
    closeDatabase(db)
    const before = readFileSync(databasePath)

    const { code, out } = capture(() => run([], env()))

    expect(code).toBe(1)
    expect(out).toContain('from-the-future')
    expect(out).toContain('this build does not know it')
    expect(readFileSync(databasePath).equals(before)).toBe(true)
    // On Windows an open handle makes this throw: the handle is released on the error path.
    await rm(databasePath, { force: true })
    expect(existsSync(databasePath)).toBe(false)
  })

  it('refuses an invalid configuration with exit 1', () => {
    const { code, out } = capture(() => run([], { NODE_ENV: 'production', PORT: 'not-a-port' }))

    expect(code).toBe(1)
    expect(out.length).toBeGreaterThan(0)
  })

  describe('--status', () => {
    it('lists applied and pending migrations', () => {
      capture(() => run([], env()))

      const { code, out } = capture(() => run(['--status'], env()))

      expect(code).toBe(0)
      expect(out).toContain(`Applied (${migrations.length}):`)
      expect(out).toContain('Pending (0):')
      expect(out).toContain(String(migrations[0]?.id).padStart(3, '0'))
    })

    it('reports a pending migration through a read-only connection, leaving the file byte for byte as it was', () => {
      capture(() => run([], env()))
      // A database in the rollback journal mode: opening it read-write converts it to WAL, which
      // rewrites the file header, so any non-read-only open of it is visible in the bytes.
      const plain = new Database(databasePath)
      plain.pragma('journal_mode = DELETE')
      plain.prepare('DELETE FROM schema_migrations WHERE id = ?').run(migrations.length)
      plain.close()
      const before = readFileSync(databasePath)

      const { code, out } = capture(() => run(['--status'], env()))

      expect(code).toBe(0)
      expect(out).toContain('Pending (1):')
      expect(readFileSync(databasePath).equals(before)).toBe(true)
      expect(existsSync(`${databasePath}-wal`)).toBe(false)
    })

    it('refuses a database path that does not exist, exits 1 and creates nothing', () => {
      const { code, out } = capture(() => run(['--status'], env()))

      expect(code).toBe(1)
      expect(out).toContain(`There is no database at ${databasePath}`)
      expect(existsSync(join(root, 'data'))).toBe(false)
    })
  })
})
