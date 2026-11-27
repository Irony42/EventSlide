import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { aClient } from '../application/testing/builders'
import { asClientId, asUserId } from '../domain/shared/ids'
import { loadConfig } from '../infrastructure/config/env'
import { SqliteClientRepository } from '../infrastructure/db/sqliteClientRepository'
import { parseMessage, startSmtpSink, type SmtpSink } from '../infrastructure/mail/testing/smtpSink'
import { createContainer, type Container } from './container'

/**
 * **The mail about what the operator did, through the real composition root** (spec 32, A4): the real use cases, the SQLite
 * adapters and an SMTP relay in this process. What a unit test cannot say, and this one does: that the box gives each of the
 * operator's use cases the hook, that the notice goes to the right people with the operator's contact as the reply address, that
 * "do not tell the host" tells nobody, and that `HOST_MAIL_NOTICES=off` does not stop it.
 */

const OPERATOR_MAIL = 'operateur@example.org'
const OWNER = 'hote@example.test'
const PASSWORD = 'un-mot-de-passe-solide'
const CLIENT = asClientId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
const NBSP = String.fromCharCode(160)

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
  relay = await startSmtpSink()
  workDir = await mkdtemp(join(tmpdir(), 'eventslide-takedown-notice-'))
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
      OPERATOR_CONTACT_EMAIL: OPERATOR_MAIL,
      SUPPORT_URL: '/legal/avant-evenement',
      BOOTSTRAP_OWNER_EMAIL: OWNER,
      BOOTSTRAP_OWNER_PASSWORD: PASSWORD,
      ...extra,
    }),
  )
  container = booted
  booted.db.prepare('UPDATE users SET must_change_password = 0').run()
  const ownerId = asUserId(
    booted.db
      .prepare<[string], { readonly id: string }>('SELECT id FROM users WHERE email = ?')
      .get(OWNER)?.id ?? '',
  )
  const created = await booted.usecases.createEvent({
    ownerId,
    name: 'Mariage de Camille',
    slug: 'mariage-de-camille',
  })
  if (!created.ok) throw new Error(`fixture rejected: ${created.error.code}`)
  const clients = new SqliteClientRepository(booted.db)
  await clients.save(
    aClient({ id: CLIENT, name: 'Atelier Photo Camille', contactEmail: 'compta@example.test' }),
  )
  await clients.grantMember({
    clientId: CLIENT,
    userId: ownerId,
    role: 'owner',
    grantedAt: new Date(),
  })
  return {
    booted,
    eventId: created.value.id,
    ownerId,
    operator: { kind: 'operator', userId: ownerId } as const,
  }
}

const received = () =>
  (relay?.messages ?? []).map((message) => ({
    to: message.envelopeTo,
    raw: message.raw,
    subject: parseMessage(message.raw).subject ?? '',
    text: parseMessage(message.raw).text ?? '',
  }))

describe('createContainer: the notice of an operator act (spec 32, A4)', () => {
  it('tells the owners of an event that it was taken down, with the host reason, and the way to contest it by replying to the operator', async () => {
    const { booted, eventId, operator } = await boot()

    const result = await booted.usecases.setEventTakedown({
      eventId,
      down: true,
      reason: 'Signalement reçu',
      actor: operator,
      hostReason: 'Contenu contraire aux conditions d’utilisation.',
    })
    expect(result.ok).toBe(true)
    await booted.usecases.takedownNotice.idle()

    const mails = received()
    expect(mails).toHaveLength(1)
    expect(mails[0]?.to).toEqual([OWNER])
    expect(mails[0]?.subject).toBe(`L’évènement «${NBSP}Mariage de Camille${NBSP}» a été retiré`)
    expect(mails[0]?.text).toContain(
      `Motif${NBSP}: Contenu contraire aux conditions d’utilisation.`,
    )
    expect(mails[0]?.text).toContain('répondez à ce message')
    expect(mails[0]?.raw).toMatch(new RegExp(`^Reply-To: .*${OPERATOR_MAIL}`, 'im'))
    // The audit reason is the operator's, not the host's.
    expect(mails[0]?.text).not.toContain('Signalement reçu')
  })

  it('tells nobody when the operator left "Prévenir l\'hôte" unticked, and keeps the act', async () => {
    const { booted, eventId, operator } = await boot()

    const result = await booted.usecases.setEventTakedown({
      eventId,
      down: true,
      reason: 'Signalement reçu',
      actor: operator,
      notifyHost: false,
    })
    await booted.usecases.takedownNotice.idle()

    expect(result.ok).toBe(true)
    expect(received()).toEqual([])
    expect((await booted.usecases.getSiteEventState({ eventId })).ok).toBe(true)
  })

  it("tells a client's owners and its contact address, one mail each, when it is suspended, then that it is resumed", async () => {
    const { booted, operator } = await boot()

    expect((await booted.usecases.suspendClient({ clientId: CLIENT, actor: operator })).ok).toBe(
      true,
    )
    await booted.usecases.takedownNotice.idle()
    expect(
      received()
        .map((mail) => mail.to[0])
        .sort(),
    ).toEqual(['compta@example.test', OWNER])
    expect(received()[0]?.text).toContain('Atelier Photo Camille')

    expect((await booted.usecases.resumeClient({ clientId: CLIENT, actor: operator })).ok).toBe(
      true,
    )
    await booted.usecases.takedownNotice.idle()
    expect(received()).toHaveLength(4)
    expect(received().at(-1)?.text).toContain('a été levée')
  })

  it('tells that a space is closed and the day its albums go', async () => {
    const { booted, operator } = await boot()

    expect(
      (await booted.usecases.offboardClient({ clientId: CLIENT, actor: operator, graceDays: 30 }))
        .ok,
    ).toBe(true)
    await booted.usecases.takedownNotice.idle()

    expect(received().length).toBeGreaterThanOrEqual(2)
    expect(received()[0]?.text).toContain('Vos albums seront supprimés le')
  })

  it('is not stopped by HOST_MAIL_NOTICES=off: an act the host did not do is the one the box must say', async () => {
    const { booted, eventId, operator } = await boot({ HOST_MAIL_NOTICES: 'off' })

    await booted.usecases.setEventTakedown({
      eventId,
      down: true,
      reason: 'Signalement reçu',
      actor: operator,
    })
    await booted.usecases.takedownNotice.idle()

    expect(received()).toHaveLength(1)
  })

  it('refuses a reason for the host that is too long before it acts, and tells nobody', async () => {
    const { booted, eventId, operator } = await boot()

    const result = await booted.usecases.setEventTakedown({
      eventId,
      down: true,
      reason: 'Signalement reçu',
      actor: operator,
      hostReason: 'a'.repeat(501),
    })
    await booted.usecases.takedownNotice.idle()

    expect(!result.ok && result.error.code).toBe('takedown.hostReasonInvalid')
    expect(received()).toEqual([])
  })
})
