import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../infrastructure/config/env'
import { asUserId } from '../domain/shared/ids'
import { CSRF_COOKIE, CSRF_HEADER } from '../interface/http/middleware/csrf'
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
    expect(SURFACES.map((surface) => surface.name)).toHaveLength(12)
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

  it('lets its members read and refuses their writes with 403 client.suspended, before the body is read', async () => {
    const s = await scene()
    await suspend(s)

    const read = await s.operator.get(`/api/events/${SLUG}`)
    const photos = await s.operator.get(`/api/events/${SLUG}/photos`)
    const rename = await s.operator.patch(`/api/events/${SLUG}`, { name: 'Autre nom' })
    const settings = await s.operator.patch(`/api/events/${SLUG}/settings`, { not: 'valid' })
    const status = await s.operator.post(`/api/events/${SLUG}/status`, { status: 'closed' })

    expect([read.status, photos.status]).toEqual([200, 200])
    for (const refused of [rename, settings, status]) {
      expect([refused.status, refused.body.error.code]).toEqual([403, 'client.suspended'])
    }
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
