import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from '../interface/http/testing/request'
import { afterEach, describe, expect, it } from 'vitest'
import { asUserId } from '../domain/shared/ids'
import { loadConfig } from '../infrastructure/config/env'
import { generateVapidKeys } from '../infrastructure/push/webPushCrypto'
import { CSRF_COOKIE, CSRF_HEADER } from '../interface/http/middleware/csrf'
import { createContainer, type Container } from './container'

/**
 * **Browser notifications are wired in the container, and only with the keys** (spec 30, lot 4,
 * Web Push): with no `VAPID_*` there is no notifier and the routes say `push.disabled`; with them
 * the public key is told to a signed-in account, an owner subscribes and unsubscribes over the real
 * database, and a stranger's address is refused before anything is stored.
 */

const OWNER = 'hote@example.org'
const PASSWORD = 'un-mot-de-passe-solide'
const SLUG = 'fete-de-lea'
const BASE = `/api/events/${SLUG}`
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc'
const KEYS = { p256dh: 'B' + 'A'.repeat(86), auth: 'A'.repeat(22) }

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

const boot = async (vapid: Record<string, string> = {}) => {
  workDir = await mkdtemp(join(tmpdir(), 'eventslide-push-'))
  const booted = await createContainer(
    loadConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'fatal',
      DATABASE_PATH: join(workDir, 'eventslide.sqlite'),
      MEDIA_ROOT: join(workDir, 'media'),
      FFMPEG_PATH: join(workDir, 'no-ffmpeg-here'),
      FFPROBE_PATH: join(workDir, 'no-ffprobe-here'),
      BOOTSTRAP_OWNER_EMAIL: OWNER,
      BOOTSTRAP_OWNER_PASSWORD: PASSWORD,
      ...vapid,
    }),
  )
  container = booted
  booted.db.prepare('UPDATE users SET must_change_password = 0').run()
  const row = booted.db
    .prepare<[string], { readonly id: string }>('SELECT id FROM users WHERE email = ?')
    .get(OWNER)
  const created = await booted.usecases.createEvent({
    ownerId: asUserId(row?.id ?? ''),
    name: 'Fête de Léa',
    slug: SLUG,
  })
  if (!created.ok) throw new Error(`fixture rejected: ${created.error.code}`)

  const agent = request.agent(booted.app)
  let csrf = csrfOf((await agent.get('/api/auth/me')).headers) ?? ''
  const login = await agent
    .post('/api/auth/login')
    .set(CSRF_HEADER, csrf)
    .send({ email: OWNER, password: PASSWORD })
  expect(login.status, JSON.stringify(login.body)).toBe(200)
  csrf = csrfOf(login.headers) ?? csrf
  return { booted, db: booted.db, agent, csrf: () => csrf }
}

describe('browser notifications, through the real container', () => {
  it('is off with no keys: no notifier, the key and a subscription are 404 push.disabled', async () => {
    const { booted, agent, csrf, db } = await boot()

    const key = await agent.get('/api/push/key')
    const subscribe = await agent
      .post(`${BASE}/push-subscription`)
      .set(CSRF_HEADER, csrf())
      .send({ endpoint: ENDPOINT, keys: KEYS })

    expect(booted.pushNotifier).toBeNull()
    expect([key.status, key.body.error.code]).toEqual([404, 'push.disabled'])
    expect([subscribe.status, subscribe.body.error.code]).toEqual([404, 'push.disabled'])
    expect(db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get()).toEqual({ n: 0 })
  })

  it('is on with the three keys: the notifier exists, the public key is told, an owner subscribes and unsubscribes', async () => {
    const pair = generateVapidKeys()
    const { booted, agent, csrf, db } = await boot({
      VAPID_PUBLIC_KEY: pair.publicKey,
      VAPID_PRIVATE_KEY: pair.privateKey,
      VAPID_SUBJECT: 'mailto:ops@example.org',
    })

    const key = await agent.get('/api/push/key')
    const subscribe = await agent
      .post(`${BASE}/push-subscription`)
      .set(CSRF_HEADER, csrf())
      .send({ endpoint: ENDPOINT, keys: KEYS })
    const stored = db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions').all()
    const unsubscribe = await agent
      .delete(`${BASE}/push-subscription`)
      .set(CSRF_HEADER, csrf())
      .send({ endpoint: ENDPOINT })

    expect(booted.pushNotifier).not.toBeNull()
    expect(key.body).toEqual({ publicKey: pair.publicKey })
    expect(JSON.stringify(key.body)).not.toContain(pair.privateKey)
    expect(subscribe.status).toBe(204)
    expect(stored).toEqual([{ endpoint: ENDPOINT, p256dh: KEYS.p256dh, auth: KEYS.auth }])
    expect(unsubscribe.status).toBe(204)
    expect(db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get()).toEqual({ n: 0 })
  })

  it('refuses an internal address before storing anything, and a write without the CSRF token', async () => {
    const pair = generateVapidKeys()
    const { agent, csrf, db } = await boot({
      VAPID_PUBLIC_KEY: pair.publicKey,
      VAPID_PRIVATE_KEY: pair.privateKey,
      VAPID_SUBJECT: 'mailto:ops@example.org',
    })

    const internal = await agent
      .post(`${BASE}/push-subscription`)
      .set(CSRF_HEADER, csrf())
      .send({ endpoint: 'https://169.254.169.254/latest/meta-data', keys: KEYS })
    const forged = await agent
      .post(`${BASE}/push-subscription`)
      .send({ endpoint: ENDPOINT, keys: KEYS })

    expect([internal.status, internal.body.error.code]).toEqual([400, 'push.endpointNotAllowed'])
    expect(forged.status).toBe(403)
    expect(db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get()).toEqual({ n: 0 })
  })

  it('takes its subscriptions with the event', async () => {
    const pair = generateVapidKeys()
    const { agent, csrf, db } = await boot({
      VAPID_PUBLIC_KEY: pair.publicKey,
      VAPID_PRIVATE_KEY: pair.privateKey,
      VAPID_SUBJECT: 'mailto:ops@example.org',
    })
    await agent
      .post(`${BASE}/push-subscription`)
      .set(CSRF_HEADER, csrf())
      .send({ endpoint: ENDPOINT, keys: KEYS })
      .expect(204)

    db.prepare('DELETE FROM events').run()

    expect(db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get()).toEqual({ n: 0 })
  })
})
