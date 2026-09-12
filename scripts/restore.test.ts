import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabase, openDatabase } from '../src/infrastructure/db/connection'
import { migrations } from '../src/infrastructure/db/migrations'
import { migrate } from '../src/infrastructure/db/migrator'
import { run as backup } from './backup'
import { run } from './restore'

/**
 * The CLI shell of the one command in this repository that deletes an operator's data.
 *
 * What is asserted here is the refusal and the warning — not that the bytes come back,
 * which `backupArchive.test.ts` and the ring-6 round trip already prove. A restore that
 * silently overwrote a live installation would pass every one of those.
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

describe('npm run restore', () => {
  let root: string
  let databasePath: string
  let mediaRoot: string
  let archive: string

  const where = (): string[] => ['--database', databasePath, '--media', mediaRoot]

  const seed = async (email: string): Promise<void> => {
    const db = openDatabase({ path: databasePath })
    migrate(db, migrations)
    db.prepare(
      `INSERT INTO users (id, email, display_name, password_hash, created_at, must_change_password)
       VALUES (?, ?, 'Camille', 'not-a-real-hash', '2026-09-01T10:00:00.000Z', 0)`,
    ).run(email, email)
    closeDatabase(db)

    const shard = join(mediaRoot, 'an-event', 'thumb', 'aa')
    await mkdir(shard, { recursive: true })
    await writeFile(join(shard, `${'a'.repeat(64)}.jpg`), 'pretend jpeg')
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'eventslide-restore-cli-'))
    databasePath = join(root, 'eventslide.sqlite')
    mediaRoot = join(root, 'media')
    archive = join(root, 'archive')

    await seed('camille@eventslide.test')
    expect((await capture(() => backup(['--to', archive, ...where()]))).code).toBe(0)
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('refuses an installation that is still there, and leaves it alone', async () => {
    const { code, out } = await capture(() => run([archive, ...where()]))

    expect(code).toBe(1)
    expect(out).toContain('Refusing to overwrite an existing installation')
    expect(out).toContain('--force')
    expect(await stat(databasePath)).toBeTruthy()
    expect(
      await stat(join(mediaRoot, 'an-event', 'thumb', 'aa', `${'a'.repeat(64)}.jpg`)),
    ).toBeTruthy()
  })

  it('prints what --force is about to destroy, before it destroys it', async () => {
    // In the output, not in --help: the person who needs to read this is the one
    // retyping a half-remembered command at two in the morning.
    const { code, out } = await capture(() => run([archive, ...where(), '--force']))

    expect(code).toBe(0)
    expect(out).toContain('THIS WILL DESTROY THE DATA BELOW')
    expect(out).toContain(databasePath)
    expect(out).toContain(mediaRoot)
    expect(out).toMatch(/1 file\(s\), .*deleted/)
    expect(out).toContain('--force was given, so this is going ahead')
    expect(out).toContain('the schema already matches this build')
  })

  it('restores into an empty target without asking for --force', async () => {
    await rm(databasePath, { force: true })
    await rm(`${databasePath}-wal`, { force: true })
    await rm(`${databasePath}-shm`, { force: true })
    await rm(mediaRoot, { recursive: true, force: true })

    const { code, out } = await capture(() => run([archive, ...where()]))

    expect(code).toBe(0)
    expect(out).not.toContain('THIS WILL DESTROY')
    expect(
      await stat(join(mediaRoot, 'an-event', 'thumb', 'aa', `${'a'.repeat(64)}.jpg`)),
    ).toBeTruthy()
  })

  it('verifies and reports without writing, on --dry-run', async () => {
    const before = (await stat(databasePath)).mtimeMs

    const { code, out } = await capture(() => run([archive, ...where(), '--dry-run']))

    expect(code).toBe(0)
    expect(out).toContain('writing nothing')
    expect(out).toContain('the real run needs --force')
    expect((await stat(databasePath)).mtimeMs).toBe(before)
  })

  it('fails the dry run on an archive that is not safe to restore', async () => {
    await rm(join(archive, 'database.sqlite'))

    const { code, out } = await capture(() => run([archive, ...where(), '--dry-run']))

    expect(code).toBe(1)
    expect(out).toContain('not safe to restore')
  })

  it('says where to point it when the path holds no archive', async () => {
    const { code, out } = await capture(() => run([join(root, 'nowhere'), ...where()]))

    expect(code).toBe(1)
    expect(out).toContain('No manifest.json')
  })

  it('asks for an archive rather than guessing one', async () => {
    const { code, out } = await capture(() => run(where()))

    expect(code).toBe(1)
    expect(out).toContain('Which archive?')
  })

  it('prints the usage when run with nothing at all', async () => {
    const { code, out } = await capture(() => run([]))

    expect(code).toBe(0)
    expect(out).toContain('Stop the server first')
  })
})
