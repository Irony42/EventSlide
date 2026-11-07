import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import request from '../interface/http/testing/request'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { DiskSpaceChecker } from '../application/ports/diskSpace'
import { asEventId, asGuestId, asPhotoId, asUserId } from '../domain/shared/ids'
import { loadConfig } from '../infrastructure/config/env'
import { CSRF_COOKIE, CSRF_HEADER } from '../interface/http/middleware/csrf'
import { createContainer, type Container } from './container'

// The real probe, unless a test sets `diskFree`: the one place the free-space reading can be steered.
const probe = vi.hoisted(() => ({
  diskFree: null as ((path: string) => number | null) | null,
}))
vi.mock('../infrastructure/system/statfsDiskSpaceChecker', async (importOriginal) => {
  const original = await importOriginal<{ statfsDiskSpaceChecker: DiskSpaceChecker }>()
  return {
    statfsDiskSpaceChecker: {
      freeBytes: async (path: string) =>
        probe.diskFree === null
          ? original.statfsDiskSpaceChecker.freeBytes(path)
          : probe.diskFree(path),
    },
  }
})

/**
 * The photo book through the real composition root (spec 04): the book is rendered by the real
 * worker into a real PDF, and every door a photograph leaves the evening by retires it and deletes
 * its file. `bookInvalidation.test.ts` proves the hook with fakes and the guard test proves it is
 * in the source; what only this file can say is that `container.ts` and `usecases.ts` wire the real
 * hook, the real file store, the real worker and the real purge together.
 */

const OWNER = 'hote@example.test'
const PASSWORD = 'un-mot-de-passe-solide'
const SLUG = 'mariage-de-camille'

/**
 * One container for the whole file: booting it (migrations, the bootstrap owner's password hash)
 * is most of what a scene costs, and it is what made each test slow enough to meet its budget
 * under load. Every test still gets an event of its own, so none sees another's photographs.
 * Keep it that way: one event per test, and no assertion on a global count (users, books, purge
 * totals), since the database and the media root are now shared and such a count would depend on
 * the order the tests run in.
 * `afterAll` has nothing in flight to wait for: the worker is never started here and `scene`
 * awaits every render, so the directory is quiet when it is removed.
 */
let workDir: string | null = null
let shared: Container | null = null
let eventCount = 0

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'eventslide-book-'))
  shared = await createContainer(
    loadConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'fatal',
      DATABASE_PATH: join(workDir, 'eventslide.sqlite'),
      MEDIA_ROOT: join(workDir, 'media'),
      BOOTSTRAP_OWNER_EMAIL: OWNER,
      BOOTSTRAP_OWNER_PASSWORD: PASSWORD,
    }),
  )
  shared.db.prepare('UPDATE users SET must_change_password = 0').run()
})

afterEach(() => {
  probe.diskFree = null
})

afterAll(async () => {
  await shared?.dispose()
  shared = null
  if (workDir !== null) await rm(workDir, { recursive: true, force: true, maxRetries: 5 })
  workDir = null
  probe.diskFree = null
})

const csrfOf = (headers: Record<string, unknown>): string => {
  const raw = headers['set-cookie']
  const cookies = Array.isArray(raw) ? (raw as string[]) : []
  const found = cookies.find((cookie) => cookie.startsWith(`${CSRF_COOKIE}=`))
  return found === undefined
    ? ''
    : decodeURIComponent(found.slice(CSRF_COOKIE.length + 1).split(';')[0] ?? '')
}

const scene = async (diskFree: ((path: string) => number | null) | null = null) => {
  if (workDir === null || shared === null) throw new Error('fixture: no container')
  const booted = shared
  const mediaRoot = join(workDir, 'media')
  eventCount += 1
  const slug = `${SLUG}-${eventCount}`
  const ownerId = booted.db
    .prepare<[string], { readonly id: string }>('SELECT id FROM users WHERE email = ?')
    .get(OWNER)?.id
  if (ownerId === undefined) throw new Error('fixture: no owner')

  const created = await booted.usecases.createEvent({
    ownerId: asUserId(ownerId),
    name: 'Mariage de Camille',
    slug,
  })
  if (!created.ok) throw new Error(`fixture rejected: ${created.error.code}`)
  const eventId = created.value.id
  booted.db
    .prepare(`UPDATE events SET status = 'live', opened_at = ? WHERE id = ?`)
    .run(new Date().toISOString(), eventId)

  // A guest uploads three photographs and the host publishes them.
  const agent = request.agent(booted.app)
  let csrf = csrfOf((await agent.get('/api/auth/me')).headers)
  const joined = await agent
    .post('/api/join')
    .set(CSRF_HEADER, csrf)
    .send({ joinCode: created.value.joinCode.value, displayName: 'Léa' })
  expect(joined.status, JSON.stringify(joined.body)).toBe(200)
  csrf = csrfOf(joined.headers) || csrf

  const photoIds: string[] = []
  for (const red of [30, 90, 150]) {
    const jpeg = await sharp({
      create: { width: 16, height: 16, channels: 3, background: { r: red, g: 20, b: 30 } },
    })
      .jpeg()
      .toBuffer()
    const uploaded = await agent
      .post(`/api/events/${slug}/photos`)
      .set(CSRF_HEADER, csrf)
      .attach('photos', jpeg, 'a.jpg')
    expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(201)
    photoIds.push((uploaded.body.results[0].photoId ?? uploaded.body.results[0].id) as string)
  }

  const guestId = booted.db
    .prepare<[string], { readonly id: string }>('SELECT id FROM guests WHERE event_id = ?')
    .get(eventId)?.id
  if (guestId === undefined) throw new Error('fixture: no guest')

  const actor = { kind: 'host', userId: asUserId(ownerId) } as const
  for (const photoId of photoIds) {
    const published = await booted.usecases.moderatePhoto({
      eventId,
      photoId: asPhotoId(photoId),
      decision: 'publish',
      actor,
    })
    expect(published.ok).toBe(true)
  }

  const queued = await booted.usecases.requestAlbumBook({
    eventId,
    title: 'Mariage de Camille',
    layout: 'one',
    showAuthors: true,
    showCaptions: true,
  })
  expect(queued.ok, JSON.stringify(!queued.ok && queued.error)).toBe(true)
  probe.diskFree = diskFree
  const worker = booted.albumBookWorker
  if (worker === null) throw new Error('fixture: the books are switched off')
  const drained = await worker.runOnce()
  expect(drained.status).toBe('completed')

  const bookStatus = (): string | null =>
    booted.db
      .prepare<[string], { readonly status: string }>(
        'SELECT status FROM album_books WHERE event_id = ?',
      )
      .get(eventId)?.status ?? null

  return {
    booted,
    eventId: asEventId(eventId),
    ownerId: asUserId(ownerId),
    guestId: asGuestId(guestId),
    photoIds: photoIds.map(asPhotoId),
    actor,
    bookStatus,
    bookFile: join(mediaRoot, '.books', `${eventId}.pdf`),
  }
}

describe('the photo book, through the real composition root', () => {
  it('renders a real PDF of the published photographs and keeps it outside the event folder', async () => {
    const s = await scene()

    expect(s.bookStatus()).toBe('done')
    expect(readFileSync(s.bookFile).subarray(0, 5).toString('latin1')).toBe('%PDF-')
    const given = await s.booted.usecases.downloadAlbumBook({ eventId: s.eventId })
    expect(given.ok && given.value.byteSize).toBe(readFileSync(s.bookFile).length)
  })

  it('is retired, and its file deleted, when the host deletes a photograph', async () => {
    const s = await scene()
    const [first] = s.photoIds
    if (first === undefined) throw new Error('fixture')

    await s.booted.usecases.deletePhoto({ eventId: s.eventId, photoId: first, actor: s.actor })

    expect(s.bookStatus()).toBe('stale')
    expect(existsSync(s.bookFile)).toBe(false)
  })

  it('is retired when the host hides a photograph', async () => {
    const s = await scene()
    const [first] = s.photoIds
    if (first === undefined) throw new Error('fixture')

    await s.booted.usecases.moderatePhoto({
      eventId: s.eventId,
      photoId: first,
      decision: 'hide',
      actor: s.actor,
    })

    expect(s.bookStatus()).toBe('stale')
    expect(existsSync(s.bookFile)).toBe(false)
  })

  it('is retired when the host refuses a batch', async () => {
    const s = await scene()

    await s.booted.usecases.moderatePhotosBulk({
      eventId: s.eventId,
      photoIds: s.photoIds.slice(0, 2),
      decision: 'reject',
      actor: s.actor,
    })

    expect(s.bookStatus()).toBe('stale')
    expect(existsSync(s.bookFile)).toBe(false)
  })

  it('is retired when the guest erases their contribution', async () => {
    const s = await scene()

    const erased = await s.booted.usecases.eraseGuestContribution({
      eventId: s.eventId,
      guestId: s.guestId,
    })

    expect(erased.ok).toBe(true)
    expect(s.bookStatus()).toBe('stale')
    expect(existsSync(s.bookFile)).toBe(false)
  })

  it('is retired when the operator takes a photograph down', async () => {
    const s = await scene()
    const [first] = s.photoIds
    if (first === undefined) throw new Error('fixture')

    await s.booted.usecases.setPhotoTakedown({
      photoId: first,
      down: true,
      reason: 'Signalement reçu, retrait conservatoire',
      actor: { kind: 'operator', userId: s.ownerId },
    })

    expect(s.bookStatus()).toBe('stale')
    expect(existsSync(s.bookFile)).toBe(false)
  })

  it('is retired when a caption changes, the book printing captions', async () => {
    const s = await scene()
    const [first] = s.photoIds
    if (first === undefined) throw new Error('fixture')

    const edited = await s.booted.usecases.setPhotoCaption({
      eventId: s.eventId,
      photoId: first,
      actor: s.actor,
      caption: 'Autre légende',
    })

    expect(edited.ok, JSON.stringify(!edited.ok && edited.error)).toBe(true)
    expect(s.bookStatus()).toBe('stale')
    expect(existsSync(s.bookFile)).toBe(false)
  })

  it('has its file deleted by the purge of the event', async () => {
    const s = await scene()
    expect(existsSync(s.bookFile)).toBe(true)

    const purged = await s.booted.usecases.purgeEvent({
      eventId: s.eventId,
      actorId: s.ownerId,
    })

    expect(purged.ok, JSON.stringify(!purged.ok && purged.error)).toBe(true)
    expect(existsSync(s.bookFile)).toBe(false)
    expect(s.bookStatus()).toBeNull()
  })
})

describe('the photo book worker, when the disk is short', () => {
  const ENOUGH = 10 ** 12

  it('fails the book when the database directory is short, though the media root has room', async () => {
    const s = await scene((path) => (path.endsWith('media') ? ENOUGH : 0))

    expect(s.bookStatus()).toBe('failed')
    expect(existsSync(s.bookFile)).toBe(false)
  })

  it('fails the book when the media root is short, though the database directory has room', async () => {
    const s = await scene((path) => (path.endsWith('media') ? 0 : ENOUGH))

    expect(s.bookStatus()).toBe('failed')
  })
})

describe('the photo book worker, when the function is off', () => {
  it('is not built at all', async () => {
    const offDir = await mkdtemp(join(tmpdir(), 'eventslide-book-off-'))
    const off = await createContainer(
      loadConfig({
        NODE_ENV: 'test',
        LOG_LEVEL: 'fatal',
        DATABASE_PATH: join(offDir, 'eventslide.sqlite'),
        MEDIA_ROOT: join(offDir, 'media'),
        BOOK_ENABLED: 'false',
      }),
    )
    try {
      expect(off.albumBookWorker).toBeNull()
    } finally {
      await off.dispose()
      await rm(offDir, { recursive: true, force: true, maxRetries: 5 })
    }
  })
})
