import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyPragmas, closeDatabase, openDatabase, type Db } from './connection'

/**
 * A real file per test rather than `:memory:`, because the two properties under test
 * here — the journal mode and the directory the file needs — do not exist for an
 * in-memory database.
 */
describe('openDatabase', () => {
  let directory: string
  let file: string
  let opened: Db[]

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'eventslide-db-'))
    file = join(directory, 'data', 'eventslide.sqlite')
    opened = []
  })

  afterEach(async () => {
    for (const db of opened) closeDatabase(db)
    await rm(directory, { recursive: true, force: true })
  })

  const open = (options: { path?: string; readonly?: boolean } = {}): Db => {
    const db = openDatabase({ path: options.path ?? file, readonly: options.readonly ?? false })
    opened.push(db)
    return db
  }

  it('creates the directory the database file lives in', () => {
    // A first run on a fresh box has no `./data`, and better-sqlite3 refuses to open a
    // file whose directory does not exist rather than creating it.
    expect(existsSync(join(directory, 'data'))).toBe(false)

    open()

    expect(existsSync(file)).toBe(true)
  })

  it('enables WAL, so a reader is never blocked by an upload', () => {
    // During an event the projector polls the playlist while guests insert photos.
    // Without WAL every insert stalls the reader and the wall visibly stutters.
    const db = open()

    expect(db.pragma('journal_mode', { simple: true })).toBe('wal')
  })

  it('enforces foreign keys on the connection it is handed, whatever state it was in', () => {
    // SQLite scopes `foreign_keys` to one connection, so it can be off on one while
    // every other one enforces it — and with it off, every REFERENCES and every
    // ON DELETE CASCADE in the schema is decorative. That is why the pragmas are
    // applied per connection and nowhere else.
    const unmanaged = new Database(join(directory, 'elsewhere.sqlite'))
    opened.push(unmanaged)
    unmanaged.pragma('foreign_keys = OFF')

    applyPragmas(unmanaged)

    expect(unmanaged.pragma('foreign_keys', { simple: true })).toBe(1)
  })

  it('reads a database that is not in WAL mode through a read-only connection', () => {
    // Switching the journal mode is itself a write, so a read-only connection that
    // tried it would fail to open at all. A backup or an export is exactly the caller
    // that opens a database it is not allowed to change.
    const plain = join(directory, 'plain.sqlite')
    const writer = new Database(plain)
    writer.exec(`CREATE TABLE note (body TEXT)`)
    writer.prepare(`INSERT INTO note (body) VALUES ('bonjour')`).run()
    writer.close()

    const reader = open({ path: plain, readonly: true })

    expect(reader.prepare<[], { body: string }>(`SELECT body FROM note`).get()?.body).toBe(
      'bonjour',
    )
  })

  it('refuses a write through a read-only connection', () => {
    const writer = open()
    writer.exec(`CREATE TABLE note (body TEXT)`)

    const reader = open({ readonly: true })

    expect(() => reader.prepare(`INSERT INTO note (body) VALUES ('x')`).run()).toThrow(/readonly/i)
  })
})

describe('closeDatabase', () => {
  it('is safe to call on a connection that is already closed', () => {
    // The graceful-shutdown path and a signal handler can both reach it, and 1.0's
    // `process.on('exit')` close is exactly the kind of caller that runs twice.
    const db = openDatabase({ path: ':memory:' })
    closeDatabase(db)

    expect(() => closeDatabase(db)).not.toThrow()
    expect(db.open).toBe(false)
  })
})
