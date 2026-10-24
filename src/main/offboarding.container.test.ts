import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { aClient, aUser } from '../application/testing/builders'
import { asClientId, asUserId } from '../domain/shared/ids'
import { loadConfig } from '../infrastructure/config/env'
import { SqliteClientRepository } from '../infrastructure/db/sqliteClientRepository'
import { SqliteUserRepository } from '../infrastructure/db/sqliteUserRepository'
import { CSRF_COOKIE, CSRF_HEADER } from '../interface/http/middleware/csrf'
import { createContainer, type Container } from './container'

/**
 * **Ending an engagement, end to end** (roadmap §10.7; free plan G2-14 part 3, paid plan P3-13),
 * through the real composition root: the operator offboards a client over the wire, the retention
 * sweep's two steps run against the real SQLite adapters, and what is left is what the plan says.
 *
 * What a unit test cannot say, and this one does: that the albums of an offboarded client really are
 * purged by the sweep that already exists (the client's `purge_after` is what the purge reads), that
 * the accounts that belonged to nothing else are then deleted and the one that belonged to another
 * client is not, that an operator is never deleted, and that the operator's own audit read shows the
 * trail without an address in it.
 */

const OPERATOR = 'operateur@example.org'
const PASSWORD = 'un-mot-de-passe-solide'
const CLIENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const OWNER = '22222222-2222-4222-8222-222222222222'
const MEMBER = '44444444-4444-4444-8444-444444444444'
const SHARED = '77777777-7777-4777-8777-777777777777'

let workDir: string | null = null
let container: Container | null = null

afterEach(async () => {
  await container?.dispose()
  container = null
  if (workDir !== null) await rm(workDir, { recursive: true, force: true })
  workDir = null
})

const boot = async (): Promise<Container> => {
  workDir = await mkdtemp(join(tmpdir(), 'eventslide-offboarding-'))
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
    delete: async (path: string) => note(await agent.delete(path).set(CSRF_HEADER, csrf).send({})),
  }
}

const scene = async () => {
  const booted = await boot()
  booted.db.prepare('UPDATE users SET must_change_password = 0').run()
  const operatorId =
    booted.db
      .prepare<[string], { readonly id: string }>('SELECT id FROM users WHERE email = ?')
      .get(OPERATOR)?.id ?? ''

  const users = new SqliteUserRepository(booted.db)
  const clients = new SqliteClientRepository(booted.db)
  await clients.save(aClient({ id: CLIENT, name: 'Atelier Camille' }))
  await clients.save(aClient({ id: OTHER, name: 'Studio Sacha' }))
  for (const [id, email] of [
    [OWNER, 'proprietaire@example.test'],
    [MEMBER, 'membre@example.test'],
    [SHARED, 'partage@example.test'],
  ] as const) {
    await users.save(aUser({ id, email }))
  }
  const seat = (clientId: string, userId: string, role: 'owner' | 'member') =>
    clients.grantMember({
      clientId: asClientId(clientId),
      userId: asUserId(userId),
      role,
      grantedAt: new Date(),
    })
  await seat(CLIENT, OWNER, 'owner')
  await seat(CLIENT, MEMBER, 'member')
  await seat(CLIENT, SHARED, 'member')
  await seat(CLIENT, operatorId, 'member')
  await seat(OTHER, SHARED, 'member')

  // Two events of the client, made through the use case so they are real ones: one that is live and
  // one that is still a draft.
  const at = new Date().toISOString()
  const live = await booted.usecases.createEvent({
    ownerId: asUserId(operatorId),
    name: 'Mariage de Camille',
    slug: 'mariage-de-camille',
  })
  const draft = await booted.usecases.createEvent({
    ownerId: asUserId(operatorId),
    name: 'Anniversaire',
    slug: 'anniversaire',
  })
  if (!live.ok || !draft.ok) throw new Error('fixture rejected')
  booted.db
    .prepare(`UPDATE events SET client_id = ?, status = 'live', opened_at = ? WHERE id = ?`)
    .run(CLIENT, at, live.value.id)
  booted.db
    .prepare(`UPDATE events SET client_id = ?, status = 'draft' WHERE id = ?`)
    .run(CLIENT, draft.value.id)

  const operator = await aBrowser(booted)
  await operator.post('/api/auth/login', { email: OPERATOR, password: PASSWORD })
  const confirmed = await operator.post('/api/auth/step-up', { password: PASSWORD })
  expect(confirmed.status).toBeLessThan(300)

  const statuses = () =>
    booted.db
      .prepare<[string], { readonly status: string }>(
        'SELECT status FROM events WHERE client_id = ? ORDER BY slug',
      )
      .all(CLIENT)
      .map((row) => row.status)
  const accountExists = (id: string) =>
    booted.db.prepare('SELECT 1 FROM users WHERE id = ?').get(id) !== undefined
  const clientExists = (id: string) =>
    booted.db.prepare('SELECT 1 FROM clients WHERE id = ?').get(id) !== undefined
  const memberOf = (clientId: string, userId: string) =>
    booted.db
      .prepare('SELECT 1 FROM client_members WHERE client_id = ? AND user_id = ?')
      .get(clientId, userId) !== undefined
  const dueNow = () =>
    booted.db
      .prepare('UPDATE clients SET purge_after = ? WHERE id = ?')
      .run(new Date(Date.now() - 60_000).toISOString(), CLIENT)

  return {
    booted,
    operator,
    operatorId,
    statuses,
    accountExists,
    clientExists,
    memberOf,
    dueNow,
  }
}

describe('offboarding a client, through the real composition root', () => {
  it('closes what was live, archives the draft, freezes the client and dates the purge, over the wire', async () => {
    const s = await scene()

    const response = await s.operator.post(`/api/site/clients/${CLIENT}/offboard`, {
      graceDays: 30,
    })

    expect(response.status).toBe(204)
    expect(s.statuses()).toEqual(['archived', 'closed'])
    const row = s.booted.db
      .prepare<
        [string],
        { readonly suspended_at: string | null; readonly purge_after: string | null }
      >('SELECT suspended_at, purge_after FROM clients WHERE id = ?')
      .get(CLIENT)
    expect(row?.suspended_at).not.toBeNull()
    expect(row?.purge_after).not.toBeNull()
  })

  it('finishes nothing before the deadline: the albums stay, the accounts stay, the client stays', async () => {
    const s = await scene()
    await s.operator.post(`/api/site/clients/${CLIENT}/offboard`, { graceDays: 30 })

    const purged = await s.booted.usecases.purgeExpiredEvents()
    const finalised = await s.booted.usecases.finalizeOffboardedClients()

    expect(purged.purged).toEqual([])
    expect(finalised.finalized).toEqual([])
    expect(s.statuses()).toHaveLength(2)
    expect(s.clientExists(CLIENT)).toBe(true)
    expect(s.accountExists(MEMBER)).toBe(true)
  })

  it('purges the albums at the deadline with the sweep that already exists, then finalises the client', async () => {
    const s = await scene()
    await s.operator.post(`/api/site/clients/${CLIENT}/offboard`, { graceDays: 30 })
    s.dueNow()

    // Not finalised while an album is left: the client has to wait for its events to go first.
    const early = await s.booted.usecases.finalizeOffboardedClients()
    expect(early.finalized).toEqual([])

    const purged = await s.booted.usecases.purgeExpiredEvents()
    expect(purged.purged).toHaveLength(2)
    expect(s.statuses()).toEqual([])

    const finalised = await s.booted.usecases.finalizeOffboardedClients()
    expect(finalised.finalized).toEqual([asClientId(CLIENT)])
    expect(finalised.failed).toEqual([])
    expect(s.clientExists(CLIENT)).toBe(false)
  })

  it('deletes the accounts that were nothing but the client’s and keeps the others', async () => {
    const s = await scene()
    await s.operator.post(`/api/site/clients/${CLIENT}/offboard`, { graceDays: 30 })
    s.dueNow()
    await s.booted.usecases.purgeExpiredEvents()

    const report = await s.booted.usecases.finalizeOffboardedClients()

    expect(report.accountsDeleted).toBe(2)
    expect(s.accountExists(OWNER)).toBe(false)
    expect(s.accountExists(MEMBER)).toBe(false)
    // Belongs to another client as well: removed from this one, and only from this one.
    expect(s.accountExists(SHARED)).toBe(true)
    expect(s.memberOf(CLIENT, SHARED)).toBe(false)
    expect(s.memberOf(OTHER, SHARED)).toBe(true)
    // An operator is never deleted by a sweep, whatever clients it sits in.
    expect(s.accountExists(s.operatorId)).toBe(true)
    expect(s.clientExists(OTHER)).toBe(true)
  })

  it('leaves the lines of the end in the log, by the sweeper, and the operator reads them without an address', async () => {
    const s = await scene()
    await s.operator.post(`/api/site/clients/${CLIENT}/offboard`, { graceDays: 30 })
    s.dueNow()
    await s.booted.usecases.purgeExpiredEvents()
    await s.booted.usecases.finalizeOffboardedClients()

    const log = await s.operator.get('/api/site/audit?limit=200')

    const items = log.body.items as readonly {
      readonly action: string
      readonly actor: { readonly kind: string; readonly label: string | null }
    }[]
    const finalised = items.filter((item) => item.action === 'client.finalized')
    expect(finalised).toHaveLength(1)
    expect(finalised[0]?.actor).toMatchObject({ kind: 'system', label: 'retention-sweeper' })
    expect(items.filter((item) => item.action === 'account.deleted')).toHaveLength(2)
    expect(items.some((item) => item.action === 'client.offboarded')).toBe(true)
    expect(JSON.stringify(log.body)).not.toMatch(/@example\.test/)
  })

  it('is finished once: a second sweep changes nothing and writes no second line', async () => {
    const s = await scene()
    await s.operator.post(`/api/site/clients/${CLIENT}/offboard`, { graceDays: 30 })
    s.dueNow()
    await s.booted.usecases.purgeExpiredEvents()
    await s.booted.usecases.finalizeOffboardedClients()
    const lines = () =>
      s.booted.db.prepare('SELECT COUNT(*) AS n FROM audit_log').get() as { readonly n: number }
    const before = lines().n

    const again = await s.booted.usecases.finalizeOffboardedClients()

    expect(again).toEqual({ finalized: [], accountsDeleted: 0, failed: [] })
    expect(lines().n).toBe(before)
  })

  it('deletes an account for an erasure request over the wire, and a sign-in as it is then refused', async () => {
    const s = await scene()

    const response = await s.operator.delete(`/api/site/accounts/${MEMBER}`)

    expect(response.status).toBe(204)
    expect(s.accountExists(MEMBER)).toBe(false)
    const stranger = await aBrowser(s.booted)
    const attempt = await stranger.post('/api/auth/login', {
      email: 'membre@example.test',
      password: PASSWORD,
    })
    expect(attempt.status).toBe(401)
  })
})
