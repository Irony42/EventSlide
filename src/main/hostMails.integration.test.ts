import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FakeClock } from '../application/testing/fakeClock'
import { makeSweepRsvpDigests } from '../application/usecases/notices/sweepRsvpDigests'
import { makeSweepRsvpNotices } from '../application/usecases/notices/sweepRsvpNotices'
import { asUserId } from '../domain/shared/ids'
import { loadConfig } from '../infrastructure/config/env'
import { SqliteClientRepository } from '../infrastructure/db/sqliteClientRepository'
import { SqliteEventMailNoticeLedger } from '../infrastructure/db/sqliteEventMailNoticeLedger'
import { SqliteEventRepository } from '../infrastructure/db/sqliteEventRepository'
import { SqliteGuestHouseholdRepository } from '../infrastructure/db/sqliteGuestHouseholdRepository'
import { SqliteGuestInviteRepository } from '../infrastructure/db/sqliteGuestInviteRepository'
import { SqliteGuestRsvpRepository } from '../infrastructure/db/sqliteGuestRsvpRepository'
import { SqliteGuestbookRepository } from '../infrastructure/db/sqliteGuestbookRepository'
import { SqliteMailBudget } from '../infrastructure/db/sqliteMailBudget'
import { SqliteMailPreferenceRepository } from '../infrastructure/db/sqliteMailPreferenceRepository'
import { SqliteMembershipRepository } from '../infrastructure/db/sqliteMembershipRepository'
import { parseMessage, startSmtpSink, type SmtpSink } from '../infrastructure/mail/testing/smtpSink'
import { CSRF_COOKIE, CSRF_HEADER } from '../interface/http/middleware/csrf'
import request from '../interface/http/testing/request'
import { createContainer, type Container } from './container'

/**
 * **The host's mails of the replies, end to end through the real adapters** (spec 32, R1, R2): the real container, the real
 * SQLite adapters, a real SMTP relay in this process, and the two sweeps run by hand under a **clock the test sets**, which the
 * browser suite cannot do (the sweeps keep to 08:00 to 21:00 in the invitation's zone and to dates weeks away).
 *
 * What it says: an owner who ticked the daily summary gets it, with figures and **no word a guest wrote**; an owner who switched
 * the replies family off gets nothing of the follow-up, **and still the warning before the replies are erased**; that warning is
 * sent once per level and names the date.
 */

const OWNER = 'hote@example.org'
const PASSWORD = 'un-mot-de-passe-solide'
const SLUG = 'fete-de-lea'
const BASE = `/api/events/${SLUG}`
const PARTY = {
  title: 'Léa fête ses 40 ans',
  startsAt: '2099-12-13T18:00:00Z',
  timeZone: 'Europe/Paris',
}
const REPLY = {
  name: 'Léa Martin',
  answer: 'yes',
  adults: 2,
  kids: 1,
  diet: 'sans gluten',
  message: 'Un secret de Léa',
}

let workDir: string | null = null
let container: Container | null = null
let relay: SmtpSink | null = null

afterEach(async () => {
  await container?.dispose()
  await relay?.close()
  container = null
  relay = null
  if (workDir !== null) await rm(workDir, { recursive: true, force: true, maxRetries: 5 })
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
  relay = await startSmtpSink()
  workDir = await mkdtemp(join(tmpdir(), 'eventslide-host-mails-'))
  const booted = await createContainer(
    loadConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'fatal',
      DATABASE_PATH: join(workDir, 'eventslide.sqlite'),
      MEDIA_ROOT: join(workDir, 'media'),
      FFMPEG_PATH: join(workDir, 'no-ffmpeg-here'),
      FFPROBE_PATH: join(workDir, 'no-ffprobe-here'),
      SMTP_URL: `smtp://127.0.0.1:${relay.port}`,
      MAIL_FROM: 'no-reply@photos.example.org',
      PUBLIC_URL: 'https://photos.example.org',
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
  const put = async (path: string, body: unknown) =>
    agent
      .put(path)
      .set(CSRF_HEADER, csrf)
      .send(body as object)
  const post = async (path: string, body: unknown) =>
    agent
      .post(path)
      .set(CSRF_HEADER, csrf)
      .send(body as object)

  expect((await put(`${BASE}/guest-invite`, PARTY)).status).toBe(200)
  const enabled = await post(`${BASE}/guest-invite/enable`, {})
  expect(enabled.status).toBe(200)
  const inviteToken = (enabled.body.guestInvite.url as string).split('/i/')[1] ?? ''
  expect((await put(`${BASE}/rsvp-form`, { enabled: true })).status).toBe(200)

  // A guest's own reply, through the public route: the host's own entries are marked as seen by the host.
  const guestReplies = async () => {
    const guest = request.agent(booted.app)
    const guestCsrf = csrfOf((await guest.get('/api/auth/me')).headers) ?? ''
    const sent = await guest
      .post(`/api/i/${inviteToken}/rsvp`)
      .set(CSRF_HEADER, guestCsrf)
      .send(REPLY)
    return sent.status
  }

  return { booted, put, post, guestReplies, db: booted.db, eventId: created.value.id }
}

/** The two sweeps over the real adapters, run at the instant `clock` says. */
const sweepsAt = (booted: Container, clock: FakeClock) => {
  const db = booted.db
  const events = new SqliteEventRepository(db)
  const clients = new SqliteClientRepository(db)
  const invites = new SqliteGuestInviteRepository(db)
  const rsvps = new SqliteGuestRsvpRepository(db)
  const households = new SqliteGuestHouseholdRepository(db)
  const memberships = new SqliteMembershipRepository(db)
  const budget = new SqliteMailBudget(db, null)
  const common = {
    mailer: booted.mailer,
    clock,
    logger: booted.logger,
    publicUrl: 'https://photos.example.org',
    hostMailNotices: true,
  }
  return {
    digests: makeSweepRsvpDigests({
      rsvps,
      households,
      guestbook: new SqliteGuestbookRepository(db),
      events,
      clients,
      invites,
      memberships,
      preferences: new SqliteMailPreferenceRepository(db),
      budget,
      ...common,
    }),
    notices: makeSweepRsvpNotices({
      events,
      clients,
      invites,
      rsvps,
      households,
      memberships,
      notices: new SqliteEventMailNoticeLedger(db),
      budget,
      capNoticeDays: 30,
      ...common,
    }),
  }
}

const received = () =>
  (relay?.messages ?? []).map((message) => ({
    to: message.envelopeTo,
    subject: parseMessage(message.raw).subject ?? '',
    text: parseMessage(message.raw).text ?? '',
  }))

describe('the host mails of the replies, through the real adapters', () => {
  it('writes the daily summary to the owner who ticked it, with figures and no word of a guest, once a day', async () => {
    const { booted, put, guestReplies } = await boot()
    expect((await put(`${BASE}/rsvp-digest`, { on: true })).status).toBe(204)
    expect(await guestReplies()).toBe(201)
    // 10:00 in Paris the next day: after the reply, inside the hours a mail may leave.
    const clock = new FakeClock(new Date(Date.now() + 24 * 3_600_000))
    clock.set(new Date(`${clock.now().toISOString().slice(0, 10)}T09:00:00.000Z`))
    const sweeps = sweepsAt(booted, clock)

    const report = await sweeps.digests()

    expect(report).toMatchObject({ claimed: 1, sent: 1, failed: [] })
    const mails = received()
    expect(mails).toHaveLength(1)
    expect(mails[0]?.to).toEqual([OWNER])
    expect(mails[0]?.text).toContain('https://photos.example.org/admin/events/fete-de-lea/rsvps')
    for (const word of ['Martin', 'Léa Martin', 'gluten', 'secret']) {
      expect(mails[0]?.text, word).not.toContain(word)
      expect(mails[0]?.subject, word).not.toContain(word)
    }

    clock.advance(3_600_000)
    expect(await sweeps.digests()).toMatchObject({ claimed: 0, sent: 0 })
    expect(received()).toHaveLength(1)
  })

  it('writes nothing of the follow-up once the owner switched the replies family off, and the warning before the erasure all the same', async () => {
    const { booted, put, guestReplies } = await boot()
    expect((await put(`${BASE}/rsvp-digest`, { on: true })).status).toBe(204)
    expect((await put('/api/me/mail-preferences', { rsvp: false })).status).toBe(204)
    expect(await guestReplies()).toBe(201)
    const tomorrow = new Date(Date.now() + 24 * 3_600_000)
    const clock = new FakeClock(new Date(`${tomorrow.toISOString().slice(0, 10)}T09:00:00.000Z`))
    const sweeps = sweepsAt(booted, clock)

    expect(await sweeps.digests()).toMatchObject({ claimed: 0, sent: 0 })
    expect(received()).toEqual([])

    // The replies end 60 days after the party starts (2099-12-13): seven days before, at 13:00 in Paris.
    clock.set(new Date('2100-02-05T12:00:00.000Z'))
    const report = await sweeps.notices()

    expect(report.noticed).toHaveLength(1)
    const mails = received()
    expect(mails).toHaveLength(1)
    expect(mails[0]?.to).toEqual([OWNER])
    expect(mails[0]?.text).toContain('2100')
    expect(mails[0]?.text).toContain('https://photos.example.org/admin/events/fete-de-lea/rsvps')
    for (const word of ['Martin', 'Léa Martin', 'gluten', 'secret']) {
      expect(mails[0]?.text, word).not.toContain(word)
    }
  })

  it('sends the warning once per level: the same day again sends nothing, the last day sends the second', async () => {
    const { booted, guestReplies } = await boot()
    expect(await guestReplies()).toBe(201)
    const clock = new FakeClock(new Date('2100-02-05T12:00:00.000Z'))
    const sweeps = sweepsAt(booted, clock)

    await sweeps.notices()
    clock.advance(3_600_000)
    expect((await sweeps.notices()).noticed).toEqual([])
    expect(received()).toHaveLength(1)

    // 2100-02-11 18:00 UTC is the end: the day before, 19:00 UTC (20:00 in Paris).
    clock.set(new Date('2100-02-10T19:30:00.000Z'))
    expect((await sweeps.notices()).noticed).toHaveLength(1)
    expect(received()).toHaveLength(2)
  })

  it('sends nothing at night in the zone of the invitation, and notes nothing, so the next pass sends it', async () => {
    const { booted, guestReplies } = await boot()
    expect(await guestReplies()).toBe(201)
    // 23:30 in Paris.
    const clock = new FakeClock(new Date('2100-02-05T22:30:00.000Z'))
    const sweeps = sweepsAt(booted, clock)

    expect((await sweeps.notices()).noticed).toEqual([])
    expect(received()).toEqual([])

    clock.set(new Date('2100-02-06T08:00:00.000Z'))
    expect((await sweeps.notices()).noticed).toHaveLength(1)
  })
})
