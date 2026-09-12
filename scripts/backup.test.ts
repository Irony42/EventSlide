import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabase, openDatabase } from '../src/infrastructure/db/connection'
import { migrations } from '../src/infrastructure/db/migrations'
import { migrate } from '../src/infrastructure/db/migrator'
import { run } from './backup'

/**
 * The CLI shell: argument parsing, exit codes and what an operator reads.
 *
 * `backupArchive.test.ts` covers the mechanics. This covers the part somebody actually
 * types, which is the part nothing else exercises — a command whose library is tested
 * and whose shell is not is a command whose `--verify` might have been returning 0 on a
 * damaged archive the whole time.
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

describe('npm run backup', () => {
  let root: string
  let databasePath: string
  let mediaRoot: string
  let archive: string

  const where = (): string[] => ['--database', databasePath, '--media', mediaRoot]

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'eventslide-backup-cli-'))
    databasePath = join(root, 'eventslide.sqlite')
    mediaRoot = join(root, 'media')
    archive = join(root, 'archive')

    const db = openDatabase({ path: databasePath })
    migrate(db, migrations)
    db.prepare(
      `INSERT INTO users (id, email, display_name, password_hash, created_at, must_change_password)
       VALUES ('user-1', 'camille@eventslide.test', 'Camille', 'not-a-real-hash',
               '2026-09-01T10:00:00.000Z', 0)`,
    ).run()
    closeDatabase(db)

    const shard = join(mediaRoot, 'an-event', 'thumb', 'aa')
    await mkdir(shard, { recursive: true })
    await writeFile(join(shard, `${'a'.repeat(64)}.jpg`), 'pretend jpeg')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('takes an archive and proves it before saying so', async () => {
    const { code, out } = await capture(() => run(['--to', archive, ...where()]))

    expect(code).toBe(0)
    expect(out).toContain('VACUUM INTO')
    expect(out).toContain('OK ')
    expect(out).toContain('with full checksums')
    expect(await stat(join(archive, 'manifest.json'))).toBeTruthy()
  })

  it('exits non-zero and names the damage when --verify finds a broken archive', async () => {
    expect((await capture(() => run(['--to', archive, ...where()]))).code).toBe(0)
    const photo = join(archive, 'media', 'an-event', 'thumb', 'aa', `${'a'.repeat(64)}.jpg`)
    await rm(photo)

    const { code, out } = await capture(() => run(['--verify', archive]))

    // The whole point of the command. A --verify that exits 0 on this is worse than
    // not having one, because the operator stops worrying.
    expect(code).toBe(1)
    expect(out).toContain('FAILED')
    expect(out).toContain('is missing from the archive')
    expect(out).toContain('do not let it overwrite the last one you trust')
  })

  it('says what a --quick check did not look at', async () => {
    await capture(() => run(['--to', archive, ...where()]))

    const { code, out } = await capture(() => run(['--verify', archive, '--quick']))

    expect(code).toBe(0)
    expect(out).toContain('sizes only (--quick)')
    expect(out).toContain('bytes changed while its length did not')
  })

  it('refuses to write over an older archive', async () => {
    await mkdir(archive, { recursive: true })
    await writeFile(join(archive, 'last-nights-backup.txt'), 'precious')

    const { code, out } = await capture(() => run(['--to', archive, ...where()]))

    expect(code).toBe(1)
    expect(out).toContain('already exists and is not empty')
    expect(await readFile(join(archive, 'last-nights-backup.txt'), 'utf8')).toBe('precious')
  })

  it('explains a --database that is not a database, rather than failing at the driver', async () => {
    const { code, out } = await capture(() =>
      run(['--to', archive, '--database', mediaRoot, '--media', mediaRoot]),
    )

    expect(code).toBe(1)
    expect(out).toContain('There is no database file at')
    expect(out).not.toContain('EISDIR')
  })

  it('refuses an option with nothing after it', async () => {
    const { code, out } = await capture(() => run(['--to']))

    expect(code).toBe(1)
    expect(out).toContain('--to needs a value')
  })

  it('prints the usage for --help and writes nothing', async () => {
    const { code, out } = await capture(() => run(['--help']))

    expect(code).toBe(0)
    expect(out).toContain('npm run backup:verify')
    await expect(stat(archive)).rejects.toThrow()
  })
})
