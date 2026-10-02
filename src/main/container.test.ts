import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { asEventId, asUserId } from '../domain/shared/ids'
import { loadConfig } from '../infrastructure/config/env'
import { migrations } from '../infrastructure/db/migrations'
import { status } from '../infrastructure/db/migrator'
import { anAuditEntry, anEventSettings } from '../application/testing/builders'
import { SqliteAuditLog } from '../infrastructure/db/sqliteAuditLog'
import { createContainer, type Container } from './container'
import { appVersion } from './version'
import type { OutgoingMail } from '../application/ports/mailer'
import { decodeBase32 } from '../domain/users/base32'
import { EmailAddress } from '../domain/users/emailAddress'
import { totpStepAt } from '../domain/users/totp'
import { nodeTotpEngine } from '../infrastructure/crypto/nodeTotpEngine'
import { parseMessage, startSmtpSink, type SmtpSink } from '../infrastructure/mail/testing/smtpSink'
import { CSRF_COOKIE, CSRF_HEADER } from '../interface/http/middleware/csrf'

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

    // No relay on this box, so no self-service reset: the flag the sign-in page reads is off.
    expect(response.body.features).toEqual({ siteAdmin: flag, forgotPassword: false })
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

/**
 * A client's ceilings reaching every write path, over the real adapters the container wires
 * (roadmap §10.5 / G2-05).
 *
 * The use-case tests prove each rule over fakes; what only the composition root can get wrong
 * is the plumbing — a use case handed no `clients`, the notice days read from the wrong field,
 * a repository answering `contextForEvent` for the wrong row. So the client, its event and the
 * ceilings are rows, and the answers come from `SqliteClientRepository` and
 * `SqliteEventRepository` themselves.
 */
describe('createContainer: a client’s ceilings reach every write path', () => {
  const DAY = 86_400_000
  const OWNER = asUserId('user-owner')

  const isoDaysAgo = (days: number): string => new Date(Date.now() - days * DAY).toISOString()

  const seedClientEvent = (
    container: Container,
    input: {
      readonly status: string
      readonly ceilings?: string
      readonly clientSets?: string
      readonly openedDaysAgo?: number
      readonly closedDaysAgo?: number
      readonly settings?: string
    },
  ): void => {
    const at = new Date().toISOString()
    container.db
      .prepare(
        `INSERT INTO users (id, email, password_hash, created_at) VALUES (?, 'owner@example.test', 'hash:x', ?)`,
      )
      .run(OWNER, at)
    container.db
      .prepare(`INSERT INTO clients (id, name, created_at) VALUES ('client-1', 'Atelier', ?)`)
      .run(at)
    if (input.ceilings !== undefined) {
      container.db.prepare(`UPDATE clients SET ${input.ceilings} WHERE id = 'client-1'`).run()
    }
    container.db
      .prepare(
        `INSERT INTO events (id, owner_id, name, slug, join_code, status, settings, quota_bytes,
                             created_at, client_id, opened_at, closed_at)
         VALUES ('event-1', ?, 'Soirée', 'soiree', 'H7K2QM', ?, ?, 1000000000, ?, 'client-1', ?, ?)`,
      )
      .run(
        OWNER,
        input.status,
        input.settings ?? JSON.stringify(anEventSettings().toProps()),
        at,
        input.openedDaysAgo === undefined ? null : isoDaysAgo(input.openedDaysAgo),
        input.closedDaysAgo === undefined ? null : isoDaysAgo(input.closedDaysAgo),
      )
    container.db
      .prepare(
        `INSERT INTO event_memberships (event_id, user_id, role, granted_at)
         VALUES ('event-1', ?, 'owner', ?)`,
      )
      .run(OWNER, at)
  }

  const rowOfEvent = (container: Container) =>
    container.db
      .prepare<[], { readonly status: string; readonly closed_at: string | null }>(
        `SELECT status, closed_at FROM events WHERE id = 'event-1'`,
      )
      .get()

  it('refuses opening an event for a client with live_allowed = 0, as 403 client.liveNotAllowed', async () => {
    const container = await boot({})
    seedClientEvent(container, { status: 'draft', ceilings: 'live_allowed = 0' })

    const result = await container.usecases.changeEventStatus({
      eventId: asEventId('event-1'),
      actorId: OWNER,
      status: 'live',
    })

    expect(!result.ok && result.error.code).toBe('client.liveNotAllowed')
    expect(rowOfEvent(container)?.status).toBe('draft')
  })

  it('refuses a reopening after the live window, as 403 client.liveWindowOver', async () => {
    const container = await boot({})
    seedClientEvent(container, {
      status: 'closed',
      ceilings: 'max_live_days = 3',
      openedDaysAgo: 10,
      closedDaysAgo: 9,
    })

    const result = await container.usecases.changeEventStatus({
      eventId: asEventId('event-1'),
      actorId: OWNER,
      status: 'live',
    })

    expect(!result.ok && result.error.code).toBe('client.liveWindowOver')
  })

  it('refuses a retention above max_retention_days, as 400 client.retentionAboveCeiling', async () => {
    const container = await boot({})
    seedClientEvent(container, { status: 'draft', ceilings: 'max_retention_days = 30' })

    const result = await container.usecases.updateEventSettings({
      eventId: asEventId('event-1'),
      actorId: OWNER,
      patch: { retentionDays: 90 },
    })

    expect(!result.ok && result.error.code).toBe('client.retentionAboveCeiling')
  })

  it('closes a live event whose client’s window has run out, on the schedule sweep', async () => {
    const container = await boot({})
    seedClientEvent(container, {
      status: 'live',
      ceilings: 'max_live_days = 3',
      openedDaysAgo: 4,
    })

    const report = await container.usecases.applyEventSchedules()

    expect(report.autoClosed).toEqual(['event-1'])
    expect(rowOfEvent(container)?.status).toBe('closed')
    expect(rowOfEvent(container)?.closed_at).not.toBeNull()
  })

  describe('RETENTION_CAP_NOTICE_DAYS reaches the purge', () => {
    /** Closed 60 days ago, kept for ever, under a ceiling lowered 11 days ago to 14. */
    const lowered = (container: Container): void =>
      seedClientEvent(container, {
        status: 'closed',
        ceilings: `max_retention_days = 14, retention_cap_since = '${isoDaysAgo(11)}'`,
        openedDaysAgo: 61,
        closedDaysAgo: 60,
        settings: JSON.stringify(anEventSettings({ retentionDays: null }).toProps()),
      })

    it('spares it for the default thirty days after the ceiling was lowered', async () => {
      const container = await boot({})
      lowered(container)

      const report = await container.usecases.purgeExpiredEvents()

      expect(report.purged).toEqual([])
    })

    it('purges it once the configured, shorter notice has run', async () => {
      const container = await boot({ RETENTION_CAP_NOTICE_DAYS: '10' })
      lowered(container)

      const report = await container.usecases.purgeExpiredEvents()

      expect(report.purged).toEqual(['event-1'])
    })
  })
})

/**
 * Outgoing mail (G2-07 / P3-08): the composition root choosing the mailer.
 *
 * `env.test.ts` proves `SMTP_URL` parses and `smtpMailer.test.ts` proves the adapter speaks
 * SMTP, but neither can show **which one the box gets**, and a wrong answer in either
 * direction is quiet: `NullMailer` wired where a relay is configured means invitations are
 * never e-mailed and nothing says so; the SMTP adapter wired where none is configured means
 * every send is a connection attempt to nowhere. Both go through one conditional in
 * `container.ts`, and this is the only test that boots through it.
 */
describe('createContainer: outgoing mail', () => {
  const recipientOf = (address: string): EmailAddress => {
    const parsed = EmailAddress.create(address)
    if (!parsed.ok) throw new Error(`invalid fixture: ${parsed.error.code}`)
    return parsed.value
  }
  const aMail = (): OutgoingMail => ({
    to: recipientOf('camille@example.org'),
    subject: 'Your invitation',
    text: 'Open the link to choose a password.',
  })

  const relays: SmtpSink[] = []
  afterEach(async () => {
    await Promise.all(relays.splice(0).map((relay) => relay.close()))
  })

  it('wires the NullMailer on a box that never set SMTP_URL, which is the self-hoster default', async () => {
    const { mailer } = await boot({})

    expect(mailer.canDeliver).toBe(false)
    const result = await mailer.send(aMail())
    expect(!result.ok && result.error.code).toBe('mail.notConfigured')
  })

  it('wires the NullMailer when both variables are blank, which is what compose sends with neither set', async () => {
    const { mailer } = await boot({ SMTP_URL: '', MAIL_FROM: '' })

    expect(mailer.canDeliver).toBe(false)
  })

  it('wires the SMTP adapter when SMTP_URL is set, and a message really reaches the relay', async () => {
    const relay = await startSmtpSink({ auth: { user: 'camille', pass: 'p@ss' } })
    relays.push(relay)
    const { mailer } = await boot({
      SMTP_URL: `smtp://camille:p%40ss@127.0.0.1:${relay.port}`,
      MAIL_FROM: 'EventSlide <no-reply@photos.example.org>',
    })

    expect(mailer.canDeliver).toBe(true)
    const result = await mailer.send(aMail())

    expect(result.ok).toBe(true)
    expect(relay.messages).toHaveLength(1)
    // The configured sender and login both came through the container, not a default.
    expect(relay.messages[0]?.envelopeFrom).toBe('no-reply@photos.example.org')
    expect(relay.messages[0]?.envelopeTo).toEqual(['camille@example.org'])
    expect(parseMessage(relay.messages[0]?.raw ?? '').subject).toBe('Your invitation')
    expect(relay.logins).toEqual([{ user: 'camille', pass: 'p@ss' }])
  })

  it('opens no connection at boot: the relay is dialled by the first send and by nothing before it', async () => {
    // Counted at the relay rather than inferred from a login, because a relay that wants
    // none would never notice a connection made for a `verify()` at start-up — and a boot
    // that waits on a mail server is a photo wall that does not start when the server is slow.
    const relay = await startSmtpSink()
    relays.push(relay)
    const { mailer } = await boot({
      SMTP_URL: `smtp://127.0.0.1:${relay.port}`,
      MAIL_FROM: 'no-reply@photos.example.org',
    })

    expect(relay.connections).toBe(0)

    await mailer.send(aMail())

    expect(relay.connections).toBe(1)
  })

  it('boots when the relay is down, because a photo wall must serve a room whatever the mail server is doing', async () => {
    const relay = await startSmtpSink()
    const { port } = relay
    await relay.close()

    const { mailer } = await boot({
      SMTP_URL: `smtp://127.0.0.1:${port}`,
      MAIL_FROM: 'no-reply@photos.example.org',
    })

    // Chosen at boot, discovered on the first send — as a failure, never as a throw.
    expect(mailer.canDeliver).toBe(true)
    const result = await mailer.send(aMail())
    expect(!result.ok && result.error.code).toBe('mail.transient')
  })

  /**
   * What the container logs when it wires a relay: where it will connect, never how it
   * authenticates. Captured below the logger, where pino's output leaves the process, so it
   * is the bytes an operator's log shipper would collect and not the arguments of a call.
   */
  it('logs the relay by host and port at boot, and never its URL or its password', async () => {
    const PASSWORD = 'PASSWORD-CANARY-9e41'
    const written: string[] = []
    const record = (...args: unknown[]): number => {
      const text = Buffer.isBuffer(args[1]) ? args[1].toString('utf8') : String(args[1])
      if (args[0] === 1) written.push(text)
      return Buffer.byteLength(text)
    }
    const asyncWrite = vi.spyOn(fs, 'write').mockImplementation(((...args: unknown[]) => {
      const size = record(...args)
      const callback = args[args.length - 1]
      if (typeof callback === 'function') {
        ;(callback as (error: Error | null, written: number) => void)(null, size)
      }
    }) as unknown as typeof fs.write)
    const syncWrite = vi
      .spyOn(fs, 'writeSync')
      .mockImplementation(((...args: unknown[]) =>
        record(...args)) as unknown as typeof fs.writeSync)

    try {
      // Production, because that is the posture that writes JSON to fd 1; development
      // would hand the line to `pino-pretty` in a worker thread, below this capture.
      await boot({
        NODE_ENV: 'production',
        LOG_LEVEL: 'info',
        PUBLIC_URL: 'https://photos.example.com',
        SESSION_SECRET: 'f3b1c9d7e5a2408c9b6d1e4f7a0c3b5d8e2f6a19c4d7b0e3',
        GUEST_TOKEN_SECRET: '9a7c5e3b1d8f6042ae1c3b5d7f9014682a4c6e8b0d2f4a6c',
        TRUST_PROXY_HOPS: '1',
        SMTP_URL: `smtps://camille:${PASSWORD}@mail.example.com:2465`,
        MAIL_FROM: 'no-reply@photos.example.org',
      })
      // sonic-boom batches the current tick and flushes on the next one.
      await new Promise((resolve) => setImmediate(resolve))
    } finally {
      asyncWrite.mockRestore()
      syncWrite.mockRestore()
    }

    const output = written.join('')
    expect(output).toContain('outgoing mail goes through an SMTP relay')
    expect(output).toContain('mail.example.com')
    expect(output).toContain('2465')
    expect(output).not.toContain(PASSWORD)
    expect(output).not.toContain('camille')
  })
})

/**
 * The same gap, for the operator's identity (roadmap G2-17 / P3-18): `env.test.ts` proves the
 * seven variables parse, `aboutRoutes.test.ts` proves the route leaves an unset one out, and
 * `getPrivacyNotice.test.ts` proves a use case names the operator it was given. Only this boot
 * shows the composition root handing the parsed values to **both** the route and the three use
 * cases — and that a box which sets none of them says nothing, to anyone.
 */
describe('createContainer: the operator reaches /api/about and the guest notice', () => {
  /**
   * What the notice handed to a guest who joins a freshly created event says about its
   * operator, through the real use cases over the real SQLite file: the owner is a row, the
   * event is created by `createEvent`, and the join is `joinEvent` with the code it minted.
   */
  const joinFreshEvent = async (booted: Container) => {
    booted.db
      .prepare(
        `INSERT INTO users (id, email, password_hash, created_at, site_role)
         VALUES ('user-host', 'user-host@example.test', 'hash:x', ?, 'none')`,
      )
      .run(new Date().toISOString())
    const created = await booted.usecases.createEvent({
      ownerId: asUserId('user-host'),
      name: 'Camille & Sacha',
    })
    if (!created.ok) throw new Error(`fixture rejected: ${created.error.code}`)
    // A new event is a draft, and the front door answers only for one that is live.
    const opened = await booted.usecases.changeEventStatus({
      eventId: created.value.id,
      actorId: asUserId('user-host'),
      status: 'live',
    })
    if (!opened.ok) throw new Error(`fixture rejected: ${opened.error.code}`)
    const row = booted.db
      .prepare<[], { readonly join_code: string }>('SELECT join_code FROM events')
      .get()
    if (row === undefined) throw new Error('fixture: no event row')

    const joined = await booted.usecases.joinEvent({ joinCode: row.join_code })
    if (!joined.ok) throw new Error(`fixture rejected: ${joined.error.code}`)
    return { eventId: created.value.id, ...joined.value }
  }

  const noticeOperatorOn = async (booted: Container): Promise<string | null> =>
    (await joinFreshEvent(booted)).privacyNotice.notice.operator

  it('publishes no operator and no legal link on a box that configures nothing', async () => {
    const { app } = await boot({})

    const response = await request(app).get('/api/about')

    expect(response.body.operator).toBeUndefined()
    expect(response.body.links).toEqual({})
  })

  it('publishes none when compose renders the unset variables as empty strings', async () => {
    const { app } = await boot({
      OPERATOR_NAME: '',
      OPERATOR_CONTACT_EMAIL: '',
      LEGAL_TERMS_URL: '',
      LEGAL_PRIVACY_URL: '',
      LEGAL_NOTICE_URL: '',
      SUPPORT_URL: '',
      REPORT_URL: '',
    })

    const response = await request(app).get('/api/about')

    expect(response.body.operator).toBeUndefined()
    expect(response.body.links).toEqual({})
  })

  it('publishes the operator, and each link under the name the plan gives it', async () => {
    const { app } = await boot({
      OPERATOR_NAME: 'Association Les Photographes',
      OPERATOR_CONTACT_EMAIL: 'contact@hosted.example.org',
      LEGAL_TERMS_URL: 'https://hosted.example.org/legal/cgu',
      LEGAL_PRIVACY_URL: 'https://hosted.example.org/legal/confidentialite',
      LEGAL_NOTICE_URL: '/legal/mentions',
      SUPPORT_URL: '/legal/avant-evenement',
      REPORT_URL: '/legal/signaler',
    })

    const response = await request(app).get('/api/about')

    expect(response.body.operator).toEqual({
      name: 'Association Les Photographes',
      contactEmail: 'contact@hosted.example.org',
    })
    expect(response.body.links).toEqual({
      terms: 'https://hosted.example.org/legal/cgu',
      privacy: 'https://hosted.example.org/legal/confidentialite',
      legalNotice: '/legal/mentions',
      support: '/legal/avant-evenement',
      report: '/legal/signaler',
    })
  })

  it('publishes a name with no contact address', async () => {
    const { app } = await boot({ OPERATOR_NAME: 'Les Photographes' })

    const response = await request(app).get('/api/about')

    expect(response.body.operator).toEqual({ name: 'Les Photographes' })
  })

  it('publishes a link on a box that named nobody, with no operator beside it', async () => {
    const { app } = await boot({ REPORT_URL: '/legal/signaler' })

    const response = await request(app).get('/api/about')

    expect(response.body.operator).toBeUndefined()
    expect(response.body.links).toEqual({ report: '/legal/signaler' })
  })

  it('names the operator in the notice a joining guest is handed', async () => {
    const booted = await boot({ OPERATOR_NAME: 'Association Les Photographes' })

    expect(await noticeOperatorOn(booted)).toBe('Association Les Photographes')
  })

  it('lets that guest acknowledge the notice and read it back as current, which needs all three use cases to name the same operator', async () => {
    // `joinEvent`, `getPrivacyNotice` and `acknowledgePrivacyNotice` each derive the notice.
    // Handed the name in one place and not another, a guest would be shown a revision that
    // the acknowledgement refuses as outdated, and asked again for ever.
    const booted = await boot({ OPERATOR_NAME: 'Association Les Photographes' })
    const joined = await joinFreshEvent(booted)
    const { eventId, guestId, privacyNotice } = joined

    const acknowledged = await booted.usecases.acknowledgePrivacyNotice({
      eventId,
      guestId,
      revision: privacyNotice.notice.revision,
    })
    const read = await booted.usecases.getPrivacyNotice({ eventId, guestId })

    expect(acknowledged.ok && acknowledged.value.acknowledgement).toBe('current')
    expect(read.ok && read.value.acknowledgement).toBe('current')
    expect(read.ok && read.value.notice.revision).toBe(privacyNotice.notice.revision)
  })

  it('names nobody in that notice on a box whose operator said nothing', async () => {
    const booted = await boot({})

    expect(await noticeOperatorOn(booted)).toBeNull()
  })
})

/**
 * A forgotten password, end to end through the real composition root (roadmap §10.3; free
 * plan G2-08, paid plan P3-09): the SMTP adapter against a relay in this process, the SQLite
 * adapters for accounts and tokens, the real hasher and the real session store.
 *
 * Every ring below this one proves a piece against a fake. What only this can show is that
 * the pieces are the ones the box wires: that `features.forgotPassword` is the mailer's own
 * `canDeliver`, that the link in a mail the relay actually received opens exactly one reset,
 * that the reset ends a session opened before it, and that no table of the database holds
 * the token it was sent.
 */
describe('createContainer: a forgotten password', () => {
  const OWNER = 'hote@example.org'
  const OLD_PASSWORD = 'un-mot-de-passe-solide'
  const NEW_PASSWORD = 'une-phrase-de-passe-neuve'

  const relays: SmtpSink[] = []
  afterEach(async () => {
    await Promise.all(relays.splice(0).map((relay) => relay.close()))
  })

  const bootWithRelay = async (): Promise<{
    app: Container['app']
    relay: SmtpSink
    db: Container['db']
  }> => {
    const relay = await startSmtpSink()
    relays.push(relay)
    const booted = await boot({
      SMTP_URL: `smtp://127.0.0.1:${relay.port}`,
      MAIL_FROM: 'no-reply@photos.example.org',
      PUBLIC_URL: 'https://photos.example.org',
      BOOTSTRAP_OWNER_EMAIL: OWNER,
      BOOTSTRAP_OWNER_PASSWORD: OLD_PASSWORD,
    })
    return { app: booted.app, relay, db: booted.db }
  }

  /** A browser that has loaded a page: it holds the CSRF cookie and echoes it. */
  const browser = async (app: Container['app']) => {
    const agent = request.agent(app)
    const first = await agent.get('/api/auth/me')
    const cookie = (first.headers['set-cookie'] as unknown as string[] | undefined)?.find((c) =>
      c.startsWith(`${CSRF_COOKIE}=`),
    )
    const token = cookie?.slice(CSRF_COOKIE.length + 1).split(';')[0] ?? ''
    return { agent, csrf: token }
  }

  const login = async (app: Container['app'], password: string) => {
    const { agent, csrf } = await browser(app)
    const response = await agent
      .post('/api/auth/login')
      .set(CSRF_HEADER, csrf)
      .send({ email: OWNER, password })
    return { agent, response }
  }

  const tokenIn = (relay: SmtpSink): string => {
    const text = parseMessage(relay.messages.at(-1)?.raw ?? '').text ?? ''
    const token = /\/password\/reset\/([A-Za-z0-9_-]+)/.exec(text)?.[1]
    if (token === undefined) throw new Error('the relay received no reset link')
    return token
  }

  it('states forgotPassword=true exactly when the box has a relay', async () => {
    const withRelay = await bootWithRelay()
    const answered = await request(withRelay.app).get('/api/about')
    expect(answered.body.features.forgotPassword).toBe(true)
  })

  it('answers 404 feature.unavailable, and issues nothing, on a box with no relay', async () => {
    const booted = await boot({
      BOOTSTRAP_OWNER_EMAIL: OWNER,
      BOOTSTRAP_OWNER_PASSWORD: OLD_PASSWORD,
    })
    const { agent, csrf } = await browser(booted.app)

    const response = await agent
      .post('/api/auth/password-reset/request')
      .set(CSRF_HEADER, csrf)
      .send({ email: OWNER })

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('feature.unavailable')
    const rows = booted.db.prepare('SELECT COUNT(*) AS n FROM account_tokens').get() as {
      n: number
    }
    expect(rows.n).toBe(0)
  })

  it('mails a link the relay receives, and that link resets the password exactly once', async () => {
    const { app, relay } = await bootWithRelay()
    const { agent, csrf } = await browser(app)

    const asked = await agent
      .post('/api/auth/password-reset/request')
      .set(CSRF_HEADER, csrf)
      .send({ email: OWNER, locale: 'en' })
    expect(asked.status).toBe(202)
    await vi.waitFor(() => expect(relay.messages).toHaveLength(1))
    const mail = parseMessage(relay.messages[0]?.raw ?? '')
    expect(mail.subject).toBe('Reset your EventSlide password')
    expect(relay.messages[0]?.envelopeTo).toEqual([OWNER])
    const token = tokenIn(relay)

    const spent = await agent
      .post('/api/auth/password-reset/confirm')
      .set(CSRF_HEADER, csrf)
      .send({ token, password: NEW_PASSWORD })
    const again = await agent
      .post('/api/auth/password-reset/confirm')
      .set(CSRF_HEADER, csrf)
      .send({ token, password: 'une-autre-phrase-de-passe' })

    expect(spent.status).toBe(204)
    expect(again.status).toBe(400)
    expect(again.body.error.code).toBe('auth.invalidToken')
    expect((await login(app, NEW_PASSWORD)).response.status).toBe(200)
    expect((await login(app, OLD_PASSWORD)).response.status).toBe(401)
  })

  it('ends a session that was open before the reset, on the real session store', async () => {
    const { app, relay } = await bootWithRelay()
    const elsewhere = await login(app, OLD_PASSWORD)
    expect(elsewhere.response.status).toBe(200)
    expect((await elsewhere.agent.get('/api/auth/me')).body.authenticated).toBe(true)
    const { agent, csrf } = await browser(app)
    await agent
      .post('/api/auth/password-reset/request')
      .set(CSRF_HEADER, csrf)
      .send({ email: OWNER })
    await vi.waitFor(() => expect(relay.messages).toHaveLength(1))
    // The credentials epoch has the resolution of a millisecond; a person does not sign in
    // and reset a password in the same one.
    await new Promise((resolve) => setTimeout(resolve, 5))

    await agent
      .post('/api/auth/password-reset/confirm')
      .set(CSRF_HEADER, csrf)
      .send({ token: tokenIn(relay), password: NEW_PASSWORD })
      .expect(204)

    expect((await elsewhere.agent.get('/api/auth/me')).body.authenticated).toBe(false)
  })

  it('keeps a session opened after the reset', async () => {
    const { app, relay } = await bootWithRelay()
    const { agent, csrf } = await browser(app)
    await agent
      .post('/api/auth/password-reset/request')
      .set(CSRF_HEADER, csrf)
      .send({ email: OWNER })
    await vi.waitFor(() => expect(relay.messages).toHaveLength(1))
    await agent
      .post('/api/auth/password-reset/confirm')
      .set(CSRF_HEADER, csrf)
      .send({ token: tokenIn(relay), password: NEW_PASSWORD })
      .expect(204)
    await new Promise((resolve) => setTimeout(resolve, 5))

    const fresh = await login(app, NEW_PASSWORD)

    expect((await fresh.agent.get('/api/auth/me')).body.authenticated).toBe(true)
  })

  it('writes the token nowhere in the database: only its digest is stored', async () => {
    const { app, relay, db } = await bootWithRelay()
    const { agent, csrf } = await browser(app)
    await agent
      .post('/api/auth/password-reset/request')
      .set(CSRF_HEADER, csrf)
      .send({ email: OWNER })
    await vi.waitFor(() => expect(relay.messages).toHaveLength(1))
    const token = tokenIn(relay)
    await agent
      .post('/api/auth/password-reset/confirm')
      .set(CSRF_HEADER, csrf)
      .send({ token, password: NEW_PASSWORD })
      .expect(204)

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
      name: string
    }[]
    for (const { name } of tables) {
      const dump = JSON.stringify(db.prepare(`SELECT * FROM "${name}"`).all())
      expect(dump, `table ${name}`).not.toContain(token)
      expect(dump, `table ${name}`).not.toContain(NEW_PASSWORD)
    }
  })
})

/**
 * The credentials epoch through the real stack (roadmap §10.3; free plan G2-08, paid plan
 * P3-09): the SQLite session store, the SQLite user repository and the real hasher.
 *
 * `sessions` has no `user_id`, so "sign out everywhere" is only true if three things the
 * fakes can each pretend are really so together: the account row carries the epoch, the
 * session carries the instant it was issued, and the store really replaces a session when
 * the route regenerates it. This is the one test that boots all of it.
 */
describe('createContainer: sign out everywhere', () => {
  const OWNER = 'hote@example.org'
  const PASSWORD = 'un-mot-de-passe-solide'
  const NEW_PASSWORD = 'une-phrase-de-passe-neuve'

  const bootOwner = async () => {
    const booted = await boot({
      BOOTSTRAP_OWNER_EMAIL: OWNER,
      BOOTSTRAP_OWNER_PASSWORD: PASSWORD,
    })
    // The first owner is created with a password they must change before anything else
    // (P3-03), and every route but three refuses them until they do. Which of those rules
    // holds is not this describe's subject, so the flag is cleared where a person would have
    // cleared it.
    booted.db.prepare('UPDATE users SET must_change_password = 0').run()
    return booted
  }

  /** A browser: it holds the CSRF cookie and the session cookie, and echoes the former. */
  const device = async (app: Container['app']) => {
    const agent = request.agent(app)
    const first = await agent.get('/api/auth/me')
    const cookie = (first.headers['set-cookie'] as unknown as string[] | undefined)?.find((c) =>
      c.startsWith(`${CSRF_COOKIE}=`),
    )
    const csrf = cookie?.slice(CSRF_COOKIE.length + 1).split(';')[0] ?? ''
    const login = await agent
      .post('/api/auth/login')
      .set(CSRF_HEADER, csrf)
      .send({ email: OWNER, password: PASSWORD })
    expect(login.status).toBe(200)
    const rotated = (login.headers['set-cookie'] as unknown as string[] | undefined)?.find((c) =>
      c.startsWith(`${CSRF_COOKIE}=`),
    )
    return { agent, csrf: rotated?.slice(CSRF_COOKIE.length + 1).split(';')[0] ?? csrf }
  }

  const isSignedIn = async (agent: ReturnType<typeof request.agent>): Promise<boolean> =>
    (await agent.get('/api/auth/me')).body.authenticated === true

  /** The epoch has the resolution of a millisecond; a person does not do two things in one. */
  const aMomentLater = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5))

  it('signs the other device out and keeps this one', async () => {
    const { app } = await bootOwner()
    const phone = await device(app)
    const laptop = await device(app)
    await aMomentLater()

    await laptop.agent
      .post('/api/auth/sessions/revoke-others')
      .set(CSRF_HEADER, laptop.csrf)
      .expect(204)

    expect(await isSignedIn(phone.agent)).toBe(false)
    expect(await isSignedIn(laptop.agent)).toBe(true)
  })

  it('signs the other device out when a password is changed, and keeps the one that changed it', async () => {
    const { app } = await bootOwner()
    const phone = await device(app)
    const laptop = await device(app)
    await aMomentLater()

    await laptop.agent
      .post('/api/auth/password')
      .set(CSRF_HEADER, laptop.csrf)
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
      .expect(204)

    expect(await isSignedIn(phone.agent)).toBe(false)
    expect(await isSignedIn(laptop.agent)).toBe(true)
  })

  it('lets the same device sign in again after being signed out', async () => {
    const { app } = await bootOwner()
    const phone = await device(app)
    const laptop = await device(app)
    await aMomentLater()
    await laptop.agent
      .post('/api/auth/sessions/revoke-others')
      .set(CSRF_HEADER, laptop.csrf)
      .expect(204)
    await aMomentLater()

    const again = await phone.agent
      .post('/api/auth/login')
      .set(CSRF_HEADER, phone.csrf)
      .send({ email: OWNER, password: PASSWORD })

    expect(again.status).toBe(200)
    expect(await isSignedIn(phone.agent)).toBe(true)
  })

  it('stores the epoch on the account row, once, and no session row carries a user id', async () => {
    const booted = await bootOwner()
    const laptop = await device(booted.app)
    await aMomentLater()
    await laptop.agent
      .post('/api/auth/sessions/revoke-others')
      .set(CSRF_HEADER, laptop.csrf)
      .expect(204)

    const account = booted.db
      .prepare('SELECT credentials_changed_at FROM users WHERE email = ?')
      .get(OWNER) as { credentials_changed_at: string | null }
    const sessionColumns = (
      booted.db.prepare('PRAGMA table_info(sessions)').all() as { name: string }[]
    ).map((column) => column.name)

    expect(account.credentials_changed_at).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/)
    expect(sessionColumns).not.toContain('user_id')
  })
})

/**
 * The operator's second factor through the real stack (roadmap §10.1; free plan G2-13, paid plan
 * P3-15): the SQLite repositories and session store, the real bcrypt hasher, the real AES-256-GCM
 * vault and the real HMAC engine, on a box configured the way the hosted instance is.
 *
 * The fakes can each pretend the parts agree: that the vault's text is what the table's `CHECK`
 * accepts, that the repository's conditional `UPDATE` really spends a step, that a session from the
 * SQLite store really carries the stamp the gate reads. This is the one place all of that is
 * asked of the real thing together.
 *
 * It uses the real clock, so it cannot wait thirty seconds between uses of a code. It does not
 * need to: the window accepts the step either side of now, and a code is only refused for a step
 * not later than the last one spent, so it spends different steps in a row.
 */
describe('createContainer: the operator’s second factor', () => {
  const OWNER = 'operateur@example.org'
  const PASSWORD = 'un-mot-de-passe-solide'
  const KEY = Buffer.alloc(32, 11)

  const hostedBox = (extra: Record<string, string> = {}): Record<string, string> => ({
    SITE_ADMIN: 'on',
    REQUIRE_OPERATOR_2FA: 'true',
    MFA_ENCRYPTION_KEY: KEY.toString('base64'),
    BOOTSTRAP_OWNER_EMAIL: OWNER,
    BOOTSTRAP_OWNER_PASSWORD: PASSWORD,
    ...extra,
  })

  /**
   * A bootstrapped owner is created with a provisional password, and the server refuses everything
   * but choosing a new one until it is. That is not what is under test here, so the flag is
   * cleared the way a person clearing it would have left the row.
   */
  const bootHosted = async (extra: Record<string, string> = {}): Promise<Container> => {
    const booted = await boot(hostedBox(extra))
    booted.db.prepare('UPDATE users SET must_change_password = 0').run()
    return booted
  }

  const browser = async (app: Container['app']) => {
    const agent = request.agent(app)
    const first = await agent.get('/api/auth/me')
    const cookie = (first.headers['set-cookie'] as unknown as string[] | undefined)?.find((c) =>
      c.startsWith(`${CSRF_COOKIE}=`),
    )
    let csrf = decodeURIComponent(cookie?.slice(CSRF_COOKIE.length + 1).split(';')[0] ?? '')
    const post = async (path: string, body: object = {}) => {
      const response = await agent.post(path).set(CSRF_HEADER, csrf).send(body)
      const rotated = (response.headers['set-cookie'] as unknown as string[] | undefined)?.find(
        (c) => c.startsWith(`${CSRF_COOKIE}=`),
      )
      if (rotated !== undefined) {
        csrf = decodeURIComponent(rotated.slice(CSRF_COOKIE.length + 1).split(';')[0] ?? '')
      }
      return response
    }
    return {
      agent,
      post,
      signIn: () => post('/api/auth/login', { email: OWNER, password: PASSWORD }),
    }
  }

  /** The code the app would show `offset` steps from now, from the real clock. */
  const codeFor = (secret: Uint8Array, offset: number): string =>
    nodeTotpEngine.codeAt(secret, totpStepAt(new Date()) + offset)

  const enrol = async (app: Container['app']) => {
    const operator = await browser(app)
    await operator.signIn()
    const started = await operator.post('/api/auth/2fa/enroll', { password: PASSWORD })
    expect(started.status, JSON.stringify(started.body)).toBe(200)
    const secret = decodeBase32(started.body.secret as string) ?? new Uint8Array()
    const confirmed = await operator.post('/api/auth/2fa/confirm', { code: codeFor(secret, 0) })
    return { operator, secret, started, recoveryCodes: confirmed.body.recoveryCodes as string[] }
  }

  it('closes /api/site to a session that has not passed it, and opens it to one that has', async () => {
    const { app } = await bootHosted()
    const operator = await browser(app)
    await operator.signIn()
    const before = await operator.agent.get(NEVER_A_SITE_ROUTE)

    const started = await operator.post('/api/auth/2fa/enroll', { password: PASSWORD })
    const secret = decodeBase32(started.body.secret as string) ?? new Uint8Array()
    await operator.post('/api/auth/2fa/confirm', { code: codeFor(secret, 0) })
    const after = await operator.agent.get(NEVER_A_SITE_ROUTE)

    expect([before.status, before.body.error.code]).toEqual([403, 'auth.secondFactorRequired'])
    expect([after.status, after.body.error.code]).toEqual([404, 'route.notFound'])
  })

  it('asks an enrolled operator for a code, and starts no session until it comes', async () => {
    const { app } = await bootHosted()
    const { secret } = await enrol(app)
    const returning = await browser(app)

    const challenge = await returning.signIn()
    const midway = await returning.agent.get(NEVER_A_SITE_ROUTE)
    const finished = await returning.post('/api/auth/login/2fa', { code: codeFor(secret, 1) })
    const inside = await returning.agent.get(NEVER_A_SITE_ROUTE)

    expect(challenge.body).toEqual({ secondFactorRequired: true })
    expect(midway.status).toBe(401)
    expect(finished.status).toBe(200)
    expect(inside.status).toBe(404)
  })

  it('refuses a code that has been used, on a fresh sign-in', async () => {
    const { app } = await bootHosted()
    const { secret } = await enrol(app)
    const code = codeFor(secret, 1)
    const first = await browser(app)
    await first.signIn()
    await first.post('/api/auth/login/2fa', { code })

    const replayer = await browser(app)
    await replayer.signIn()
    const replay = await replayer.post('/api/auth/login/2fa', { code })

    expect(replay.status).toBe(401)
    expect(replay.body.error.code).toBe('auth.invalidSecondFactor')
  })

  it('lets a recovery code in once, and only once', async () => {
    const { app } = await bootHosted()
    const { recoveryCodes } = await enrol(app)
    const first = await browser(app)
    await first.signIn()
    const used = await first.post('/api/auth/login/2fa', { recoveryCode: recoveryCodes[0] })
    const second = await browser(app)
    await second.signIn()

    const again = await second.post('/api/auth/login/2fa', { recoveryCode: recoveryCodes[0] })

    expect(used.status).toBe(200)
    expect(again.status).toBe(401)
  })

  it('keeps the factor working when SESSION_SECRET is rotated: the key is its own', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'eventslide-rotation-'))
    const bootAt = async (sessionSecret: string): Promise<Container> =>
      createContainer(
        loadConfig({
          NODE_ENV: 'test',
          LOG_LEVEL: 'fatal',
          DATABASE_PATH: join(dir, 'eventslide.sqlite'),
          MEDIA_ROOT: join(dir, 'media'),
          FFMPEG_PATH: join(dir, 'no-ffmpeg-here'),
          FFPROBE_PATH: join(dir, 'no-ffprobe-here'),
          SESSION_SECRET: sessionSecret,
          ...hostedBox(),
        }),
      )
    try {
      const before = await bootAt('a'.repeat(40))
      before.db.prepare('UPDATE users SET must_change_password = 0').run()
      const { secret } = await enrol(before.app)
      await before.dispose()

      const after = await bootAt('b'.repeat(40))
      container = after
      const returning = await browser(after.app)
      await returning.signIn()
      const finished = await returning.post('/api/auth/login/2fa', { code: codeFor(secret, 1) })

      expect(finished.status).toBe(200)
    } finally {
      await container?.dispose()
      container = null
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('writes no secret, code, recovery code or key into any table: the secret is encrypted and the codes are digests', async () => {
    const { app, db } = await bootHosted()
    const { secret, started, recoveryCodes } = await enrol(app)

    const stored = db.prepare('SELECT secret_enc FROM user_totp').get() as { secret_enc: string }
    expect(stored.secret_enc.split('.')).toHaveLength(3)

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
      name: string
    }[]
    const planted = [
      started.body.secret as string,
      started.body.otpauthUri as string,
      Buffer.from(secret).toString('hex'),
      KEY.toString('base64'),
      KEY.toString('hex'),
      ...recoveryCodes,
      ...recoveryCodes.map((code) => code.replaceAll('-', '')),
    ]
    for (const { name } of tables) {
      const dump = JSON.stringify(db.prepare(`SELECT * FROM "${name}"`).all())
      for (const value of planted) expect(dump, `table ${name}`).not.toContain(value)
    }
  })

  it('audits the enrolment and the use of a recovery code, in the real log', async () => {
    const { app, db } = await bootHosted()
    const { recoveryCodes } = await enrol(app)
    const returning = await browser(app)
    await returning.signIn()
    await returning.post('/api/auth/login/2fa', { recoveryCode: recoveryCodes[0] })

    const actions = db.prepare('SELECT action FROM audit_log ORDER BY seq').all() as {
      action: string
    }[]

    expect(actions.map((row) => row.action)).toEqual([
      'account.secondFactorEnrolled',
      'account.recoveryCodeUsed',
    ])
  })
})
