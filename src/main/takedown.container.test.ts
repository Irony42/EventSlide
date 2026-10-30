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
 * **The operator's "remove without viewing" levers, through the real composition root** (launch
 * review S5, G8-03): a photograph taken down by its id leaves the wall, the guest's feed, the
 * host's grid, a gallery link and the media route; an event taken down is the same 404 as an
 * unknown one for its guests, its public and its own host; a purge hold keeps the retention sweep
 * off an event and a host's hands off its photographs; and the owner of a suspended client no
 * longer reads photographs. The real session, step-up, SQLite adapters and use cases, because the
 * rule is enforced in the repository, the entity and four routers at once.
 */

const OPERATOR = 'operateur@example.org'
const PASSWORD = 'un-mot-de-passe-solide'
const SLUG = 'mariage-de-camille'
const CLIENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const NO_SUCH = 'un-mariage-qui-nexiste-pas'
const REASON = 'Signalement reçu, retrait conservatoire'

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
    patch: async (path: string, body: object = {}) =>
      note(await agent.patch(path).set(CSRF_HEADER, csrf).send(body)),
    delete: async (path: string) => note(await agent.delete(path).set(CSRF_HEADER, csrf)),
    upload: async (path: string, bytes: Buffer) =>
      note(await agent.post(path).set(CSRF_HEADER, csrf).attach('photos', bytes, 'photo.jpg')),
  }
}

type Browser = Awaited<ReturnType<typeof aBrowser>>

const answer = (response: request.Response) => ({
  status: response.status,
  body: response.body as unknown,
  cacheControl: response.headers['cache-control'],
})

const scene = async () => {
  workDir = await mkdtemp(join(tmpdir(), 'eventslide-takedown-'))
  const booted = await createContainer(
    loadConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'fatal',
      DATABASE_PATH: join(workDir, 'eventslide.sqlite'),
      MEDIA_ROOT: join(workDir, 'media'),
      FFMPEG_PATH: join(workDir, 'no-ffmpeg-here'),
      FFPROBE_PATH: join(workDir, 'no-ffprobe-here'),
      SITE_ADMIN: 'on',
      BOOTSTRAP_OWNER_EMAIL: OPERATOR,
      BOOTSTRAP_OWNER_PASSWORD: PASSWORD,
    }),
  )
  container = booted
  booted.db.prepare('UPDATE users SET must_change_password = 0').run()
  const operatorId =
    booted.db
      .prepare<[string], { readonly id: string }>('SELECT id FROM users WHERE email = ?')
      .get(OPERATOR)?.id ?? ''
  const at = new Date().toISOString()
  booted.db
    .prepare('INSERT INTO clients (id, name, created_at) VALUES (?, ?, ?)')
    .run(CLIENT, 'Atelier Camille', at)

  const created = await booted.usecases.createEvent({
    ownerId: asUserId(operatorId),
    name: 'Mariage de Camille',
    slug: SLUG,
  })
  if (!created.ok) throw new Error(`fixture rejected: ${created.error.code}`)
  const eventId = created.value.id
  booted.db
    .prepare(
      `UPDATE events SET client_id = '${CLIENT}', status = 'live', opened_at = ? WHERE id = ?`,
    )
    .run(at, eventId)

  const link = await booted.usecases.createShareLink({
    eventId,
    actorId: asUserId(operatorId),
  })
  if (!link.ok) throw new Error(`fixture rejected: ${link.error.code}`)

  // The operator, who is also the host here (the account the box has), confirmed.
  const host = await aBrowser(booted)
  await host.post('/api/auth/login', { email: OPERATOR, password: PASSWORD })
  expect((await host.post('/api/auth/step-up', { password: PASSWORD })).status).toBeLessThan(300)
  expect((await host.patch(`/api/events/${SLUG}/settings`, { moderation: 'auto' })).status).toBe(
    200,
  )

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

  const stranger = await aBrowser(booted)
  return {
    booted,
    eventId: eventId as string,
    photoId,
    token: link.value.token,
    host,
    guest,
    stranger,
    joinCode: created.value.joinCode.value,
  }
}

type Scene = Awaited<ReturnType<typeof scene>>

const act = (s: Scene, path: string, reason: string = REASON) =>
  s.host.post(`/api/site/${path}`, { reason })

const mediaPath = (s: Scene) => `/api/events/${SLUG}/photos/${s.photoId}/display`

/** Every place the photograph can be read from, as what each answers about it. */
const readings = async (s: Scene) => ({
  wall: JSON.stringify((await s.stranger.get(`/api/events/${SLUG}/wall`)).body).includes(s.photoId),
  mine: JSON.stringify((await s.guest.get(`/api/events/${SLUG}/photos/mine`)).body).includes(
    s.photoId,
  ),
  hostGrid: JSON.stringify((await s.host.get(`/api/events/${SLUG}/photos`)).body).includes(
    s.photoId,
  ),
  queue: JSON.stringify(
    (await s.host.get(`/api/events/${SLUG}/moderation?status=all`)).body,
  ).includes(s.photoId),
  gallery: JSON.stringify((await s.stranger.get(`/api/gallery/${s.token}/photos`)).body).includes(
    s.photoId,
  ),
  media: (await s.stranger.get(mediaPath(s))).status,
})

describe('a photograph the operator took down, by its id', () => {
  it('is read from everywhere before, and from nowhere after, and is back when restored', async () => {
    const s = await scene()
    expect(await readings(s)).toEqual({
      wall: true,
      mine: true,
      hostGrid: true,
      queue: true,
      gallery: true,
      media: 200,
    })

    expect((await act(s, `photos/${s.photoId}/take-down`)).status).toBe(204)
    expect(await readings(s)).toEqual({
      wall: false,
      mine: false,
      hostGrid: false,
      queue: false,
      gallery: false,
      media: 404,
    })

    expect((await act(s, `photos/${s.photoId}/restore`)).status).toBe(204)
    expect((await readings(s)).media).toBe(200)
  })

  it('cannot be put back by the host, nor deleted by the guest who sent it', async () => {
    const s = await scene()
    await act(s, `photos/${s.photoId}/take-down`)

    const moderated = await s.host.patch(`/api/events/${SLUG}/photos/${s.photoId}/status`, {
      decision: 'publish',
    })
    const deleted = await s.guest.delete(`/api/events/${SLUG}/photos/${s.photoId}`)

    expect([moderated.status, deleted.status]).toEqual([404, 404])
    expect((await readings(s)).media).toBe(404)
  })

  it('writes one line with the reason, naming the photograph and no client, and none in the client’s own trail', async () => {
    const s = await scene()

    await act(s, `photos/${s.photoId}/take-down`)
    await act(s, `photos/${s.photoId}/take-down`)

    const audit = (await s.host.get('/api/site/audit')).body.items as readonly {
      readonly action: string
      readonly clientId: string | null
      readonly subject: { readonly type: string; readonly id: string }
      readonly details: Record<string, unknown>
    }[]
    const lines = audit.filter((line) => line.action === 'photo.takenDown')
    expect(lines).toHaveLength(1)
    expect(lines[0]?.subject).toEqual({ type: 'photo', id: s.photoId })
    expect(lines[0]?.clientId).toBeNull()
    expect(lines[0]?.details).toEqual({ reason: REASON })
    // The client-readable view filters on `client_id`, so a line with none is never in it.
    const inClientsTrail = s.booted.db
      .prepare<[string], { readonly action: string }>(
        'SELECT action FROM audit_log WHERE client_id = ?',
      )
      .all(CLIENT)
    expect(inClientsTrail.map((line) => line.action)).not.toContain('photo.takenDown')
  })

  it('is refused without a reason, and for an id nobody holds', async () => {
    const s = await scene()

    const blank = await act(s, `photos/${s.photoId}/take-down`, '   ')
    const unknown = await act(s, 'photos/99999999-9999-4999-8999-999999999999/take-down')

    expect([blank.status, blank.body.error.code]).toEqual([400, 'audit.reasonInvalid'])
    expect([unknown.status, unknown.body.error.code]).toEqual([404, 'photo.notFound'])
    expect((await readings(s)).media).toBe(200)
  })
})

describe('an event the operator took down, by its id', () => {
  const SURFACES = (s: Scene) =>
    [
      ['the wall', s.stranger, `/api/events/${SLUG}/wall`, `/api/events/${NO_SUCH}/wall`],
      ['the live feed', s.stranger, `/api/events/${SLUG}/stream`, `/api/events/${NO_SUCH}/stream`],
      [
        'a photograph, by slug',
        s.stranger,
        mediaPath(s),
        `/api/events/${NO_SUCH}/photos/${s.photoId}/display`,
      ],
      [
        'a guest’s own photographs',
        s.guest,
        `/api/events/${SLUG}/photos/mine`,
        `/api/events/${NO_SUCH}/photos/mine`,
      ],
      [
        'the gallery',
        s.stranger,
        `/api/gallery/${s.token}`,
        `/api/gallery/${s.token.replace(/[A-Za-z0-9_-]/g, 'A')}`,
      ],
      ['the host’s own view of the event', s.host, `/api/events/${SLUG}`, `/api/events/${NO_SUCH}`],
      ['the host’s grid', s.host, `/api/events/${SLUG}/photos`, `/api/events/${NO_SUCH}/photos`],
      [
        'the host’s album download',
        s.host,
        `/api/events/${SLUG}/album.zip`,
        `/api/events/${NO_SUCH}/album.zip`,
      ],
    ] as const

  it('answers every surface exactly as it answers an event that does not exist, the host’s own included', async () => {
    const s = await scene()
    expect((await act(s, `events/${s.eventId}/take-down`)).status).toBe(204)

    for (const [name, browser, real, unknown] of SURFACES(s)) {
      const down = await browser.get(real)
      const missing = await browser.get(unknown)

      expect(down.status, name).toBeGreaterThanOrEqual(400)
      expect(answer(down), name).toEqual(answer(missing))
    }
  })

  it('answers the join by its printed code as an unknown code, and keeps the event off the host’s dashboard', async () => {
    const s = await scene()
    await act(s, `events/${s.eventId}/take-down`)

    const joined = await s.stranger.post('/api/join', { joinCode: s.joinCode, displayName: 'Nils' })
    const unknown = await s.stranger.post('/api/join', { joinCode: 'ZZZZZZ', displayName: 'Nils' })
    const dashboard = await s.host.get('/api/events')

    expect(answer(joined)).toEqual(answer(unknown))
    expect(JSON.stringify(dashboard.body)).not.toContain(SLUG)
  })

  it('stops the host purging it or deleting it, and lifts entirely when restored', async () => {
    const s = await scene()
    await act(s, `events/${s.eventId}/take-down`)

    const purged = await s.host.delete(`/api/events/${SLUG}`)
    expect(purged.status).toBe(404)

    expect((await act(s, `events/${s.eventId}/restore`)).status).toBe(204)
    expect((await s.stranger.get(`/api/events/${SLUG}/wall`)).status).toBe(200)
    expect((await s.guest.get(`/api/events/${SLUG}/photos/mine`)).status).toBe(200)
    expect((await s.host.get(`/api/events/${SLUG}`)).status).toBe(200)
  })
})

describe('a purge hold', () => {
  const closedLongAgo = (s: Scene) =>
    s.booted.db
      .prepare(
        `UPDATE events SET status = 'closed', closed_at = '2020-01-01T00:00:00.000Z',
                settings = json_set(settings, '$.retentionDays', 1) WHERE id = ?`,
      )
      .run(s.eventId)

  it('keeps the retention sweep off a held event, and lets it purge the event once released', async () => {
    const s = await scene()
    closedLongAgo(s)

    expect((await act(s, `events/${s.eventId}/purge-hold`)).status).toBe(204)
    const held = await s.booted.usecases.purgeExpiredEvents()
    expect(held.purged).toEqual([])
    expect(
      s.booted.db.prepare('SELECT COUNT(*) AS n FROM photos').get() as { readonly n: number },
    ).toEqual({ n: 1 })

    expect((await act(s, `events/${s.eventId}/purge-release`)).status).toBe(204)
    const released = await s.booted.usecases.purgeExpiredEvents()
    expect(released.purged).toEqual([s.eventId])
  })

  it('hides nothing, but stops the host purging the event and the guest deleting a photograph', async () => {
    const s = await scene()
    await act(s, `events/${s.eventId}/purge-hold`)

    const readable = await readings(s)
    const purged = await s.host.delete(`/api/events/${SLUG}`)
    const deleted = await s.guest.delete(`/api/events/${SLUG}/photos/${s.photoId}`)

    expect(readable.media).toBe(200)
    expect([purged.status, purged.body.error.code]).toEqual([409, 'event.purgeUnavailable'])
    expect([deleted.status, deleted.body.error.code]).toEqual([409, 'photo.deleteUnavailable'])
  })
})

describe('the host of a suspended client', () => {
  it('no longer reads photographs, in the grid, the queue, the album or the media route, and is told why', async () => {
    const s = await scene()
    expect((await s.host.post(`/api/site/clients/${CLIENT}/suspend`)).status).toBe(204)

    const reads: readonly [string, Browser, string][] = [
      ['the grid', s.host, `/api/events/${SLUG}/photos`],
      ['the queue', s.host, `/api/events/${SLUG}/moderation`],
      ['the album', s.host, `/api/events/${SLUG}/album.zip`],
      ['the media route', s.host, mediaPath(s)],
    ]
    for (const [name, browser, path] of reads) {
      const refused = await browser.get(path)

      expect([refused.status, refused.body.error?.code], name).toEqual([403, 'client.suspended'])
    }
    expect((await s.host.get(`/api/events/${SLUG}`)).status).toBe(200)
  })
})
