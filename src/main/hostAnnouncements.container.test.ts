import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AT, aClient, aUser } from '../application/testing/builders'
import { FakeClock } from '../application/testing/fakeClock'
import { asClientId, asUserId } from '../domain/shared/ids'
import { loadConfig } from '../infrastructure/config/env'
import { SqliteClientRepository } from '../infrastructure/db/sqliteClientRepository'
import { SqliteUserRepository } from '../infrastructure/db/sqliteUserRepository'
import { parseMessage, startSmtpSink, type SmtpSink } from '../infrastructure/mail/testing/smtpSink'
import { createContainer, type Container } from './container'

/**
 * **The announcements to the hosts, through the real composition root** (spec 32, lot 2, A8): the real use cases, the SQLite
 * adapters, an SMTP relay in this process and a clock the test sets. What a unit test cannot say, and this one does: that the
 * box starts the first batch when an announcement is written, that the retention sweep resumes it, that a daily ceiling spreads
 * it over days and never writes to an account twice, that `HOST_MAIL_NOTICES=off` does not stop it, and what the retention
 * erases and when.
 */

const OPERATOR = 'operateur@example.org'
const PASSWORD = 'un-mot-de-passe-solide'
const CLIENT = asClientId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
const OTHER = asClientId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
const HOSTS = ['hote-un@example.test', 'hote-deux@example.test', 'hote-trois@example.test']

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

const boot = async (extra: Record<string, string> = {}) => {
  const clock = new FakeClock(new Date('2026-11-28T03:00:00.000Z'))
  relay = await startSmtpSink()
  workDir = await mkdtemp(join(tmpdir(), 'eventslide-host-announcements-'))
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
      OPERATOR_NAME: 'Association Les Photographes',
      OPERATOR_CONTACT_EMAIL: 'contact@photos.example.org',
      SUPPORT_URL: '/legal/avant-evenement',
      BOOTSTRAP_OWNER_EMAIL: OPERATOR,
      BOOTSTRAP_OWNER_PASSWORD: PASSWORD,
      ...extra,
    }),
    { clock },
  )
  container = booted
  booted.db.prepare('UPDATE users SET must_change_password = 0').run()
  const operatorId = asUserId(
    booted.db
      .prepare<[string], { readonly id: string }>('SELECT id FROM users WHERE email = ?')
      .get(OPERATOR)?.id ?? '',
  )
  // Three hosts: two own the first client, one the second; the operator owns none, and a member owns nothing.
  const users = new SqliteUserRepository(booted.db)
  const clients = new SqliteClientRepository(booted.db)
  await clients.save(aClient({ id: CLIENT, name: 'Atelier Un' }))
  await clients.save(aClient({ id: OTHER, name: 'Atelier Deux' }))
  const ids = [
    '21111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '23333333-3333-4333-8333-333333333333',
  ]
  for (const [index, email] of HOSTS.entries()) {
    const id = asUserId(ids[index] ?? '')
    await users.save(aUser({ id, email }))
    await clients.grantMember({
      clientId: index === 2 ? OTHER : CLIENT,
      userId: id,
      role: 'owner',
      grantedAt: AT,
    })
  }
  const memberId = asUserId('24444444-4444-4444-8444-444444444444')
  await users.save(aUser({ id: memberId, email: 'membre@example.test' }))
  await clients.grantMember({ clientId: CLIENT, userId: memberId, role: 'member', grantedAt: AT })
  return { booted, clock, operatorId, ids }
}

const received = () =>
  (relay?.messages ?? []).map((message) => ({
    to: message.envelopeTo[0] ?? '',
    raw: message.raw,
    subject: parseMessage(message.raw).subject ?? '',
    text: parseMessage(message.raw).text ?? '',
  }))

const WORDS = {
  subject: 'Nouvelles conditions d’utilisation',
  text: 'Elles changent le 1er janvier.',
  link: 'https://eventslide.fr/legal/cgu',
}

describe('createContainer: the announcements to the hosts (spec 32, A8)', () => {
  it('writes the announcement, starts its first batch, and writes once to each owner of a client, never to a member or the operator', async () => {
    const { booted, operatorId } = await boot()

    const sent = await booted.usecases.sendHostAnnouncement({ ...WORDS, operatorId })
    expect(sent.ok && sent.value.recipients).toBe(3)
    await booted.usecases.sweepHostAnnouncements()

    const mails = received()
    expect(mails.map((mail) => mail.to).sort()).toEqual([...HOSTS].sort())
    expect(mails[0]?.subject).toBe(WORDS.subject)
    expect(mails[0]?.text).toContain(WORDS.text)
    expect(mails[0]?.text).toContain(WORDS.link)
    expect(mails[0]?.raw).toMatch(/^Reply-To: .*contact@photos\.example\.org/im)
    for (const mail of mails) expect(mail.text).not.toMatch(/example\.test/)
    const listed = await booted.usecases.listHostAnnouncements()
    expect(listed.items[0]).toMatchObject({
      delivered: 3,
      announcement: { finishedAt: expect.any(Date) },
    })
  })

  it('writes nothing more on the next passes: it is finished', async () => {
    const { booted, operatorId } = await boot()
    await booted.usecases.sendHostAnnouncement({ ...WORDS, operatorId })
    await booted.usecases.sweepHostAnnouncements()

    expect(await booted.usecases.sweepHostAnnouncements()).toMatchObject({ sent: 0, finished: 0 })
    expect(received()).toHaveLength(3)
  })

  it('goes on across days under a daily ceiling of two, and writes to nobody twice', async () => {
    const { booted, clock, operatorId } = await boot({ MAIL_FOLLOWUP_MAX_PER_DAY: '2' })
    await booted.usecases.sendHostAnnouncement({ ...WORDS, operatorId })

    // The first batch was kicked by the send itself: this call joins it, and the day is full after two mails.
    const first = await booted.usecases.sweepHostAnnouncements()
    expect(first).toMatchObject({ heldByBudget: true, finished: 0 })
    expect(received()).toHaveLength(2)

    clock.set(new Date('2026-11-29T03:00:00.000Z'))
    const second = await booted.usecases.sweepHostAnnouncements()
    expect(second).toMatchObject({ sent: 1, finished: 1 })

    expect(
      received()
        .map((mail) => mail.to)
        .sort(),
    ).toEqual([...HOSTS].sort())
  })

  it('is not stopped by HOST_MAIL_NOTICES=off: the operator’s own words are not a family the host switches', async () => {
    const { booted, operatorId } = await boot({ HOST_MAIL_NOTICES: 'off' })

    await booted.usecases.sendHostAnnouncement({ ...WORDS, operatorId })
    await booted.usecases.sweepHostAnnouncements()

    expect(received()).toHaveLength(3)
  })

  it('does not write to an owner whose account is switched off', async () => {
    const { booted, operatorId, ids } = await boot()
    booted.db
      .prepare(`UPDATE users SET disabled_at = ? WHERE id = ?`)
      .run('2026-11-27T10:00:00.000Z', ids[1])

    await booted.usecases.sendHostAnnouncement({ ...WORDS, operatorId })
    await booted.usecases.sweepHostAnnouncements()

    expect(
      received()
        .map((mail) => mail.to)
        .sort(),
    ).toEqual([HOSTS[0], HOSTS[2]].sort())
  })

  it('erases the record of who was reached 30 days after the end, and the text after 365 days, through the retention step', async () => {
    const { booted, clock, operatorId } = await boot()
    const sent = await booted.usecases.sendHostAnnouncement({ ...WORDS, operatorId })
    await booted.usecases.sweepHostAnnouncements()
    const count = (table: string): number =>
      (booted.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
    expect(count('host_announcement_deliveries')).toBe(3)

    clock.set(new Date('2026-12-30T03:00:00.000Z'))
    expect(await booted.usecases.pruneHostAnnouncements()).toEqual({
      deliveries: 3,
      announcements: 0,
    })
    expect(count('host_announcement_deliveries')).toBe(0)
    expect(count('host_announcements')).toBe(1)

    clock.set(new Date('2027-12-01T03:00:00.000Z'))
    expect(await booted.usecases.pruneHostAnnouncements()).toEqual({
      deliveries: 0,
      announcements: 1,
    })
    expect(sent.ok).toBe(true)
  })

  it('refuses on a box that cannot mail, and writes nothing', async () => {
    workDir = await mkdtemp(join(tmpdir(), 'eventslide-host-announcements-'))
    container = await createContainer(
      loadConfig({
        NODE_ENV: 'test',
        LOG_LEVEL: 'fatal',
        DATABASE_PATH: join(workDir, 'eventslide.sqlite'),
        MEDIA_ROOT: join(workDir, 'media'),
        FFMPEG_PATH: join(workDir, 'no-ffmpeg-here'),
        FFPROBE_PATH: join(workDir, 'no-ffprobe-here'),
        BOOTSTRAP_OWNER_EMAIL: OPERATOR,
        BOOTSTRAP_OWNER_PASSWORD: PASSWORD,
      }),
    )
    const operatorId = asUserId(
      container.db
        .prepare<[string], { readonly id: string }>('SELECT id FROM users WHERE email = ?')
        .get(OPERATOR)?.id ?? '',
    )

    const result = await container.usecases.sendHostAnnouncement({ ...WORDS, operatorId })

    expect(!result.ok && result.error.code).toBe('hostAnnouncement.mailerRequired')
    expect((await container.usecases.listHostAnnouncements()).items).toEqual([])
  })
})
