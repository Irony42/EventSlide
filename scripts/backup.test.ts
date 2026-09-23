import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
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

  it('writes into BACKUP_DIR when it is not told where', async () => {
    // The bare command is what an operator types first, and in the image the old default
    // — `./backups` against a read-only `/app` — could not be written at all. The image
    // sets BACKUP_DIR; this is the half that proves the command reads it.
    const backups = join(root, 'elsewhere')
    vi.stubEnv('BACKUP_DIR', backups)
    try {
      const { code, out } = await capture(() => run(where()))

      expect(code).toBe(0)
      const written = await readdir(backups)
      expect(written).toHaveLength(1)
      expect(written[0]).toMatch(/^eventslide-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/)
      expect(await stat(join(backups, written[0] ?? '', 'manifest.json'))).toBeTruthy()
      expect(out).toContain(join(backups, written[0] ?? ''))
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('does not hand the operator --force on the happy path', async () => {
    // --force turns off the refusal to overwrite an existing installation, which is the
    // only guard a restore has. Printing it on every successful backup makes it the
    // line people paste, including on the day the target was not supposed to be
    // occupied. What --force costs is said in words instead, after the command.
    const { code, out } = await capture(() => run(['--to', archive, ...where()]))

    expect(code).toBe(0)
    expect(out).toContain(`npm run restore -- ${archive}`)
    expect(out).not.toMatch(/npm run restore -- .*--force/)
    expect(out).toContain('destroys what is there')
  })

  it('says so when the archive is on the same filesystem as the database it protects', async () => {
    // Both halves live in one temp directory here, as the image's default BACKUP_DIR is
    // on the same volume as the database. An "OK" is not a backup until a copy is
    // elsewhere, and the operator cannot see a device number. The other half — no
    // warning on another filesystem — needs two filesystems, which the image check has:
    // it backs up to the container's tmpfs and asserts the line is absent.
    const { code, out } = await capture(() => run(['--to', archive, ...where()]))

    expect(code).toBe(0)
    expect(out).toContain('on the same filesystem as the database it was taken from')
    expect(out).toContain('not a backup until a copy')
  })

  it('names the restore the image can run, when it is the compiled command', async () => {
    // Inside the container there is no `npm run restore` to paste: `scripts/` and tsx
    // are not in the image. The line an operator copies must be one that exists there,
    // and must still not carry --force.
    const { code, out } = await capture(() => run(['--to', archive, ...where()], 'node'))

    expect(code).toBe(0)
    expect(out).toContain(`node dist/ops/scripts/restore.js ${archive}`)
    expect(out).not.toContain('npm run')
    expect(out).not.toMatch(/restore\.js .*--force/)
  })

  it('says, when compiled, to restore through a one-off container and never through exec', async () => {
    // The operator has just typed `docker compose exec`, and pasting the restore behind
    // the same prefix runs it beside the live server. The restore itself can only warn
    // about that, so the line that hands it over has to say which prefix is the safe one.
    const compiled = await capture(() => run(['--to', archive, ...where()], 'node'))
    await rm(archive, { recursive: true, force: true })
    const checkout = await capture(() => run(['--to', archive, ...where()]))

    expect(compiled.out).toContain('docker compose stop eventslide')
    expect(compiled.out).toContain('docker compose run --rm eventslide')
    expect(compiled.out).toContain('never behind `exec`')
    expect(checkout.out).not.toContain('docker compose')
  })

  it('prints the compiled spelling of every command in its usage, when it is compiled', async () => {
    const { code, out } = await capture(() => run(['--help'], 'node'))

    expect(code).toBe(0)
    expect(out).toContain('node dist/ops/scripts/backup.js --verify <archive>')
    expect(out).not.toContain('npm run')
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
