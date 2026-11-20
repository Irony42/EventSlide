import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import request from '../interface/http/testing/request'
import { afterEach, describe, expect, it } from 'vitest'
import { anEventSettings } from '../application/testing/builders'
import { asUserId } from '../domain/shared/ids'
import { loadConfig } from '../infrastructure/config/env'
import { CSRF_COOKIE, CSRF_HEADER } from '../interface/http/middleware/csrf'
import { createContainer, type Container } from './container'

/**
 * **A guest's words in the photo book, and the three ways they leave** (spec 26, privacy),
 * through the real composition root and over HTTP: the real session, the real use cases, the real
 * SQLite adapters, the real worker and the real file store.
 *
 * A book printed with the guest book holds the words of guests. When a guest erases themselves,
 * when the host hides a message, or when the operator takes one down, the book is retired and its
 * file is gone from the disk before the next request, and the host's download answers `404`.
 * `bookInvalidation.test.ts` proves the hook with fakes and the guard test proves it is in the
 * source; this file proves `container.ts` wires the real one on each door.
 */

const OWNER = 'hote@example.test'
const PASSWORD = 'un-mot-de-passe-solide'
const SLUG = 'mariage-de-camille'

let workDir: string | null = null
let container: Container | null = null

afterEach(async () => {
  await container?.dispose()
  container = null
  if (workDir !== null) await rm(workDir, { recursive: true, force: true, maxRetries: 5 })
  workDir = null
})

const csrfOf = (headers: Record<string, unknown>): string | undefined => {
  const raw = headers['set-cookie']
  const cookies = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? [raw] : []
  const found = cookies.find((cookie) => cookie.startsWith(`${CSRF_COOKIE}=`))
  return found === undefined
    ? undefined
    : decodeURIComponent(found.slice(CSRF_COOKIE.length + 1).split(';')[0] ?? '')
}

/** A browser: one cookie jar, the CSRF token it was last handed. */
const aBrowser = async (booted: Container) => {
  const agent = request.agent(booted.app)
  let csrf = csrfOf((await agent.get('/api/auth/me')).headers) ?? ''
  const note = (response: request.Response): request.Response => {
    csrf = csrfOf(response.headers) ?? csrf
    return response
  }
  return {
    agent,
    get: async (path: string) => note(await agent.get(path)),
    post: async (path: string, body: object = {}) =>
      note(await agent.post(path).set(CSRF_HEADER, csrf).send(body)),
    patch: async (path: string, body: object = {}) =>
      note(await agent.patch(path).set(CSRF_HEADER, csrf).send(body)),
    delete: async (path: string) => note(await agent.delete(path).set(CSRF_HEADER, csrf)),
    upload: async (path: string, bytes: Buffer) =>
      note(await agent.post(path).set(CSRF_HEADER, csrf).attach('photos', bytes, 'a.jpg')),
  }
}

/**
 * An event whose album holds one photograph and one published message by Léa, and a finished
 * book that prints both. Returns what each door needs.
 */
const scene = async () => {
  workDir = await mkdtemp(join(tmpdir(), 'eventslide-book-guestbook-'))
  const booted = await createContainer(
    loadConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'fatal',
      DATABASE_PATH: join(workDir, 'eventslide.sqlite'),
      MEDIA_ROOT: join(workDir, 'media'),
      SITE_ADMIN: 'on',
      BOOK_MAX_PHOTOS: '250',
      BOOTSTRAP_OWNER_EMAIL: OWNER,
      BOOTSTRAP_OWNER_PASSWORD: PASSWORD,
    }),
  )
  container = booted
  booted.db.prepare('UPDATE users SET must_change_password = 0').run()
  const ownerId =
    booted.db
      .prepare<[string], { readonly id: string }>('SELECT id FROM users WHERE email = ?')
      .get(OWNER)?.id ?? ''

  const created = await booted.usecases.createEvent({
    ownerId: asUserId(ownerId),
    name: 'Mariage de Camille',
    slug: SLUG,
  })
  if (!created.ok) throw new Error(`fixture rejected: ${created.error.code}`)
  const eventId = created.value.id
  const settings = JSON.stringify(
    anEventSettings({ allowGuestbook: true, moderation: 'auto' }).toProps(),
  )
  booted.db
    .prepare(`UPDATE events SET status = 'live', opened_at = ?, settings = ? WHERE id = ?`)
    .run(new Date().toISOString(), settings, eventId)

  const guest = await aBrowser(booted)
  const joined = await guest.post('/api/join', {
    joinCode: created.value.joinCode.value,
    displayName: 'Léa',
  })
  expect(joined.status, JSON.stringify(joined.body)).toBe(200)
  const jpeg = await sharp({
    create: { width: 16, height: 16, channels: 3, background: { r: 30, g: 20, b: 30 } },
  })
    .jpeg()
    .toBuffer()
  const uploaded = await guest.upload(`/api/events/${SLUG}/photos`, jpeg)
  expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(201)

  const wrote = await guest.post(`/api/events/${SLUG}/guestbook`, { text: 'Longue vie aux mariés' })
  expect(wrote.status, JSON.stringify(wrote.body)).toBeLessThan(300)
  const entryId = (wrote.body as { id: string }).id
  const published = booted.db
    .prepare<[string], { readonly status: string }>(
      'SELECT status FROM guestbook_entries WHERE id = ?',
    )
    .get(entryId)?.status
  expect(published).toBe('published')

  const queued = await booted.usecases.requestAlbumBook({
    eventId,
    title: 'Mariage de Camille',
    style: 'classique',
    selection: { kind: 'all' },
    showAuthors: true,
    showCaptions: true,
    includeGuestbook: true,
    printVersion: false,
  })
  expect(queued.ok, JSON.stringify(!queued.ok && queued.error)).toBe(true)
  const drained = await booted.albumBookWorker?.runOnce()
  expect(drained?.status).toBe('completed')

  const host = await aBrowser(booted)
  const login = await host.post('/api/auth/login', { email: OWNER, password: PASSWORD })
  expect(login.status, JSON.stringify(login.body)).toBeLessThan(300)
  const confirmed = await host.post('/api/auth/step-up', { password: PASSWORD })
  expect(confirmed.status).toBeLessThan(300)

  const bookFile = join(workDir, 'media', '.books', `${eventId}.pdf`)
  const bookStatus = (): string | null =>
    booted.db
      .prepare<[string], { readonly status: string }>(
        'SELECT status FROM album_books WHERE event_id = ?',
      )
      .get(eventId)?.status ?? null

  return { booted, guest, host, entryId, bookFile, bookStatus, eventId }
}

type Scene = Awaited<ReturnType<typeof scene>>

/** The book is on the disk and downloadable, before a door is used. */
const expectServed = async (s: Scene): Promise<void> => {
  expect(s.bookStatus()).toBe('done')
  expect(existsSync(s.bookFile)).toBe(true)
  const served = await s.host.get(`/api/events/${SLUG}/book.pdf`)
  expect(served.status).toBe(200)
}

/** The host's download answers 404 and no file of the book is left. */
const expectGone = async (s: Scene): Promise<void> => {
  expect(s.bookStatus()).toBe('stale')
  expect(existsSync(s.bookFile)).toBe(false)
  for (const file of ['book.pdf', 'book-print.pdf', 'book-cover.pdf']) {
    const response = await s.host.get(`/api/events/${SLUG}/${file}`)
    expect([file, response.status, response.body.error?.code]).toEqual([file, 404, 'book.notFound'])
  }
  const state = await s.host.get(`/api/events/${SLUG}/book`)
  expect(state.body).toMatchObject({ status: 'stale', options: { includeGuestbook: true } })
}

describe('a guest’s words leave a book that prints them, through the real composition root', () => {
  it('prints the guest book into a real PDF the host can download', async () => {
    const s = await scene()

    await expectServed(s)
    const state = await s.host.get(`/api/events/${SLUG}/book`)
    expect(state.body.albumCounts).toEqual({ photos: 1, messages: 1 })
    // The form is told the box's own ceiling and that it offers the printer version.
    expect(state.body.offer).toEqual({ maxPhotos: 250, printVersion: true })
  })

  it('is retired, and its files gone, when the guest erases everything they sent', async () => {
    const s = await scene()
    await expectServed(s)

    const erased = await s.guest.delete(`/api/events/${SLUG}/guests/me`)

    expect(erased.status).toBe(200)
    await expectGone(s)
  })

  it('is retired, and its files gone, when the host hides the message', async () => {
    const s = await scene()
    await expectServed(s)

    const hidden = await s.host.patch(`/api/events/${SLUG}/guestbook/${s.entryId}/status`, {
      decision: 'hide',
    })

    expect(hidden.status, JSON.stringify(hidden.body)).toBeLessThan(300)
    await expectGone(s)
  })

  it('is retired, and its files gone, when the operator takes the message down', async () => {
    const s = await scene()
    await expectServed(s)

    const down = await s.host.post(`/api/site/guestbook-entries/${s.entryId}/take-down`, {
      reason: 'Signalement reçu, retrait conservatoire',
    })

    expect(down.status, JSON.stringify(down.body)).toBeLessThan(300)
    await expectGone(s)
  })

  it('stays when the host refuses a message that was already hidden: it was out of the book', async () => {
    const s = await scene()
    // Hiding retires the book; ask for a fresh one without the message, then refuse the hidden one.
    await s.host.patch(`/api/events/${SLUG}/guestbook/${s.entryId}/status`, { decision: 'hide' })
    await s.host.delete(`/api/events/${SLUG}/book`)
    const queued = await s.booted.usecases.requestAlbumBook({
      eventId: s.booted.db
        .prepare<[string], { readonly id: string }>('SELECT id FROM events WHERE slug = ?')
        .get(SLUG)?.id as never,
      title: 'Mariage de Camille',
      style: 'classique',
      selection: { kind: 'all' },
      showAuthors: true,
      showCaptions: true,
      includeGuestbook: true,
      printVersion: false,
    })
    expect(queued.ok).toBe(true)
    await s.booted.albumBookWorker?.runOnce()
    await expectServed(s)

    const refused = await s.host.patch(`/api/events/${SLUG}/guestbook/${s.entryId}/status`, {
      decision: 'reject',
    })

    expect(refused.status, JSON.stringify(refused.body)).toBeLessThan(300)
    await expectServed(s)
  })
})
