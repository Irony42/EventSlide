import type { SessionData } from 'express-session'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, openDatabase, type Db } from './connection'
import { migrate } from './migrator'
import { migrations } from './migrations'
import { SqliteSessionStore } from './sqliteSessionStore'
import { silentLogger } from '../logging/pinoLogger'

const sessionWith = (maxAge: number, extra: Record<string, unknown> = {}): SessionData =>
  ({
    cookie: { originalMaxAge: maxAge, maxAge, httpOnly: true, path: '/' },
    ...extra,
  }) as unknown as SessionData

/** Promisified accessors, so the callback API does not leak into every assertion. */
const get = (store: SqliteSessionStore, sid: string): Promise<SessionData | null> =>
  new Promise((resolve, reject) => {
    store.get(sid, (error, session) => (error ? reject(error) : resolve(session ?? null)))
  })

const set = (store: SqliteSessionStore, sid: string, session: SessionData): Promise<void> =>
  new Promise((resolve, reject) => {
    store.set(sid, session, (error) => (error ? reject(error) : resolve()))
  })

const destroy = (store: SqliteSessionStore, sid: string): Promise<void> =>
  new Promise((resolve, reject) => {
    store.destroy(sid, (error) => (error ? reject(error) : resolve()))
  })

const length = (store: SqliteSessionStore): Promise<number> =>
  new Promise((resolve, reject) => {
    store.length((error, count) => (error ? reject(error) : resolve(count ?? 0)))
  })

describe('SqliteSessionStore', () => {
  let db: Db
  let store: SqliteSessionStore

  beforeEach(() => {
    db = openDatabase({ path: ':memory:' })
    migrate(db, migrations)
    store = new SqliteSessionStore({ db, logger: silentLogger() })
  })

  afterEach(() => {
    store.close()
    closeDatabase(db)
  })

  it('round-trips a session', async () => {
    await set(store, 'sid-1', sessionWith(60_000, { userId: 'user-1' }))

    const loaded = await get(store, 'sid-1')

    expect(loaded).toMatchObject({ userId: 'user-1' })
  })

  it('reports an unknown session as absent', async () => {
    expect(await get(store, 'never-existed')).toBeNull()
  })

  it('survives a restart, which MemoryStore did not', async () => {
    // The concrete 1.0 failure: restarting the server mid-event logged the host out
    // while a room full of guests was uploading.
    await set(store, 'sid-1', sessionWith(60_000, { userId: 'user-1' }))
    store.close()

    // A second store over the same database stands in for a fresh process.
    const reopened = new SqliteSessionStore({ db, logger: silentLogger() })
    const loaded = await get(reopened, 'sid-1')
    reopened.close()

    expect(loaded).toMatchObject({ userId: 'user-1' })
  })

  it('overwrites an existing session rather than failing on the primary key', async () => {
    await set(store, 'sid-1', sessionWith(60_000, { userId: 'user-1' }))
    await set(store, 'sid-1', sessionWith(60_000, { userId: 'user-2' }))

    expect(await get(store, 'sid-1')).toMatchObject({ userId: 'user-2' })
    expect(await length(store)).toBe(1)
  })

  it('treats an expired session as absent', async () => {
    await set(store, 'sid-1', sessionWith(-1_000))

    expect(await get(store, 'sid-1')).toBeNull()
  })

  it('destroys a session', async () => {
    await set(store, 'sid-1', sessionWith(60_000))

    await destroy(store, 'sid-1')

    expect(await get(store, 'sid-1')).toBeNull()
  })

  it('destroying an unknown session is not an error', async () => {
    await expect(destroy(store, 'never-existed')).resolves.toBeUndefined()
  })

  it('extends the expiry on touch without rewriting the payload', async () => {
    await set(store, 'sid-1', sessionWith(-1_000, { userId: 'user-1' }))
    expect(await get(store, 'sid-1')).toBeNull()

    store.touch('sid-1', sessionWith(60_000))

    expect(await get(store, 'sid-1')).toMatchObject({ userId: 'user-1' })
  })

  it('counts only live sessions', async () => {
    await set(store, 'live-1', sessionWith(60_000))
    await set(store, 'live-2', sessionWith(60_000))
    await set(store, 'dead', sessionWith(-1_000))

    expect(await length(store)).toBe(2)
  })

  it('sweeps expired rows so the table does not grow without bound', async () => {
    // MemoryStore never evicted, so it leaked for as long as the process lived.
    await set(store, 'live', sessionWith(60_000))
    await set(store, 'dead-1', sessionWith(-1_000))
    await set(store, 'dead-2', sessionWith(-1_000))

    const removed = store.sweep()

    expect(removed).toBe(2)
    expect(
      db.prepare<[], { count: number }>(`SELECT COUNT(*) AS count FROM sessions`).get()?.count,
    ).toBe(1)
  })

  it('clears every session', async () => {
    await set(store, 'sid-1', sessionWith(60_000))
    await set(store, 'sid-2', sessionWith(60_000))

    await new Promise<void>((resolve, reject) => {
      store.clear((error) => (error ? reject(error) : resolve()))
    })

    expect(await length(store)).toBe(0)
  })

  it('falls back to an absolute expiry when the cookie carries one instead of a maxAge', async () => {
    const future = new Date(Date.now() + 60_000)
    const session = { cookie: { expires: future, httpOnly: true } } as unknown as SessionData

    await set(store, 'sid-1', session)

    expect(await get(store, 'sid-1')).not.toBeNull()
  })

  it('applies a default lifetime when the cookie says nothing about expiry', async () => {
    const session = { cookie: {} } as unknown as SessionData

    await set(store, 'sid-1', session)

    expect(await get(store, 'sid-1')).not.toBeNull()
  })

  it('reads a corrupt row as no session rather than failing every request', async () => {
    db.prepare(`INSERT INTO sessions (sid, expires_at, data) VALUES (?, ?, ?)`).run(
      'broken',
      Date.now() + 60_000,
      'not json at all',
    )

    expect(await get(store, 'broken')).toBeNull()
  })
})
