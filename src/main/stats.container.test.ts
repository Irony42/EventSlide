import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { asUserId } from '../domain/shared/ids'
import { loadConfig } from '../infrastructure/config/env'
import { CSRF_COOKIE, CSRF_HEADER } from '../interface/http/middleware/csrf'
import { createContainer, type Container } from './container'

/**
 * **The host's statistics page through the real composition root** (spec 05): the same figures
 * the use case derives, under the states an event can be in. Real session, real SQLite, real
 * routers, because the rules are split between the repository, the entity and the route.
 *
 * - an event the operator took down is `404`, as for its photographs;
 * - a suspended client's member is `403 client.suspended`;
 * - a photograph the operator took down is in no figure;
 * - under a purge hold the page answers normally and a refused guest erasure leaves the figures
 *   exactly as they were.
 */

const OWNER = 'hote@example.org'
const PASSWORD = 'un-mot-de-passe-solide'
const SLUG = 'mariage-de-camille'
const CLIENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

let workDir: string | null = null
let container: Container | null = null

afterEach(async () => {
  await container?.dispose()
  container = null
  if (workDir !== null) await rm(workDir, { recursive: true, force: true })
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

const aBrowser = async (booted: Container) => {
  const agent = request.agent(booted.app)
  let csrf = csrfOf((await agent.get('/api/auth/me')).headers) ?? ''
  const note = (response: request.Response): request.Response => {
    csrf = csrfOf(response.headers) ?? csrf
    return response
  }
  return {
    get: async (path: string) => note(await agent.get(path)),
    post: async (path: string, body: object = {}) =>
      note(await agent.post(path).set(CSRF_HEADER, csrf).send(body)),
    delete: async (path: string) => note(await agent.delete(path).set(CSRF_HEADER, csrf)),
    upload: async (path: string, bytes: Buffer) =>
      note(await agent.post(path).set(CSRF_HEADER, csrf).attach('photos', bytes, 'photo.jpg')),
  }
}

const scene = async () => {
  workDir = await mkdtemp(join(tmpdir(), 'eventslide-stats-'))
  const booted = await createContainer(
    loadConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'fatal',
      DATABASE_PATH: join(workDir, 'eventslide.sqlite'),
      MEDIA_ROOT: join(workDir, 'media'),
      FFMPEG_PATH: join(workDir, 'no-ffmpeg-here'),
      FFPROBE_PATH: join(workDir, 'no-ffprobe-here'),
      SITE_ADMIN: 'on',
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
  const at = new Date().toISOString()
  booted.db
    .prepare('INSERT INTO clients (id, name, created_at) VALUES (?, ?, ?)')
    .run(CLIENT, 'Atelier Camille', at)

  const created = await booted.usecases.createEvent({
    ownerId: asUserId(ownerId),
    name: 'Mariage de Camille',
    slug: SLUG,
  })
  if (!created.ok) throw new Error(`fixture rejected: ${created.error.code}`)
  const eventId = created.value.id
  booted.db
    .prepare(
      `UPDATE events SET client_id = '${CLIENT}', status = 'live', opened_at = ?, settings = json_set(settings, '$.moderation', 'auto') WHERE id = ?`,
    )
    .run(at, eventId)

  const host = await aBrowser(booted)
  await host.post('/api/auth/login', { email: OWNER, password: PASSWORD })

  const guest = await aBrowser(booted)
  const joined = await guest.post('/api/join', {
    joinCode: created.value.joinCode.value,
    displayName: 'Léa',
  })
  expect(joined.status, JSON.stringify(joined.body)).toBe(200)

  const jpeg = await sharp({
    create: { width: 16, height: 16, channels: 3, background: { r: 200, g: 20, b: 30 } },
  })
    .jpeg()
    .toBuffer()
  const uploaded = await guest.upload(`/api/events/${SLUG}/photos`, jpeg)
  expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(201)
  const photoId = (uploaded.body.results[0].photoId ?? uploaded.body.results[0].id) as string

  return { booted, eventId: eventId as string, photoId, host, guest }
}

type Scene = Awaited<ReturnType<typeof scene>>

const statsOf = (s: Scene) => s.host.get(`/api/events/${SLUG}/stats`)

describe('the statistics page, through the real composition root', () => {
  it('derives the figures of the album a guest filled', async () => {
    const s = await scene()

    const response = await statsOf(s)

    expect(response.status).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.body.uploads.total).toBe(1)
    expect(response.body.guests.joined).toBe(1)
    expect(response.body.topContributors).toEqual([{ displayName: 'Léa', photos: 1, reactions: 0 }])
  })

  it('leaves a photograph the operator took down out of every figure', async () => {
    const s = await scene()
    s.booted.db
      .prepare('UPDATE photos SET taken_down_at = ? WHERE id = ?')
      .run(new Date().toISOString(), s.photoId)

    const response = await statsOf(s)

    expect(response.status).toBe(200)
    expect(response.body.uploads.total).toBe(0)
    expect(response.body.uploads.byQuarter).toEqual([])
    expect(response.body.topContributors).toEqual([])
  })

  it('answers 404 for an event the operator took down', async () => {
    const s = await scene()
    s.booted.db
      .prepare('UPDATE events SET taken_down_at = ? WHERE id = ?')
      .run(new Date().toISOString(), s.eventId)

    const response = await statsOf(s)

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('event.notFound')
  })

  it('answers 403 client.suspended for a suspended client’s member', async () => {
    const s = await scene()
    s.booted.db
      .prepare('UPDATE clients SET suspended_at = ? WHERE id = ?')
      .run(new Date().toISOString(), CLIENT)

    const response = await statsOf(s)

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('client.suspended')
  })

  it('answers normally under a purge hold, and a refused erasure leaves the figures alone', async () => {
    const s = await scene()
    const before = (await statsOf(s)).body
    s.booted.db
      .prepare('UPDATE events SET purge_held_at = ? WHERE id = ?')
      .run(new Date().toISOString(), s.eventId)

    const erased = await s.guest.delete(`/api/events/${SLUG}/guests/me`)
    const after = await statsOf(s)

    expect(erased.status).toBeGreaterThanOrEqual(400)
    expect(after.status).toBe(200)
    expect(after.body).toEqual(before)
  })
})
