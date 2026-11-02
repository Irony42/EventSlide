import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../infrastructure/config/env'
import { asUserId } from '../domain/shared/ids'
import { CSRF_COOKIE, CSRF_HEADER } from '../interface/http/middleware/csrf'
import { mountedRoutes } from '../interface/http/testing/routeTable'
import { buildServerHarness } from '../interface/http/testing/serverHarness'
import { createContainer, type Container } from './container'

/**
 * **A suspended client is the same 404 as an unknown one, on every public surface** (roadmap
 * §10.7; free plan G2-14, paid plan P3-13), and its members read and do not write — through the
 * **real** composition root: the real session and step-up, the real use cases and the real SQLite
 * adapters, because the rule is enforced in four different layers (a middleware, the entity's own
 * predicates, the gallery's access rule and the stream's heartbeat) and a sweep that wired some of
 * them by hand could pass while the product did not.
 *
 * The method is one comparison, made for each surface: what a client's own event answers once the
 * client is suspended, against what an event **that does not exist** answers to the same request.
 * They have to be the same status, the same body and the same cache header. A refusal that says
 * `client.suspended` to a guest, a projector or the holder of a link is a refusal that confirms the
 * event exists, which is what the operator suspending it must not leak.
 */

const OPERATOR = 'operateur@example.org'
const PASSWORD = 'un-mot-de-passe-solide'
const SLUG = 'mariage-de-camille'
const CLIENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const NO_SUCH = 'un-mariage-qui-nexiste-pas'

let workDir: string | null = null
let container: Container | null = null

afterEach(async () => {
  await container?.dispose()
  container = null
  if (workDir !== null) await rm(workDir, { recursive: true, force: true })
  workDir = null
})

const boot = async (): Promise<Container> => {
  workDir = await mkdtemp(join(tmpdir(), 'eventslide-suspension-'))
  container = await createContainer(
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
  return container
}

const csrfOf = (headers: Record<string, unknown>): string | undefined => {
  const raw = headers['set-cookie']
  const cookies = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? [raw] : []
  const found = cookies.find((cookie) => cookie.startsWith(`${CSRF_COOKIE}=`))
  return found === undefined
    ? undefined
    : decodeURIComponent(found.slice(CSRF_COOKIE.length + 1).split(';')[0] ?? '')
}

/** A browser: one cookie jar, the CSRF token it was last handed. */
const aBrowser = async (container: Container) => {
  const agent = request.agent(container.app)
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
    delete: async (path: string, body: object = {}) =>
      note(await agent.delete(path).set(CSRF_HEADER, csrf).send(body)),
    put: async (path: string, body: object = {}) =>
      note(await agent.put(path).set(CSRF_HEADER, csrf).send(body)),
    /** One multipart part, for the one write that is a file. */
    putFile: async (path: string, field: string, bytes: Buffer) =>
      note(await agent.put(path).set(CSRF_HEADER, csrf).attach(field, bytes, 'lieu.jpg')),
  }
}

type Browser = Awaited<ReturnType<typeof aBrowser>>

/** What a response says, as far as a caller could tell two answers apart. */
const answer = (response: request.Response) => ({
  status: response.status,
  body: response.body as unknown,
  cacheControl: response.headers['cache-control'],
})

const scene = async () => {
  const booted = await boot()
  // The operator's own account is the one that owns the event here: it is the account the box has,
  // and an owner is an owner whatever else it is. Its client membership is the point of the test.
  booted.db.prepare('UPDATE users SET must_change_password = 0').run()
  const operatorRow = booted.db
    .prepare<[string], { readonly id: string }>('SELECT id FROM users WHERE email = ?')
    .get(OPERATOR)
  const operatorId = operatorRow?.id ?? ''
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
  // The operator has no client of its own, so the event is attached to the client under test, and
  // opened: a wall is only served for an event that is live.
  booted.db
    .prepare(
      `UPDATE events SET client_id = '${CLIENT}', status = 'live', opened_at = ? WHERE id = ?`,
    )
    .run(at, created.value.id)
  const joinCode = created.value.joinCode.value

  const link = await booted.usecases.createShareLink({
    eventId: created.value.id,
    actorId: asUserId(operatorId),
  })
  if (!link.ok) throw new Error(`fixture rejected: ${link.error.code}`)

  // A guest, who joined while the client was in good standing, and holds the device cookie.
  const guest = await aBrowser(booted)
  const joined = await guest.post('/api/join', { joinCode, displayName: 'Léa' })
  expect(joined.status, JSON.stringify(joined.body)).toBe(200)

  // The operator, confirmed.
  const operator = await aBrowser(booted)
  await operator.post('/api/auth/login', { email: OPERATOR, password: PASSWORD })
  const confirmed = await operator.post('/api/auth/step-up', { password: PASSWORD })
  expect(confirmed.status).toBeLessThan(300)

  const stranger = await aBrowser(booted)
  return { booted, joinCode, token: link.value.token, guest, operator, stranger }
}

type Scene = Awaited<ReturnType<typeof scene>>

const suspend = (s: Scene) => s.operator.post(`/api/site/clients/${CLIENT}/suspend`)
const resume = (s: Scene) => s.operator.post(`/api/site/clients/${CLIENT}/resume`)

/** One request on a surface of the event, and the same request on an event that is not there. */
interface Surface {
  readonly name: string
  readonly asks: (s: Scene) => Promise<{ readonly real: Browser; readonly path: string }>
  readonly method: 'get' | 'post'
  readonly body?: (s: Scene) => object
  /** What the unknown counterpart asks instead. */
  readonly unknown: (s: Scene) => {
    readonly browser: Browser
    readonly path: string
    readonly body?: object
  }
}

const SURFACES: readonly Surface[] = [
  {
    name: 'the wall',
    method: 'get',
    asks: async (s) => ({ real: s.stranger, path: `/api/events/${SLUG}/wall` }),
    unknown: (s) => ({ browser: s.stranger, path: `/api/events/${NO_SUCH}/wall` }),
  },
  {
    name: 'the live feed a projector opens',
    method: 'get',
    asks: async (s) => ({ real: s.stranger, path: `/api/events/${SLUG}/stream` }),
    unknown: (s) => ({ browser: s.stranger, path: `/api/events/${NO_SUCH}/stream` }),
  },
  {
    name: 'a published photograph, by slug',
    method: 'get',
    asks: async (s) => ({
      real: s.stranger,
      path: `/api/events/${SLUG}/photos/33333333-3333-4333-8333-333333333333/display`,
    }),
    unknown: (s) => ({
      browser: s.stranger,
      path: `/api/events/${NO_SUCH}/photos/33333333-3333-4333-8333-333333333333/display`,
    }),
  },
  {
    name: 'a published photograph, by slug, with the device cookie of a guest',
    method: 'get',
    asks: async (s) => ({
      real: s.guest,
      path: `/api/events/${SLUG}/photos/33333333-3333-4333-8333-333333333333/display`,
    }),
    unknown: (s) => ({
      browser: s.guest,
      path: `/api/events/${NO_SUCH}/photos/33333333-3333-4333-8333-333333333333/display`,
    }),
  },
  {
    name: 'a photograph whose id is not an id, which is a 400 for an event that serves',
    method: 'get',
    asks: async (s) => ({
      real: s.stranger,
      path: `/api/events/${SLUG}/photos/not-a-uuid/display`,
    }),
    unknown: (s) => ({
      browser: s.stranger,
      path: `/api/events/${NO_SUCH}/photos/not-a-uuid/display`,
    }),
  },
  {
    name: 'a photograph whose variant is not one, which is a 400 for an event that serves',
    method: 'get',
    asks: async (s) => ({
      real: s.stranger,
      path: `/api/events/${SLUG}/photos/33333333-3333-4333-8333-333333333333/bogus`,
    }),
    unknown: (s) => ({
      browser: s.stranger,
      path: `/api/events/${NO_SUCH}/photos/33333333-3333-4333-8333-333333333333/bogus`,
    }),
  },
  {
    name: 'the join, by its printed code',
    method: 'post',
    body: (s) => ({ joinCode: s.joinCode, displayName: 'Nouvel invité' }),
    asks: async (s) => ({ real: s.stranger, path: '/api/join' }),
    unknown: (s) => ({
      browser: s.stranger,
      path: '/api/join',
      body: { joinCode: 'ZZZZZZ', displayName: 'Nouvel invité' },
    }),
  },
  {
    name: 'a guest’s own photographs, with the device cookie they already hold',
    method: 'get',
    asks: async (s) => ({ real: s.guest, path: `/api/events/${SLUG}/photos/mine` }),
    unknown: (s) => ({ browser: s.guest, path: `/api/events/${NO_SUCH}/photos/mine` }),
  },
  {
    name: 'a guest’s missions',
    method: 'get',
    asks: async (s) => ({ real: s.guest, path: `/api/events/${SLUG}/missions/mine` }),
    unknown: (s) => ({ browser: s.guest, path: `/api/events/${NO_SUCH}/missions/mine` }),
  },
  {
    name: 'a guest’s guestbook messages',
    method: 'get',
    asks: async (s) => ({ real: s.guest, path: `/api/events/${SLUG}/guestbook/mine` }),
    unknown: (s) => ({ browser: s.guest, path: `/api/events/${NO_SUCH}/guestbook/mine` }),
  },
  {
    name: 'writing a guestbook message',
    method: 'post',
    body: () => ({ text: 'Bravo' }),
    asks: async (s) => ({ real: s.guest, path: `/api/events/${SLUG}/guestbook` }),
    unknown: (s) => ({
      browser: s.guest,
      path: `/api/events/${NO_SUCH}/guestbook`,
      body: { text: 'Bravo' },
    }),
  },
  {
    name: 'the privacy notice a guest reads',
    method: 'get',
    asks: async (s) => ({ real: s.guest, path: `/api/events/${SLUG}/privacy-notice` }),
    unknown: (s) => ({ browser: s.guest, path: `/api/events/${NO_SUCH}/privacy-notice` }),
  },
  {
    name: 'the shared gallery, by its link',
    method: 'get',
    asks: async (s) => ({ real: s.stranger, path: `/api/gallery/${s.token}` }),
    unknown: (s) => ({
      browser: s.stranger,
      // The same length and alphabet, so it is refused for want of a link and not for its shape.
      path: `/api/gallery/${s.token.replace(/[A-Za-z0-9_-]/g, 'A')}`,
    }),
  },
  {
    name: 'the gallery’s page of photographs',
    method: 'get',
    asks: async (s) => ({ real: s.stranger, path: `/api/gallery/${s.token}/photos` }),
    unknown: (s) => ({
      browser: s.stranger,
      path: `/api/gallery/${s.token.replace(/[A-Za-z0-9_-]/g, 'A')}/photos`,
    }),
  },
]

const send = (browser: Browser, method: 'get' | 'post', path: string, body?: object) =>
  method === 'get' ? browser.get(path) : browser.post(path, body)

describe('a suspended client, through the real composition root', () => {
  it('names every surface of the plan that has to be a 404: the wall, the feed, the media, the join, a guest, a link', () => {
    expect(SURFACES.map((surface) => surface.name)).toHaveLength(14)
  })

  it.each(SURFACES.map((surface) => [surface.name, surface] as const))(
    'answers %s exactly as it answers an event that does not exist',
    async (_name, surface) => {
      const s = await scene()
      expect((await suspend(s)).status).toBe(204)

      const real = await surface.asks(s)
      const counterpart = surface.unknown(s)
      const suspended = await send(real.real, surface.method, real.path, surface.body?.(s))
      const unknown = await send(
        counterpart.browser,
        surface.method,
        counterpart.path,
        counterpart.body,
      )

      expect(suspended.status).toBeGreaterThanOrEqual(400)
      expect(answer(suspended)).toEqual(answer(unknown))
      expect(JSON.stringify(suspended.body)).not.toContain('suspended')
    },
  )

  it('answered every one of those surfaces before the suspension, so the sweep compares something', async () => {
    const s = await scene()

    const wall = await s.stranger.get(`/api/events/${SLUG}/wall`)
    const gallery = await s.stranger.get(`/api/gallery/${s.token}`)
    const mine = await s.guest.get(`/api/events/${SLUG}/photos/mine`)

    expect([wall.status, gallery.status, mine.status]).toEqual([200, 200, 200])
  })

  it('lets its members read their account and their event, and no longer its photographs (launch review S5)', async () => {
    const s = await scene()
    await suspend(s)

    const read = await s.operator.get(`/api/events/${SLUG}`)
    const photos = await s.operator.get(`/api/events/${SLUG}/photos`)

    expect([read.status, photos.status]).toEqual([200, 403])
    expect(photos.body.error.code).toBe('client.suspended')
  })

  /**
   * **Every write a host can make on a frozen event is refused, and the sweep reads the list off
   * the router.** The rule is the use cases' (`requireWritable`), no longer a test on the verb in
   * `requireRole`, so what makes it complete is that each of these routes reaches a use case
   * that asks it. A write route mounted tomorrow is in neither list below, and the completeness
   * case fails until somebody decides which it is. A body that is not valid is a 400 from the
   * handler's own parse, ahead of the use case, so each body here is one the route accepts.
   */
  const ANY = '11111111-1111-4111-8111-111111111111'
  const SOME_MISSION = { prompt: 'Le gâteau', scope: 'event' }

  const HOST_WRITES: readonly {
    readonly method: 'patch' | 'post' | 'delete' | 'put'
    readonly path: string
    readonly body: object
  }[] = [
    { method: 'patch', path: '/api/events/:eventSlug', body: { name: 'Autre nom' } },
    { method: 'patch', path: '/api/events/:eventSlug/settings', body: { moderation: 'auto' } },
    { method: 'post', path: '/api/events/:eventSlug/status', body: { status: 'closed' } },
    {
      method: 'patch',
      path: '/api/events/:eventSlug/schedule',
      body: { scheduledOpenAt: null, scheduledCloseAt: null },
    },
    { method: 'post', path: '/api/events/:eventSlug/join-code', body: {} },
    { method: 'delete', path: '/api/events/:eventSlug', body: {} },
    { method: 'post', path: '/api/events/:eventSlug/guests/:guestId/revoke', body: {} },
    {
      method: 'post',
      path: '/api/events/:eventSlug/moderators',
      body: { email: 'lea@example.org' },
    },
    { method: 'delete', path: '/api/events/:eventSlug/moderators/:userId', body: {} },
    { method: 'post', path: '/api/events/:eventSlug/missions', body: SOME_MISSION },
    { method: 'patch', path: '/api/events/:eventSlug/missions/:missionId', body: SOME_MISSION },
    { method: 'delete', path: '/api/events/:eventSlug/missions/:missionId', body: {} },
    {
      method: 'patch',
      path: '/api/events/:eventSlug/photos/:photoId/status',
      body: { decision: 'publish' },
    },
    {
      method: 'post',
      path: '/api/events/:eventSlug/moderation/bulk',
      body: { photoIds: [ANY], decision: 'publish' },
    },
    { method: 'delete', path: '/api/events/:eventSlug/photos/:photoId', body: {} },
    // The host's favourites (spec 08): a suspended client's event is frozen for them too.
    { method: 'put', path: '/api/events/:eventSlug/photos/:photoId/highlight', body: {} },
    { method: 'delete', path: '/api/events/:eventSlug/photos/:photoId/highlight', body: {} },
    { method: 'post', path: '/api/events/:eventSlug/highlights/preselect', body: { limit: 5 } },
    { method: 'post', path: '/api/events/:eventSlug/share-link', body: {} },
    { method: 'delete', path: '/api/events/:eventSlug/share-link', body: {} },
    // The host's own photograph of the venue (ADR 0010): the removal here, the upload below.
    { method: 'delete', path: '/api/events/:eventSlug/venue-photo', body: {} },
  ]

  /** The one host write that is a file, so it needs a body this loop cannot send. */
  const HOST_FILE_WRITES: readonly string[] = ['PUT /api/events/:eventSlug/venue-photo']

  /** The guest's own writes: a guest's device token, never a host's session, and a suspended client's guests are the 404 above. */
  const GUEST_WRITES: readonly string[] = [
    'POST /api/events/:eventSlug/photos',
    'POST /api/events/:eventSlug/clips',
    'PATCH /api/events/:eventSlug/photos/:photoId/caption',
    'PATCH /api/events/:eventSlug/guests/:guestId',
    'DELETE /api/events/:eventSlug/guests/me',
    'POST /api/events/:eventSlug/photos/:photoId/reactions',
    'DELETE /api/events/:eventSlug/photos/:photoId/reactions/:kind',
    'POST /api/events/:eventSlug/privacy-notice/acknowledgement',
    'POST /api/events/:eventSlug/guestbook',
    'DELETE /api/events/:eventSlug/guestbook/:entryId',
  ]

  it('refuses every write of a host on a frozen event with 403 client.suspended', async () => {
    const s = await scene()
    await suspend(s)

    for (const write of HOST_WRITES) {
      const url = write.path.replace(':eventSlug', SLUG).replace(/:[a-zA-Z]+/g, ANY)

      const refused = await s.operator[write.method](url, write.body)

      expect(
        [write.method.toUpperCase(), write.path, refused.status, refused.body.error?.code],
        `${write.method.toUpperCase()} ${write.path}`,
      ).toEqual([write.method.toUpperCase(), write.path, 403, 'client.suspended'])
    }
  })

  it('refuses a host’s venue photograph on a frozen event with 403 client.suspended', async () => {
    const s = await scene()
    await suspend(s)
    // A real image: the refusal is the use case's, which is asked before a byte is decoded, so
    // what is sent only has to get past the route's own file check.
    const photo = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .jpeg()
      .toBuffer()

    const refused = await s.operator.putFile(`/api/events/${SLUG}/venue-photo`, 'photo', photo)

    expect([refused.status, refused.body.error?.code]).toEqual([403, 'client.suspended'])
  })

  it('stops serving a suspended client’s venue photograph to the public, and to its host too (launch review S5)', async () => {
    const s = await scene()
    const look = {
      theme: {
        accentHue: 305,
        fonts: 'sans',
        frame: 'soft',
        ambiance: 'guinguette',
      },
    }
    expect((await s.operator.patch(`/api/events/${SLUG}/settings`, look)).status).toBe(200)
    const photo = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .jpeg()
      .toBuffer()
    const put = await s.operator.putFile(`/api/events/${SLUG}/venue-photo`, 'photo', photo)
    expect(put.status, JSON.stringify(put.body)).toBe(200)
    const url = put.body.settings.theme.groundUrl as string

    expect((await s.stranger.get(url)).status).toBe(200)
    await suspend(s)

    const refused = await s.stranger.get(url)
    expect([refused.status, refused.body.error?.code]).toEqual([404, 'venuePhoto.notFound'])
    expect((await s.guest.get(url)).status).toBe(404)
    expect((await s.operator.get(url)).status).toBe(404)
  })

  it('names every non-GET route under an event: a host write above, or a guest write', async () => {
    // The routers, not the product: `buildServerHarness` mounts the same ones and no web client, whose
    // `app.get(['/g', '/g/*splat'])` has an array path the walk refuses, and which exists only once
    // `dist/client` has been built.
    const mounted = mountedRoutes(buildServerHarness().app)
      .filter((route) => !['get', 'head', 'options'].includes(route.method.toLowerCase()))
      .map((route) => {
        const full = route.path.startsWith('/api')
          ? route.path
          : route.mount.replace(/\/$/, '') + route.path
        return `${route.method.toUpperCase()} ${full}`
      })
      .filter((route) => route.includes('/api/events/:eventSlug'))
    const named = new Set([
      ...HOST_WRITES.map((write) => `${write.method.toUpperCase()} ${write.path}`),
      ...GUEST_WRITES,
      ...HOST_FILE_WRITES,
    ])

    expect(mounted.filter((route) => !named.has(route))).toEqual([])
    expect([...named].filter((route) => !mounted.includes(route))).toEqual([])
  })

  it('refuses a new event to a member of the client, which is a write no event route can see', async () => {
    const s = await scene()
    s.booted.db
      .prepare(
        `INSERT INTO users (id, email, password_hash, created_at, site_role)
                VALUES ('user-member', 'membre@example.test', 'hash:x', ?, 'none')`,
      )
      .run(new Date().toISOString())
    s.booted.db
      .prepare(
        `INSERT INTO client_members (client_id, user_id, role, granted_at)
                VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'user-member', 'member', ?)`,
      )
      .run(new Date().toISOString())
    await suspend(s)

    const result = await s.booted.usecases.createEvent({
      ownerId: asUserId('user-member'),
      name: 'Un autre mariage',
    })

    expect(!result.ok && [result.error.kind, result.error.code]).toEqual([
      'forbidden',
      'client.suspended',
    ])
  })

  it('touches no account and no medium: resuming restores every surface exactly', async () => {
    const s = await scene()
    await suspend(s)
    expect((await s.stranger.get(`/api/events/${SLUG}/wall`)).status).toBe(404)
    expect((await s.guest.get(`/api/events/${SLUG}/photos/mine`)).status).toBe(404)

    expect((await resume(s)).status).toBe(204)

    expect((await s.stranger.get(`/api/events/${SLUG}/wall`)).status).toBe(200)
    expect((await s.guest.get(`/api/events/${SLUG}/photos/mine`)).status).toBe(200)
    expect((await s.stranger.get(`/api/gallery/${s.token}`)).status).toBe(200)
    expect((await s.operator.patch(`/api/events/${SLUG}`, { name: 'Mariage' })).status).toBe(200)
    const disabled = s.booted.db
      .prepare<[], { readonly n: number }>(
        'SELECT COUNT(*) AS n FROM users WHERE disabled_at IS NOT NULL',
      )
      .get()
    expect(disabled?.n).toBe(0)
  })

  it('writes one line for a suspension and one for a resumption, and none for a repeat', async () => {
    const s = await scene()

    await suspend(s)
    await suspend(s)
    await resume(s)
    await resume(s)

    const lines = s.booted.db
      .prepare<[], { readonly action: string }>('SELECT action FROM audit_log ORDER BY seq')
      .all()
    expect(lines.map((line) => line.action)).toEqual(['client.suspended', 'client.resumed'])
  })
})
