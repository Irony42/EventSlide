import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { asUserId } from '../domain/shared/ids'
import { loadConfig } from '../infrastructure/config/env'
import { migrations } from '../infrastructure/db/migrations'
import { status } from '../infrastructure/db/migrator'
import { anAuditEntry, anEventSettings } from '../application/testing/builders'
import { SqliteAuditLog } from '../infrastructure/db/sqliteAuditLog'
import { createContainer, type Container } from './container'
import { appVersion } from './version'

/**
 * The one line of `SITE_ADMIN` that no other test reaches: the composition root handing
 * the parsed switch to the HTTP layer.
 *
 * `env.test.ts` proves the variable parses and `siteAdminMode.test.ts` proves what
 * `buildServer` does with `HttpConfig.siteAdmin`, but the harness there builds its own
 * `HttpConfig`. So `siteAdmin: false` written into `container.ts` by mistake — or the
 * wrong field of `AppConfig` — left every one of those green on a box where `SITE_ADMIN=on`
 * mounted nothing. Omitting the field is a type error; a wrong value was not, until this.
 *
 * The same boot is where the other half of the switch's promise lives: it decides how much
 * surface exists, never what the database looks like, so both modes apply every migration
 * and a box that turns it on later finds the schema it needs already there.
 *
 * A real container over a throwaway SQLite file and media root, because that is the
 * object under test. Its timers are built and never started here — `index.ts` starts
 * them — so nothing runs behind the requests and the ledger reads.
 */

/** Under the namespace, and reserved by its spelling: no route will ever claim it. */
const NEVER_A_SITE_ROUTE = '/api/site/__never-a-route__'

let workDir: string | null = null
let container: Container | null = null

const boot = async (source: Record<string, string>): Promise<Container> => {
  workDir = await mkdtemp(join(tmpdir(), 'eventslide-container-'))
  container = await createContainer(
    loadConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'fatal',
      DATABASE_PATH: join(workDir, 'eventslide.sqlite'),
      MEDIA_ROOT: join(workDir, 'media'),
      // A configured path that does not exist is a refusal rather than a search, so the
      // boot answers "no encoder" without spawning anything. Video is not the subject.
      FFMPEG_PATH: join(workDir, 'no-ffmpeg-here'),
      FFPROBE_PATH: join(workDir, 'no-ffprobe-here'),
      ...source,
    }),
  )
  return container
}

afterEach(async () => {
  await container?.dispose()
  container = null
  if (workDir !== null) await rm(workDir, { recursive: true, force: true })
  workDir = null
})

describe('createContainer: SITE_ADMIN reaches the HTTP layer', () => {
  it('mounts no operator namespace on a box that never set it', async () => {
    const { app } = await boot({})

    const response = await request(app).get(NEVER_A_SITE_ROUTE)

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('route.notFound')
  })

  it('mounts the operator namespace behind requireOperator when SITE_ADMIN=on', async () => {
    const { app } = await boot({ SITE_ADMIN: 'on' })

    const response = await request(app).get(NEVER_A_SITE_ROUTE)

    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('auth.required')
  })
})

describe('createContainer: readiness reaches the real health check (P4-06)', () => {
  /**
   * `server.test.ts`'s own shutdown tests build a `MutableHealthChecks` through
   * `buildServerHarness()`, a path that never calls `createContainer` — so a mistake in
   * *this* file's wiring (the wrong field read, `isShuttingDown: () => false`, a typo in
   * the key `buildServer` is handed) would leave every one of those green. This is the
   * one place that boots a real container and drives `container.readiness` and
   * `/api/ready` through the same object `main/index.ts` actually gets back.
   */
  it('answers /api/ready 200 until container.readiness.markShuttingDown() flips it to 503', async () => {
    const { app, readiness } = await boot({})

    const before = await request(app).get('/api/ready')
    expect(before.status).toBe(200)
    expect(before.body.status).toBe('ready')

    readiness.markShuttingDown()

    const after = await request(app).get('/api/ready')
    expect(after.status).toBe(503)
    expect(after.body.error.code).toBe('service.notReady')
  })
})

/**
 * The same shape of gap `SITE_ADMIN` above exists for: `config.realtime.maxSubscribersPerEvent`
 * reaching `createInMemoryEventBus` is one line in `container.ts`
 * (`createInMemoryEventBus({ logger, maxSubscribersPerEvent: ... })`), and nothing elsewhere
 * proves that line is still there. `env.test.ts` only proves the variable parses;
 * `inMemoryEventBus.test.ts` hands the adapter its cap directly, bypassing the container
 * entirely; and `streamRoutes.test.ts` covers the two *HTTP* concurrency ceilings
 * (`MAX_STREAMS_PER_CLIENT`/`MAX_STREAMS_TOTAL`) through a real container but never this
 * one, which lives one level lower, in the bus itself. A real socket is unavoidable here:
 * the bus's own refusal is what the SSE route answers before a single header is written,
 * and that can only be observed by actually holding a connection open.
 */
describe('createContainer: MAX_SUBSCRIBERS_PER_EVENT reaches the event bus', () => {
  const openRaw = (port: number, path: string): Promise<http.IncomingMessage> =>
    new Promise((resolve, reject) => {
      const req = http.get({ port, path }, resolve)
      req.on('error', reject)
    })

  it('refuses a second subscriber to the same event once the configured cap is reached', async () => {
    const { app, db } = await boot({ MAX_SUBSCRIBERS_PER_EVENT: '1' })

    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO users (id, email, password_hash, created_at) VALUES ('user-host', 'host@example.test', 'hash:x', ?)`,
    ).run(now)
    db.prepare(
      `INSERT INTO events (id, owner_id, name, slug, join_code, status, settings, quota_bytes, created_at)
            VALUES ('event-1', 'user-host', 'Test', 'mariage', 'H7K2QM', 'live', ?, 1000000000, ?)`,
    ).run(JSON.stringify(anEventSettings().toProps()), now)

    const server = http.createServer(app)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port

    try {
      const first = await openRaw(port, '/api/events/mariage/stream')
      expect(first.statusCode).toBe(200)

      const second = await openRaw(port, '/api/events/mariage/stream')
      const body: Buffer[] = []
      await new Promise<void>((resolve) => {
        second.on('data', (chunk: Buffer) => body.push(chunk))
        second.on('end', resolve)
      })

      expect(second.statusCode).toBe(503)
      expect(JSON.parse(Buffer.concat(body).toString('utf8'))).toMatchObject({
        error: { code: 'service.notReady' },
      })

      first.destroy()
      second.destroy()
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})

describe('createContainer: SITE_ADMIN decides surface, never schema', () => {
  it.each(['off', 'on'] as const)(
    'applies every migration with SITE_ADMIN=%s, so turning it on later needs no other schema',
    async (mode) => {
      const { db } = await boot({ SITE_ADMIN: mode })

      expect(status(db, migrations).applied.map((row) => row.id)).toEqual(
        migrations.map((migration) => migration.id),
      )
    },
  )
})

/**
 * The same gap, for the source offer (roadmap G1-04 / P1-05).
 *
 * `env.test.ts` proves `SOURCE_CODE_URL` and `SOURCE_REF` parse and `aboutRoutes.test.ts`
 * proves the route prints what it is handed, but the harness there hands it a made-up
 * `{ version, sourceUrl }`. What only this boot can show is the composition root doing its
 * two jobs: reading the **one** version (`version.ts`, the same answer `/api/health` gives)
 * and resolving the link from the parsed configuration rather than from a constant.
 */
describe('createContainer: the source offer reaches /api/about', () => {
  const UPSTREAM = 'https://github.com/Irony42/EventSlide'

  it('names the running version and its upstream tag on a box that configures nothing', async () => {
    const { app } = await boot({})

    const response = await request(app).get('/api/about')

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      version: appVersion(),
      sourceUrl: `${UPSTREAM}/tree/v${appVersion()}`,
    })
  })

  it('reports the same version as /api/health, so the two endpoints cannot name different builds', async () => {
    const { app } = await boot({})

    const [about, health] = await Promise.all([
      request(app).get('/api/about'),
      request(app).get('/api/health'),
    ])

    expect(about.body.version).toBe(health.body.version)
  })

  it("offers the operator's own SOURCE_CODE_URL when one is set", async () => {
    const { app } = await boot({ SOURCE_CODE_URL: 'https://git.example.org/me/eventslide' })

    const response = await request(app).get('/api/about')

    expect(response.body.sourceUrl).toBe('https://git.example.org/me/eventslide')
  })

  it('offers the ref the image was built from when the build argument was given', async () => {
    const { app } = await boot({ SOURCE_REF: 'v9.9.9' })

    const response = await request(app).get('/api/about')

    expect(response.body.sourceUrl).toBe(`${UPSTREAM}/tree/v9.9.9`)
  })

  it.each([
    ['off', false],
    ['on', true],
  ] as const)('states SITE_ADMIN=%s as the flag the SPA reads', async (mode, flag) => {
    const { app } = await boot({ SITE_ADMIN: mode })

    const response = await request(app).get('/api/about')

    expect(response.body.features).toEqual({ siteAdmin: flag })
  })
})

/**
 * `EVENT_CREATION` reaching `createEvent`, and the use case running over the real adapters
 * the container wires (P3-05 / G2-04).
 *
 * `env.test.ts` proves the variable parses and `createEvent.test.ts` proves what the use
 * case does with a policy, over fakes. What neither reaches is the line in `usecases.ts`
 * that hands one to the other, and the SQLite adapters standing behind the ports: a policy
 * wired as a constant, or a `users` or `clients` handed the wrong repository, passes both.
 * So the accounts here are rows, the client is a row, and the answers come from the real
 * `SqliteEventRepository.createWithOwner`.
 */
describe('createContainer: EVENT_CREATION reaches createEvent', () => {
  const insertUser = (container: Container, id: string, siteRole: 'none' | 'operator'): void => {
    container.db
      .prepare(
        `INSERT INTO users (id, email, password_hash, created_at, site_role)
         VALUES (?, ?, 'hash:x', ?, ?)`,
      )
      .run(id, `${id}@example.test`, new Date().toISOString(), siteRole)
  }

  const insertClientMember = (container: Container, userId: string): void => {
    const at = new Date().toISOString()
    container.db
      .prepare('INSERT INTO clients (id, name, created_at) VALUES (?, ?, ?)')
      .run('client-1', 'Atelier Camille', at)
    container.db
      .prepare(
        `INSERT INTO client_members (client_id, user_id, role, granted_at)
         VALUES ('client-1', ?, 'member', ?)`,
      )
      .run(userId, at)
  }

  const eventRow = (container: Container, slug: string) =>
    container.db
      .prepare<[string], { readonly client_id: string | null }>(
        'SELECT client_id FROM events WHERE slug = ?',
      )
      .get(slug)

  it('lets an account with no client create an event on a box that never set it', async () => {
    const container = await boot({})
    insertUser(container, 'user-invitee', 'none')

    const result = await container.usecases.createEvent({
      ownerId: asUserId('user-invitee'),
      name: 'Camille & Sacha',
    })

    expect(result.ok).toBe(true)
    expect(eventRow(container, 'camille-sacha')?.client_id).toBeNull()
  })

  it('refuses that same account once EVENT_CREATION=clientMembers is set', async () => {
    const container = await boot({ SITE_ADMIN: 'on', EVENT_CREATION: 'clientMembers' })
    insertUser(container, 'user-invitee', 'none')

    const result = await container.usecases.createEvent({
      ownerId: asUserId('user-invitee'),
      name: 'Camille & Sacha',
    })

    expect(!result.ok && result.error.code).toBe('event.creationNotAllowed')
    expect(eventRow(container, 'camille-sacha')).toBeUndefined()
  })

  it('still lets the operator create one, with no client', async () => {
    const container = await boot({ SITE_ADMIN: 'on', EVENT_CREATION: 'clientMembers' })
    insertUser(container, 'user-operator', 'operator')

    const result = await container.usecases.createEvent({
      ownerId: asUserId('user-operator'),
      name: 'Camille & Sacha',
    })

    expect(result.ok).toBe(true)
    expect(eventRow(container, 'camille-sacha')?.client_id).toBeNull()
  })

  it('stores the member’s client on the event and counts it, in the real database', async () => {
    const container = await boot({ SITE_ADMIN: 'on', EVENT_CREATION: 'clientMembers' })
    insertUser(container, 'user-member', 'none')
    insertClientMember(container, 'user-member')

    const result = await container.usecases.createEvent({
      ownerId: asUserId('user-member'),
      name: 'Camille & Sacha',
    })

    expect(result.ok).toBe(true)
    expect(eventRow(container, 'camille-sacha')?.client_id).toBe('client-1')
    expect(
      container.db
        .prepare<[], { readonly n: number }>(
          "SELECT events_created_in_period AS n FROM clients WHERE id = 'client-1'",
        )
        .get()?.n,
    ).toBe(1)
  })
})

describe('createContainer: the audit log is wired end to end (roadmap 10.8)', () => {
  const rows = (db: Container['db']): number =>
    (db.prepare(`SELECT COUNT(*) AS n FROM audit_log`).get() as { n: number }).n

  it('writes setClientCeilings’ entry into the real audit_log, not into a fake', async () => {
    const { usecases, db } = await boot({ SITE_ADMIN: 'on' })
    const created = await usecases.createClient({ name: 'Atelier Photo Camille' })
    if (!created.ok) throw new Error(`fixture rejected: ${created.error.code}`)

    const changed = await usecases.setClientCeilings({
      clientId: created.value.id,
      ceilings: { maxEvents: 3 },
      actor: { kind: 'integration', label: 'test:wiring' },
    })

    expect(changed.ok).toBe(true)
    expect(db.prepare(`SELECT action, actor_kind, client_id FROM audit_log`).all()).toEqual([
      { action: 'client.ceilingsChanged', actor_kind: 'integration', client_id: created.value.id },
    ])
  })

  it('hands AUDIT_RETENTION_DAYS to the pruning use case, so the cutoff is that many days back', async () => {
    const { usecases } = await boot({ AUDIT_RETENTION_DAYS: '400' })

    const report = await usecases.pruneAuditLog()

    const daysBack = (Date.now() - report.cutoff.getTime()) / 86_400_000
    expect(Math.round(daysBack)).toBe(400)
  })

  it('has the retention sweep prune an old entry through the real adapter, and leave the gate shut', async () => {
    const { retention, db } = await boot({ RETENTION_SWEEP_INTERVAL_MINUTES: '60' })
    await new SqliteAuditLog(db).record(
      anAuditEntry({
        at: new Date('2001-01-01T00:00:00.000Z'),
        actor: { kind: 'integration', label: 'test:wiring' },
      }),
    )
    expect(rows(db)).toBe(1)

    await retention?.runOnce()

    expect(rows(db)).toBe(0)
    expect(db.prepare(`SELECT open FROM audit_prune_gate`).get()).toEqual({ open: 0 })
  })
})

/**
 * The same gap, for the support links (roadmap G4-02): `env.test.ts` proves the two
 * variables parse and `aboutRoutes.test.ts` proves the route leaves an unset link out, but
 * only this boot shows the composition root handing the parsed value to the route — and,
 * above all, that a box which sets nothing says nothing about money.
 */
describe('createContainer: the support links reach /api/about', () => {
  it('publishes no link on a box that configures nothing', async () => {
    const { app } = await boot({})

    const response = await request(app).get('/api/about')

    expect(response.body.links).toEqual({})
  })

  it('publishes none when compose renders the unset variables as empty strings', async () => {
    // `DONATION_URL: ${DONATION_URL:-}` is what `docker compose up` sends by default.
    const { app } = await boot({ DONATION_URL: '', BUDGET_URL: '' })

    const response = await request(app).get('/api/about')

    expect(response.body.links).toEqual({})
  })

  it('publishes DONATION_URL as links.donate and BUDGET_URL as links.budget', async () => {
    const { app } = await boot({
      DONATION_URL: 'https://opencollective.com/eventslide',
      BUDGET_URL: 'https://opencollective.com/eventslide/budget',
    })

    const response = await request(app).get('/api/about')

    expect(response.body.links).toEqual({
      donate: 'https://opencollective.com/eventslide',
      budget: 'https://opencollective.com/eventslide/budget',
    })
  })

  it('does not tie one link to the other', async () => {
    const { app } = await boot({ BUDGET_URL: 'https://ledger.example.org/' })

    const response = await request(app).get('/api/about')

    expect(response.body.links).toEqual({ budget: 'https://ledger.example.org/' })
  })
})
