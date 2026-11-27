import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { requestBook, type BookOptions } from '../domain/book/albumBook'
import { asUserId } from '../domain/shared/ids'
import { loadConfig } from '../infrastructure/config/env'
import { SqliteAlbumBookRepository } from '../infrastructure/db/sqliteAlbumBookRepository'
import { parseMessage, startSmtpSink, type SmtpSink } from '../infrastructure/mail/testing/smtpSink'
import { createContainer, type Container } from './container'

/**
 * **The mails about the life of an event, through the real composition root** (spec 32, A2, A3, A5, A6): the real use
 * cases, the SQLite adapters and an SMTP relay in this process. What a unit test cannot say, and this one does: that the
 * box gives the worker the hook that tells the host a long job is over, that accepting an invitation tells the host who
 * wrote it, and that the retention sweep carries the notices of the life of an event.
 */

const OWNER = 'hote@example.test'
const MODERATOR = 'marie@example.test'
const PASSWORD = 'un-mot-de-passe-solide'
const NBSP = String.fromCharCode(160)

const OPTIONS: BookOptions = {
  title: 'Mariage de Camille',
  subtitle: '14 juin 2026',
  language: 'fr',
  style: 'classique',
  selection: { kind: 'all' },
  showAuthors: true,
  showCaptions: true,
  includeGuestbook: false,
  printVersion: false,
  timeZone: 'Europe/Paris',
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

const boot = async (extra: Record<string, string> = {}): Promise<Container> => {
  relay = await startSmtpSink()
  workDir = await mkdtemp(join(tmpdir(), 'eventslide-event-notices-'))
  container = await createContainer(
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
      ...extra,
    }),
  )
  container.db.prepare('UPDATE users SET must_change_password = 0').run()
  return container
}

const received = () =>
  (relay?.messages ?? []).map((message) => ({
    to: message.envelopeTo,
    subject: parseMessage(message.raw).subject ?? '',
    text: parseMessage(message.raw).text ?? '',
  }))

/** An event owned by the bootstrap account. */
const anEventOf = async (booted: Container) => {
  const ownerId = booted.db
    .prepare<[string], { readonly id: string }>('SELECT id FROM users WHERE email = ?')
    .get(OWNER)?.id
  if (ownerId === undefined) throw new Error('fixture: no owner')
  const created = await booted.usecases.createEvent({
    ownerId: asUserId(ownerId),
    name: 'Mariage de Camille',
    slug: 'mariage-de-camille',
  })
  if (!created.ok) throw new Error(`fixture rejected: ${created.error.code}`)
  return { eventId: created.value.id, ownerId: asUserId(ownerId) }
}

describe('createContainer: the notices of the life of an event (spec 32)', () => {
  it('tells the owners that a photo book that took long could not be made, once, with the page of the book (A2)', async () => {
    const booted = await boot()
    const { eventId } = await anEventOf(booted)
    // Asked ten minutes ago: an event with no photograph, so the worker fails it as empty.
    await new SqliteAlbumBookRepository(booted.db).saveRequest(
      requestBook(eventId, OPTIONS, new Date(Date.now() - 10 * 60_000)),
    )
    const worker = booted.albumBookWorker
    if (worker === null) throw new Error('fixture: the books are switched off')

    await worker.runOnce()
    await booted.usecases.jobNotice.idle()

    const mails = received()
    expect(mails).toHaveLength(1)
    expect(mails[0]?.to).toEqual([OWNER])
    expect(mails[0]?.subject).toBe(
      `Le livre photo de «${NBSP}Mariage de Camille${NBSP}» n’a pas pu être fait${NBSP}; réessayez depuis la page.`,
    )
    expect(mails[0]?.text).toContain(
      'https://photos.example.org/admin/events/mariage-de-camille/book',
    )
    expect(
      booted.db
        .prepare<[string], { readonly n: number }>(
          `SELECT COUNT(*) AS n FROM event_mail_notices WHERE event_id = ? AND kind = 'jobDone'`,
        )
        .get(eventId)?.n,
    ).toBe(1)
  })

  it('sends nothing for a book the host asked for a moment ago and watched fail', async () => {
    const booted = await boot()
    const { eventId } = await anEventOf(booted)
    await new SqliteAlbumBookRepository(booted.db).saveRequest(
      requestBook(eventId, OPTIONS, new Date()),
    )

    await booted.albumBookWorker?.runOnce()
    await booted.usecases.jobNotice.idle()

    expect(received()).toEqual([])
  })

  it('tells the host who wrote an invitation that it was accepted, by the name the new account gave (A6)', async () => {
    const booted = await boot()
    const { eventId, ownerId } = await anEventOf(booted)
    const invited = await booted.usecases.registerModerator({
      eventId,
      actorId: ownerId,
      email: MODERATOR,
      locale: 'fr',
    })
    expect(invited.ok).toBe(true)
    const token = /\/invite\/([A-Za-z0-9_-]+)/.exec(received()[0]?.text ?? '')?.[1]
    if (token === undefined) throw new Error('no invitation link was mailed')

    const accepted = await booted.usecases.acceptInvitation({
      token,
      credentials: { password: 'une-phrase-de-passe-neuve', displayName: 'Marie Dupont' },
    })
    expect(accepted.ok).toBe(true)
    await booted.usecases.invitationNotice.idle()

    const mails = received()
    expect(mails).toHaveLength(2)
    expect(mails[1]?.to).toEqual([OWNER])
    expect(mails[1]?.text).toContain(
      `Marie Dupont a accepté de modérer «${NBSP}Mariage de Camille${NBSP}».`,
    )
    expect(mails[1]?.text).toContain(
      'https://photos.example.org/admin/events/mariage-de-camille/settings',
    )
  })

  it('carries A3 and A5 on the retention sweep: a box with nothing to tell reports nothing and fails nowhere', async () => {
    const booted = await boot()
    await anEventOf(booted)

    const report = await booted.usecases.sweepEventNotices()

    expect(report).toEqual({
      noticed: [],
      sent: 0,
      unsent: 0,
      skippedBudget: 0,
      failed: [],
    })
  })

  it('sends none of it with HOST_MAIL_NOTICES=off, a job that took long included', async () => {
    const booted = await boot({ HOST_MAIL_NOTICES: 'off' })
    const { eventId } = await anEventOf(booted)
    await new SqliteAlbumBookRepository(booted.db).saveRequest(
      requestBook(eventId, OPTIONS, new Date(Date.now() - 10 * 60_000)),
    )

    await booted.albumBookWorker?.runOnce()
    await booted.usecases.jobNotice.idle()

    expect(received()).toEqual([])
  })
})
