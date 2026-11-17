import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { aPhoto, anEvent } from '../src/application/testing/builders'
import { readZipEnd } from '../src/domain/exports/zipEndRecord'
import { asEventId } from '../src/domain/shared/ids'
import { closeDatabase, openDatabase, type Db } from '../src/infrastructure/db/connection'
import { migrations } from '../src/infrastructure/db/migrations'
import { migrate } from '../src/infrastructure/db/migrator'
import { SqliteAlbumExportRepository } from '../src/infrastructure/db/sqliteAlbumExportRepository'
import { SqliteEventRepository } from '../src/infrastructure/db/sqliteEventRepository'
import { SqlitePhotoRepository } from '../src/infrastructure/db/sqlitePhotoRepository'
import { createFsMediaStore } from '../src/infrastructure/media/fsMediaStore'
import { human, parseOptions, run } from './export'

/**
 * The operator's export as it is typed: the arguments, what is printed, the exit code, and above
 * all what it writes and what it leaves alone. Real SQLite, real files, the real ZIP writer.
 */

const capture = async (call: () => Promise<number>): Promise<{ code: number; out: string }> => {
  const lines: string[] = []
  const record = (...args: unknown[]): void => void lines.push(args.map(String).join(' '))
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

const sha = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')

/** Closed 1 January 2020 with a retention of N days: due on 1 January 2020 plus N, long past. */
const LONG_AGO = new Date('2020-01-01T00:00:00.000Z')

describe('npm run export', () => {
  let root: string
  let databasePath: string
  let mediaRoot: string
  let target: string

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

  const album = async (db: Db, slug: string, code: string, retentionDays: number | null) => {
    const events = new SqliteEventRepository(db)
    const id = asEventId(slug)
    await events.save(
      anEvent({
        id: slug,
        slug,
        joinCode: code,
        ownerId: 'user-1',
        status: 'closed',
        closedAt: LONG_AGO,
        settings: { retentionDays },
      }),
    )
    db.prepare(
      `INSERT INTO guests (id, event_id, display_name, joined_at, last_seen_at)
       VALUES (?, ?, 'Lea', '2026-09-01T20:00:00.000Z', '2026-09-01T20:00:00.000Z')`,
    ).run(`guest-${slug}`, slug)
    const media = createFsMediaStore({ root: mediaRoot })
    const photos = new SqlitePhotoRepository(db)
    for (const n of [1, 2]) {
      const photo = aPhoto({
        id: `${slug}-p${n}`,
        eventId: slug,
        status: 'published',
        author: { kind: 'guest', id: `guest-${slug}` },
      })
      await photos.save(photo)
      await media.put(id, photo.contentHash, 'original', new TextEncoder().encode(`${slug} ${n}`))
    }
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'eventslide-export-cli-'))
    databasePath = join(root, 'data', 'eventslide.sqlite')
    mediaRoot = join(root, 'media')
    target = join(root, 'nas')
    await mkdir(mediaRoot, { recursive: true })

    const db = openDatabase({ path: databasePath })
    migrate(db, migrations)
    db.prepare(
      `INSERT INTO users (id, email, display_name, password_hash, created_at, must_change_password)
       VALUES ('user-1', 'camille@eventslide.test', 'Camille', 'not-a-real-hash',
               '2026-09-01T10:00:00.000Z', 0)`,
    ).run()
    await album(db, 'due-soon', 'H7K2QP', 1)
    // Due about eight years after it closed: outside any window an operator would type.
    await album(db, 'far-away', 'H7K2QR', 3_000)
    closeDatabase(db)
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  describe('the command line', () => {
    it('needs to be told which albums', () => {
      expect(() => parseOptions(['--to', 'x'])).toThrow(/say which albums/)
    })

    it('needs a destination unless it is a dry run', () => {
      expect(() => parseOptions(['--due-within', '14'])).toThrow(/--to/)
      expect(parseOptions(['--due-within', '14', '--dry-run']).to).toBeNull()
    })

    it('refuses a window that is not a whole number of days, and an option it does not know', () => {
      expect(() => parseOptions(['--due-within', '-1', '--to', 'x'])).toThrow(/whole number/)
      expect(() => parseOptions(['--due-within', '1.5', '--to', 'x'])).toThrow(/whole number/)
      expect(() => parseOptions(['--due-within', '1', '--to', 'x', '--force'])).toThrow(/unknown/)
      expect(() => parseOptions(['--due-within', '1', '--to'])).toThrow(/needs a value/)
    })

    it('refuses an event that is not a slug', () => {
      expect(() => parseOptions(['--event', 'Not A Slug!', '--to', 'x'])).toThrow(
        /not an event slug/,
      )
    })

    it('writes sizes as a person reads them', () => {
      expect(human(512)).toBe('512 B')
      expect(human(1536)).toBe('1.5 KB')
      expect(human(5 * 1024 ** 3)).toBe('5.0 GB')
    })

    it('exits 2 with the usage on a mistake', async () => {
      const { code, out } = await capture(() => run([], env()))

      expect(code).toBe(2)
      expect(out).toContain('Usage: npm run export')
    })
  })

  describe('a real run', () => {
    it('writes a verified archive and its manifest for the albums in the window, and nothing for the others', async () => {
      const { code, out } = await capture(() => run(['--due-within', '14', '--to', target], env()))

      expect(code).toBe(0)
      expect(readdirSync(target)).toEqual(['due-soon-2020-01-02'])
      const folder = join(target, 'due-soon-2020-01-02')
      expect(readdirSync(folder).sort()).toEqual(['MANIFEST.sha256', 'album.zip'])
      // Two photographs, and the manifest the record announces as well.
      expect(readZipEnd(new Uint8Array(readFileSync(join(folder, 'album.zip'))))).toEqual({
        entries: 3,
      })
      expect(readFileSync(join(folder, 'MANIFEST.sha256'), 'utf8')).toContain('# missing: 0')
      expect(out).toContain(`sha256=${sha(join(folder, 'album.zip'))}`)
      expect(out).toContain('files=2')
      expect(out).toContain('you are responsible')
    })

    it('opens the database read-only and marks nothing sent: the box learns nothing from a copy', async () => {
      await inDatabase((db) => db.pragma('journal_mode = DELETE'))
      const before = sha(databasePath)
      const media = readdirSync(mediaRoot)

      await capture(() => run(['--due-within', '14', '--to', target], env()))

      expect(sha(databasePath)).toBe(before)
      expect(readdirSync(mediaRoot)).toEqual(media)
      await inDatabase(async (db) => {
        const rows = await new SqliteAlbumExportRepository(db).find(asEventId('due-soon'))
        expect(rows).toBeNull()
      })
    })

    it('takes one album with --event, whatever its date', async () => {
      const { code } = await capture(() => run(['--event', 'far-away', '--to', target], env()))

      expect(code).toBe(0)
      expect(readdirSync(target)).toHaveLength(1)
      expect(readdirSync(target)[0]).toMatch(/^far-away-/)
    })

    it('exits 1 when a single album fails, and keeps no half copy of it', async () => {
      // The file of one photograph is replaced by nothing a digest could vouch for: remove the
      // media of the second album so its rows have no file, which is complete-with-missing, then
      // make the destination refuse by taking away the room.
      const { code, out } = await capture(() =>
        run(['--event', 'due-soon', '--to', target], {
          ...env(),
          MIN_FREE_DISK_BYTES: String(Number.MAX_SAFE_INTEGER),
        }),
      )

      expect(code).toBe(1)
      expect(out).toContain('FAILED  due-soon  noRoom')
      expect(existsSync(target)).toBe(false)
    })

    it('reports files missing from the box and still writes the copy', async () => {
      await rm(join(mediaRoot, 'due-soon'), { recursive: true, force: true })

      const { code, out } = await capture(() => run(['--event', 'due-soon', '--to', target], env()))

      expect(code).toBe(0)
      expect(out).toContain('missing=2')
      expect(
        readFileSync(join(target, 'due-soon-2020-01-02', 'MANIFEST.sha256'), 'utf8'),
      ).toContain('# missing: 2')
    })

    it('says so and exits 1 for an event that does not exist', async () => {
      const { code, out } = await capture(() => run(['--event', 'nobody', '--to', target], env()))

      expect(code).toBe(1)
      expect(out).toContain('no event has the slug nobody')
    })

    it('says so and exits 1 for an evening that is not over', async () => {
      await inDatabase(async (db) => {
        await new SqliteEventRepository(db).save(
          anEvent({ id: 'live', slug: 'live', joinCode: 'H7K2QS', ownerId: 'user-1' }),
        )
      })

      const { code, out } = await capture(() => run(['--event', 'live', '--to', target], env()))

      expect(code).toBe(1)
      expect(out).toContain('is not over')
    })

    it('takes an album that is already due even with a window of 0 days, and leaves the others', async () => {
      const { code, out } = await capture(() => run(['--due-within', '0', '--to', target], env()))

      expect(code).toBe(0)
      expect(out).toContain('Albums to export (1)')
    })
  })

  describe('what it prints about an album', () => {
    it('says when an album has no deletion date', async () => {
      await inDatabase((db) => album(db, 'kept', 'H7K2QT', null))

      const { code, out } = await capture(() =>
        run(['--event', 'kept', '--to', target, '--dry-run'], env()),
      )

      expect(code).toBe(0)
      expect(out).toContain('no deletion date')
    })

    it('says so when nothing is due, and writes nothing', async () => {
      await inDatabase((db) => {
        db.prepare(`UPDATE events SET purge_held_at = '2020-01-01T00:00:00.000Z'`).run()
      })

      const { code, out } = await capture(() => run(['--due-within', '14', '--to', target], env()))

      expect(code).toBe(0)
      expect(out).toContain('No album to export.')
      expect(existsSync(target)).toBe(false)
    })
  })

  describe('a failure nobody planned for', () => {
    it('says the database has no schema yet when the server never started', async () => {
      const empty = join(root, 'empty.sqlite')
      closeDatabase(openDatabase({ path: empty }))

      const { code, out } = await capture(() =>
        run(['--due-within', '14', '--to', target], { ...env(), DATABASE_PATH: empty }),
      )

      expect(code).toBe(1)
      expect(out).toContain('no such table')
      expect(out).toContain('Start the server once')
    })

    it('reports a failure that is not an Error and still returns a code', async () => {
      const argv = Object.assign([] as string[], {
        indexOf: () => {
          throw 'boom'
        },
      })

      const { code, out } = await capture(() => run(argv, env()))

      expect(code).toBe(1)
      expect(out).toContain('Export failed: boom')
    })
  })

  describe('--dry-run', () => {
    it('lists the albums and the folders and writes nothing, not even the destination', async () => {
      const { code, out } = await capture(() =>
        run(['--due-within', '14', '--to', target, '--dry-run'], env()),
      )

      expect(code).toBe(0)
      expect(out).toContain('due-soon')
      expect(out).toContain('due-soon-2020-01-02/')
      expect(out).not.toContain('far-away')
      expect(out).toContain('Dry run: nothing was written')
      expect(existsSync(target)).toBe(false)
    })

    it('works without --to', async () => {
      const { code, out } = await capture(() => run(['--due-within', '14', '--dry-run'], env()))

      expect(code).toBe(0)
      expect(out).toContain('due-soon')
    })
  })

  describe('where the copies may go', () => {
    it.each([
      ['inside the media root', () => join(mediaRoot, 'copies')],
      ['on the media root', () => mediaRoot],
      ['around the media root', () => root],
      ['around the database', () => join(root, 'data')],
    ])('refuses a destination %s, and writes and creates nothing', async (_name, where) => {
      const { code, out } = await capture(() =>
        run(['--due-within', '14', '--to', where(), '--dry-run'], env()),
      )

      expect(code).toBe(1)
      expect(out).toContain('Refusing')
      expect(out).toContain('Nothing was touched')
      expect(existsSync(join(mediaRoot, 'copies'))).toBe(false)
      expect(statSync(mediaRoot).isDirectory()).toBe(true)
      expect(readdirSync(mediaRoot).sort()).toEqual(['due-soon', 'far-away'])
    })

    it('refuses a database path that does not exist and creates nothing', async () => {
      const { code, out } = await capture(() =>
        run(['--due-within', '14', '--to', target], {
          ...env(),
          DATABASE_PATH: join(root, 'nope', 'x.sqlite'),
        }),
      )

      expect(code).toBe(1)
      expect(out).toContain('there is no database')
      expect(existsSync(join(root, 'nope'))).toBe(false)
    })
  })
})
