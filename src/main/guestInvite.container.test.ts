import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from '../interface/http/testing/request'
import { afterEach, describe, expect, it } from 'vitest'
import { asUserId } from '../domain/shared/ids'
import { loadConfig } from '../infrastructure/config/env'
import { CSRF_COOKIE, CSRF_HEADER } from '../interface/http/middleware/csrf'
import { createContainer, type Container } from './container'

/**
 * **The guest invitation is wired in the container** (spec 29): the five owner routes reach the
 * real use cases over the real SQLite adapter, the audit trail carries the four acts and no
 * content, and the row goes with its event.
 *
 * The line that joins a route to the thing it calls is in the container, which no ring-4 test
 * builds. This boots the real one, signs the box's owner in and asks each route.
 */

const OWNER = 'hote@example.org'
const PASSWORD = 'un-mot-de-passe-solide'
const SLUG = 'fete-de-lea'
const BASE = `/api/events/${SLUG}/guest-invite`

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

const boot = async () => {
  workDir = await mkdtemp(join(tmpdir(), 'eventslide-guest-invite-'))
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
  return { db: booted.db, agent, csrf: () => csrf, eventId: created.value.id }
}

const PARTY = {
  title: 'Léa fête ses 40 ans',
  startsAt: '2026-12-13T18:00:00Z',
  timeZone: 'Europe/Paris',
  address: '1 rue de la Gare',
}

describe('the guest invitation, through the real container', () => {
  it('saves, switches on, changes the link and switches off, over the real database', async () => {
    const { db, agent, csrf } = await boot()

    const first = await agent.get(BASE)
    expect(first.body.guestInvite).toMatchObject({ configured: false, defaultTitle: 'Fête de Léa' })

    const saved = await agent.put(BASE).set(CSRF_HEADER, csrf()).send(PARTY)
    expect(saved.status, JSON.stringify(saved.body)).toBe(200)
    const url = saved.body.guestInvite.url as string

    const on = await agent.post(`${BASE}/enable`).set(CSRF_HEADER, csrf()).send({})
    expect(on.body.guestInvite).toMatchObject({ enabled: true, url })
    const rotated = await agent.post(`${BASE}/rotate`).set(CSRF_HEADER, csrf()).send({})
    expect(rotated.body.guestInvite.url).not.toBe(url)
    const off = await agent.post(`${BASE}/disable`).set(CSRF_HEADER, csrf()).send({})
    expect(off.body.guestInvite).toMatchObject({
      enabled: false,
      url: rotated.body.guestInvite.url,
    })

    const row = db.prepare('SELECT token, enabled, address FROM guest_invites').get()
    expect(row).toEqual({
      token: (rotated.body.guestInvite.url as string).split('/i/')[1],
      enabled: 0,
      address: '1 rue de la Gare',
    })
  })

  it('writes the four acts to the audit log with no content in them', async () => {
    const { db, agent, csrf } = await boot()
    await agent.put(BASE).set(CSRF_HEADER, csrf()).send(PARTY)
    await agent.post(`${BASE}/enable`).set(CSRF_HEADER, csrf()).send({})
    await agent.post(`${BASE}/rotate`).set(CSRF_HEADER, csrf()).send({})
    await agent.post(`${BASE}/disable`).set(CSRF_HEADER, csrf()).send({})

    const lines = db
      .prepare<[], { readonly action: string; readonly details: string }>(
        `SELECT action, details FROM audit_log WHERE action LIKE 'event.guestInvite%' ORDER BY seq`,
      )
      .all()

    expect(lines.map((line) => line.action)).toEqual([
      'event.guestInviteSaved',
      'event.guestInviteEnabled',
      'event.guestInviteRotated',
      'event.guestInviteDisabled',
    ])
    expect(JSON.stringify(lines)).not.toContain('Plouër')
    expect(JSON.stringify(lines)).not.toContain('rue de la Gare')
    expect(lines.every((line) => line.details === '{}')).toBe(true)
  })

  it('goes with its event: deleting the event deletes the invitation', async () => {
    const { db, agent, csrf, eventId } = await boot()
    await agent.put(BASE).set(CSRF_HEADER, csrf()).send(PARTY)
    expect(db.prepare('SELECT COUNT(*) AS n FROM guest_invites').get()).toEqual({ n: 1 })

    db.prepare('DELETE FROM events WHERE id = ?').run(eventId)

    expect(db.prepare('SELECT COUNT(*) AS n FROM guest_invites').get()).toEqual({ n: 0 })
  })
})
