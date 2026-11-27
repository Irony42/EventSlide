import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FakeClock } from '../application/testing/fakeClock'
import { asUserId } from '../domain/shared/ids'
import { loadConfig } from '../infrastructure/config/env'
import { parseMessage, startSmtpSink, type SmtpSink } from '../infrastructure/mail/testing/smtpSink'
import { CSRF_COOKIE, CSRF_HEADER } from '../interface/http/middleware/csrf'
import request from '../interface/http/testing/request'
import { createContainer, type Container } from './container'

/**
 * **The host's mails of the replies, end to end through the real composition root** (spec 32, R1, R2): the real container with
 * the clock **the test sets** (`createContainer`'s test seam), the real SQLite adapters, a real SMTP relay in this process, and the
 * container's own `sweepRsvpNotices` and `sweepRsvpDigests`, the ones the retention timer calls. So the wiring the box actually
 * has (the daily ceiling, `HOST_MAIL_NOTICES`, the retention cap) is what is under test, which hand-built sweeps would not say.
 * The browser suite cannot do this: the sweeps keep to 08:00 to 21:00 in the invitation's zone and to dates weeks away.
 *
 * What it says: an owner who ticked the daily summary gets it, with figures and **no word a guest wrote**; the same scenario with
 * the replies family off gets nothing of the follow-up, **and still the warning before the replies are erased**; that warning is
 * sent once per level and names the date; `HOST_MAIL_NOTICES=off` stops the summary and not the warning; a daily ceiling of one
 * holds the summary back and never the warning.
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
/** What no mail may hold: nothing a guest wrote (the event's own name carries "Léa", so the surname and the rest). */
const GUEST_WORDS = ['Martin', 'gluten', 'secret']

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

const boot = async (env: Record<string, string> = {}) => {
  const clock = new FakeClock()
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
      ...env,
    }),
    { clock },
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

  return { booted, clock, put, guestReplies }
}

const received = () =>
  (relay?.messages ?? []).map((message) => ({
    to: message.envelopeTo,
    subject: parseMessage(message.raw).subject ?? '',
    text: parseMessage(message.raw).text ?? '',
  }))

/** 10:00 in Paris on the day after the reply: after it, inside the hours a mail may leave. */
const tomorrowMorning = (clock: FakeClock): Date => {
  const tomorrow = new Date(clock.now().getTime() + 24 * 3_600_000)
  return new Date(`${tomorrow.toISOString().slice(0, 10)}T09:00:00.000Z`)
}

/**
 * The one scenario the summary tests share, so that what differs between them is the switch and nothing else: the owner ticked
 * the summary, a guest replied, and it is the next morning in Paris.
 */
const summaryScenario = async (options: {
  readonly repliesFamilyOff: boolean
  env?: Record<string, string>
}) => {
  const world = await boot(options.env)
  expect((await world.put(`${BASE}/rsvp-digest`, { on: true })).status).toBe(204)
  if (options.repliesFamilyOff) {
    expect((await world.put('/api/me/mail-preferences', { rsvp: false })).status).toBe(204)
  }
  expect(await world.guestReplies()).toBe(201)
  world.clock.set(tomorrowMorning(world.clock))
  const report = await world.booted.usecases.sweepRsvpDigests()
  return { ...world, report }
}

describe('the host mails of the replies, through the real composition root', () => {
  it('writes the daily summary to the owner who ticked it, with figures and no word of a guest, once a day', async () => {
    const world = await summaryScenario({ repliesFamilyOff: false })

    expect(world.report).toMatchObject({ claimed: 1, sent: 1, failed: [] })
    const mails = received()
    expect(mails).toHaveLength(1)
    expect(mails[0]?.to).toEqual([OWNER])
    expect(mails[0]?.text).toContain('https://photos.example.org/admin/events/fete-de-lea/rsvps')
    for (const word of GUEST_WORDS) {
      expect(mails[0]?.text, word).not.toContain(word)
      expect(mails[0]?.subject, word).not.toContain(word)
    }

    world.clock.advance(3_600_000)
    expect(await world.booted.usecases.sweepRsvpDigests()).toMatchObject({ claimed: 0, sent: 0 })
    expect(received()).toHaveLength(1)
  })

  it('writes nothing of the follow-up when the same owner switched the replies family off: the switch is the only difference', async () => {
    const world = await summaryScenario({ repliesFamilyOff: true })

    expect(world.report).toMatchObject({ claimed: 0, sent: 0 })
    expect(received()).toEqual([])
  })

  it('still sends the warning before the erasure with the family off, once per level, and with no word of a guest', async () => {
    const { booted, clock, put, guestReplies } = await boot()
    expect((await put('/api/me/mail-preferences', { rsvp: false })).status).toBe(204)
    expect(await guestReplies()).toBe(201)

    // The replies end 60 days after the party starts (2099-12-13): seven days before, at 13:00 in Paris.
    clock.set(new Date('2100-02-05T12:00:00.000Z'))
    expect((await booted.usecases.sweepRsvpNotices()).noticed).toHaveLength(1)
    const mails = received()
    expect(mails).toHaveLength(1)
    expect(mails[0]?.to).toEqual([OWNER])
    expect(mails[0]?.text).toContain('11 février 2100')
    expect(mails[0]?.text).toContain('https://photos.example.org/admin/events/fete-de-lea/rsvps')
    for (const word of GUEST_WORDS) expect(mails[0]?.text, word).not.toContain(word)

    // The same day again: noted, nothing more. The day before the end (20:30 in Paris): the second level.
    clock.advance(3_600_000)
    expect((await booted.usecases.sweepRsvpNotices()).noticed).toEqual([])
    clock.set(new Date('2100-02-10T19:30:00.000Z'))
    expect((await booted.usecases.sweepRsvpNotices()).noticed).toHaveLength(1)
    expect(received()).toHaveLength(2)
  })

  it('sends nothing at night in the zone of the invitation, and notes nothing, so the next pass sends it', async () => {
    const { booted, clock, guestReplies } = await boot()
    expect(await guestReplies()).toBe(201)
    // 23:30 in Paris.
    clock.set(new Date('2100-02-05T22:30:00.000Z'))

    expect((await booted.usecases.sweepRsvpNotices()).noticed).toEqual([])
    expect(received()).toEqual([])

    clock.set(new Date('2100-02-06T08:00:00.000Z'))
    expect((await booted.usecases.sweepRsvpNotices()).noticed).toHaveLength(1)
  })

  it('with HOST_MAIL_NOTICES=off the summary is not sent, and the warning before the erasure still is', async () => {
    const off = await summaryScenario({
      repliesFamilyOff: false,
      env: { HOST_MAIL_NOTICES: 'off' },
    })
    expect(off.report).toMatchObject({ claimed: 0, sent: 0 })
    expect(received()).toEqual([])

    off.clock.set(new Date('2100-02-05T12:00:00.000Z'))
    expect((await off.booted.usecases.sweepRsvpNotices()).noticed).toHaveLength(1)
    expect(received()).toHaveLength(1)
  })

  it('with a daily ceiling of one mail the warning is counted and never refused, and holds the summary back', async () => {
    const world = await boot({ MAIL_FOLLOWUP_MAX_PER_DAY: '1' })
    expect((await world.put(`${BASE}/rsvp-digest`, { on: true })).status).toBe(204)
    expect(await world.guestReplies()).toBe(201)
    world.clock.set(new Date('2100-02-05T12:00:00.000Z'))

    expect((await world.booted.usecases.sweepRsvpNotices()).noticed).toHaveLength(1)
    const held = await world.booted.usecases.sweepRsvpDigests()

    expect(held).toMatchObject({ claimed: 0, sent: 0, skippedBudget: 1 })
    expect(received()).toHaveLength(1)

    // The next day the ceiling is new: the summary goes.
    world.clock.set(new Date('2100-02-06T09:00:00.000Z'))
    expect(await world.booted.usecases.sweepRsvpDigests()).toMatchObject({ claimed: 1, sent: 1 })
  })
})
