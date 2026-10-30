import { mkdtemp, readdir, rm } from 'node:fs/promises'
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
 * **The three event routes that were composed inside their router are wired in the container**
 * (HTTP-M-05): rename an event, list its moderators, revoke one.
 *
 * Their use cases used to be built in `eventRoutes.ts` from the ports `deps` carried, so they were
 * in neither the use-case bag nor `src/main/usecases.ts`. They are in both now, and the one line
 * that joins a route to the thing it calls is in the container, which no ring-4 test builds. This
 * boots the real one, signs the box's owner in and asks each route.
 *
 * What this does **not** pin is the event bus `renameEvent` publishes on (`bus: adapters.bus`): the
 * container does not expose it, and the signal's consumers are the streams, which
 * `renameEvent.test.ts` covers against a fake. That line was as unguarded when the route composed
 * the use case.
 */

const OWNER = 'hote@example.org'
const PASSWORD = 'un-mot-de-passe-solide'
const SLUG = 'mariage-de-camille'

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

const signedInOwner = async () => {
  workDir = await mkdtemp(join(tmpdir(), 'eventslide-host-routes-'))
  container = await createContainer(
    loadConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'fatal',
      DATABASE_PATH: join(workDir, 'eventslide.sqlite'),
      MEDIA_ROOT: join(workDir, 'media'),
      FFMPEG_PATH: join(workDir, 'no-ffmpeg-here'),
      FFPROBE_PATH: join(workDir, 'no-ffprobe-here'),
      BOOTSTRAP_OWNER_EMAIL: OWNER,
      BOOTSTRAP_OWNER_PASSWORD: PASSWORD,
    }),
  )
  container.db.prepare('UPDATE users SET must_change_password = 0').run()
  const row = container.db
    .prepare<[string], { readonly id: string }>('SELECT id FROM users WHERE email = ?')
    .get(OWNER)
  const ownerId = row?.id ?? ''
  const created = await container.usecases.createEvent({
    ownerId: asUserId(ownerId),
    name: 'Mariage de Camille',
    slug: SLUG,
  })
  if (!created.ok) throw new Error(`fixture rejected: ${created.error.code}`)

  const agent = request.agent(container.app)
  let csrf = csrfOf((await agent.get('/api/auth/me')).headers) ?? ''
  const login = await agent
    .post('/api/auth/login')
    .set(CSRF_HEADER, csrf)
    .send({ email: OWNER, password: PASSWORD })
  expect(login.status, JSON.stringify(login.body)).toBe(200)
  csrf = csrfOf(login.headers) ?? csrf
  return { agent, csrf: () => csrf, ownerId }
}

describe('the host routes whose use cases the container now builds', () => {
  it('renames an event, and the new name is what the host reads back', async () => {
    const { agent, csrf } = await signedInOwner()

    const renamed = await agent
      .patch(`/api/events/${SLUG}`)
      .set(CSRF_HEADER, csrf())
      .send({ name: 'Mariage de Camille et Sacha' })

    expect(renamed.status, JSON.stringify(renamed.body)).toBe(200)
    expect(renamed.body.name).toBe('Mariage de Camille et Sacha')
    const read = await agent.get(`/api/events/${SLUG}`)
    expect(read.body.name).toBe('Mariage de Camille et Sacha')
  })

  it('lists the moderators of an event, owner included, with their addresses', async () => {
    const { agent } = await signedInOwner()

    const listed = await agent.get(`/api/events/${SLUG}/moderators`)

    expect(listed.status, JSON.stringify(listed.body)).toBe(200)
    expect(JSON.stringify(listed.body)).toContain(OWNER)
  })

  it('never leaves an event without its owner, even when the owner asks to be revoked', async () => {
    const { agent, csrf, ownerId } = await signedInOwner()

    const revoked = await agent
      .delete(`/api/events/${SLUG}/moderators/${ownerId}`)
      .set(CSRF_HEADER, csrf())

    // The use case's own rule, by name: any other refusal (a missing token, a 500, a stub) would not do.
    expect([revoked.status, revoked.body.error.code]).toEqual([409, 'membership.lastOwner'])
    const listed = await agent.get(`/api/events/${SLUG}/moderators`)
    expect(JSON.stringify(listed.body)).toContain(OWNER)
  })
})

describe('the answer about one event, through the real container (HTTP-M-06)', () => {
  const insertGuests = (c: Container, eventSlug: string, howMany: number): void => {
    const event = c.db
      .prepare<[string], { readonly id: string }>('SELECT id FROM events WHERE slug = ?')
      .get(eventSlug)
    const at = '2026-10-01T09:00:00.000Z'
    for (let guest = 0; guest < howMany; guest += 1) {
      c.db
        .prepare(
          `INSERT INTO guests (id, event_id, display_name, joined_at, last_seen_at)
           VALUES (?, ?, 'Léa', ?, ?)`,
        )
        .run(`guest-${eventSlug}-${guest}`, event?.id ?? '', at, at)
    }
  }

  it('counts the guests of that event alone, and says what the dashboard says of it', async () => {
    const { agent, ownerId } = await signedInOwner()
    const second = await container?.usecases.createEvent({
      ownerId: asUserId(ownerId),
      name: 'Gala annuel',
      slug: 'gala-annuel',
    })
    if (second === undefined || !second.ok) throw new Error('fixture rejected')
    if (container === null) throw new Error('no container')
    insertGuests(container, SLUG, 2)
    insertGuests(container, 'gala-annuel', 3)

    const one = await agent.get(`/api/events/${SLUG}`)
    const dashboard = await agent.get('/api/events')
    const row = (dashboard.body.items as { slug: string; guestCount: number }[]).find(
      (item) => item.slug === SLUG,
    )

    expect(one.status, JSON.stringify(one.body)).toBe(200)
    expect(one.body.guestCount).toBe(2)
    // The limits are read through the same view: the quota the box holds the event to, which is
    // the one it was created with while it has no client.
    expect(one.body.quotaBytes).toBe(
      container?.db
        .prepare<[string], { readonly quota_bytes: number }>(
          'SELECT quota_bytes FROM events WHERE slug = ?',
        )
        .get(SLUG)?.quota_bytes,
    )
    expect(row?.guestCount).toBe(2)
  })
})

describe('the host’s own venue photograph, through the real container (ADR 0010, decision 8)', () => {
  /** A phone photograph of a venue: sideways, with a device name and a GPS block. */
  const phonePhoto = async (): Promise<Buffer> =>
    sharp({
      create: { width: 800, height: 600, channels: 3, background: { r: 30, g: 90, b: 200 } },
    })
      .withMetadata({
        orientation: 6,
        exif: {
          IFD0: { Make: 'EventSlide Test', Model: 'Fixture 1' },
          IFD3: { GPSLatitudeRef: 'N', GPSLongitudeRef: 'E' },
        },
      })
      .jpeg()
      .toBuffer()

  const bytesOf = (response: request.Response): Buffer => response.body as Buffer
  const binary = (res: request.Response, done: (error: Error | null, body: unknown) => void) => {
    const chunks: Buffer[] = []
    res.on('data', (chunk: Buffer) => chunks.push(chunk))
    res.on('end', () => done(null, Buffer.concat(chunks)))
  }

  const guinguette = async (
    agent: ReturnType<typeof request.agent>,
    csrf: () => string,
  ): Promise<void> => {
    const saved = await agent
      .patch(`/api/events/${SLUG}/settings`)
      .set(CSRF_HEADER, csrf())
      .send({
        theme: {
          accentHue: 305,
          fonts: 'sans',
          frame: 'soft',
          ambiance: 'guinguette',
        },
      })
    expect(saved.status, JSON.stringify(saved.body)).toBe(200)
  }

  it('stores a stripped WebP, serves it to the public wall, and survives a settings save', async () => {
    const { agent, csrf } = await signedInOwner()
    await guinguette(agent, csrf)

    const put = await agent
      .put(`/api/events/${SLUG}/venue-photo`)
      .set(CSRF_HEADER, csrf())
      .attach('photo', await phonePhoto(), { filename: 'lieu.php', contentType: 'text/x-php' })

    expect(put.status, JSON.stringify(put.body)).toBe(200)
    const url = put.body.settings.theme.groundUrl as string
    expect(url).toMatch(new RegExp(`^/api/events/${SLUG}/venue-photo/[0-9a-f]{64}$`))

    // The event is a draft until it goes live, and a draft serves nobody but its host.
    if (container === null) throw new Error('no container')
    expect((await request(container.app).get(url)).status).toBe(404)
    const own = await agent.get(url).buffer(true).parse(binary)
    expect(own.status).toBe(200)
    const stored = await sharp(bytesOf(own)).metadata()
    expect(stored.format).toBe('webp')
    expect(stored.exif).toBeUndefined()
    expect([stored.width, stored.height]).toEqual([600, 800])
    expect(bytesOf(own).includes(Buffer.from('EventSlide Test'))).toBe(false)

    // Saved again with a different accent: the photograph is not part of that form.
    const resaved = await agent
      .patch(`/api/events/${SLUG}/settings`)
      .set(CSRF_HEADER, csrf())
      .send({
        theme: {
          accentHue: 345,
          fonts: 'sans',
          frame: 'soft',
          ambiance: 'guinguette',
        },
      })
    expect(resaved.body.settings.theme.groundUrl).toBe(url)
  })

  it('reads and ignores a photograph URL echoed in a theme, and stores nothing of it', async () => {
    const { agent, csrf } = await signedInOwner()

    const saved = await agent
      .patch(`/api/events/${SLUG}/settings`)
      .set(CSRF_HEADER, csrf())
      .send({
        theme: {
          accentHue: 305,
          fonts: 'sans',
          frame: 'soft',
          ambiance: 'guinguette',
          groundUrl: '/api/events/anything/venue-photo/' + 'ab'.repeat(32),
        },
      })

    expect(saved.status, JSON.stringify(saved.body)).toBe(200)
    expect(saved.body.settings.theme.groundUrl).toBeNull()
    const stored = container?.db
      .prepare<[string], { readonly settings: string }>(
        'SELECT settings FROM events WHERE slug = ?',
      )
      .get(SLUG)
    expect(stored?.settings).not.toContain('anything')
  })

  it('is taken down by the host: the URL answers 404 at once and the file is gone', async () => {
    const { agent, csrf } = await signedInOwner()
    await guinguette(agent, csrf)
    const put = await agent
      .put(`/api/events/${SLUG}/venue-photo`)
      .set(CSRF_HEADER, csrf())
      .attach('photo', await phonePhoto(), 'lieu.jpg')
    const url = put.body.settings.theme.groundUrl as string
    const directory = join(workDir ?? '', 'media', put.body.id as string, 'ground')
    const before = await readdir(directory, { recursive: true })
    expect(before.filter((name) => name.endsWith('.webp')).length).toBe(1)

    const removed = await agent.delete(`/api/events/${SLUG}/venue-photo`).set(CSRF_HEADER, csrf())

    expect(removed.status).toBe(200)
    expect(removed.body.settings.theme.groundUrl).toBeNull()
    expect((await agent.get(url)).status).toBe(404)
    const left = await readdir(directory, { recursive: true })
    expect(left.filter((name) => name.endsWith('.webp'))).toEqual([])
  })

  it('is deleted with the event', async () => {
    const { agent, csrf } = await signedInOwner()
    await guinguette(agent, csrf)
    const put = await agent
      .put(`/api/events/${SLUG}/venue-photo`)
      .set(CSRF_HEADER, csrf())
      .attach('photo', await phonePhoto(), 'lieu.jpg')
    const eventDirectory = join(workDir ?? '', 'media', put.body.id as string)
    expect((await readdir(join(eventDirectory, 'ground'))).length).toBe(1)

    const purged = await agent.delete(`/api/events/${SLUG}`).set(CSRF_HEADER, csrf())

    expect(purged.status).toBe(204)
    await expect(readdir(eventDirectory)).rejects.toThrow(/ENOENT/)
  })
})
