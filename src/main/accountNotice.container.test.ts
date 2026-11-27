import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { aClient, aUser } from '../application/testing/builders'
import { asClientId, asUserId } from '../domain/shared/ids'
import { loadConfig } from '../infrastructure/config/env'
import { SqliteClientRepository } from '../infrastructure/db/sqliteClientRepository'
import { SqliteUserRepository } from '../infrastructure/db/sqliteUserRepository'
import { parseMessage, startSmtpSink, type SmtpSink } from '../infrastructure/mail/testing/smtpSink'
import { createContainer, type Container } from './container'

/**
 * **The mails that tell a holder what was done to the account, through the real composition root** (spec 32, A1):
 * the real use cases, the SQLite adapters and an SMTP relay in this process. What a unit test cannot say, and this
 * one does: that the box wires the notice into the use cases it names (a change of password), that the forced first
 * change sends nothing, that a deletion by `deleteAccount` sends one mail to the address that was read before it,
 * and that `finalizeOffboardedClients` deletes accounts **without** one.
 */

const OPERATOR = 'operateur@example.org'
const PASSWORD = 'un-mot-de-passe-solide'
const OLD = 'un-mot-de-passe-solide'
const FIRST = 'une-phrase-de-passe-neuve'
const SECOND = 'une-autre-phrase-de-passe'

let workDir: string | null = null
let container: Container | null = null
let relay: SmtpSink | null = null

afterEach(async () => {
  await container?.dispose()
  await relay?.close()
  container = null
  relay = null
  if (workDir !== null) await rm(workDir, { recursive: true, force: true })
  workDir = null
})

const boot = async (): Promise<Container> => {
  relay = await startSmtpSink()
  workDir = await mkdtemp(join(tmpdir(), 'eventslide-account-notice-'))
  container = await createContainer(
    loadConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'fatal',
      DATABASE_PATH: join(workDir, 'eventslide.sqlite'),
      MEDIA_ROOT: join(workDir, 'media'),
      FFMPEG_PATH: join(workDir, 'no-ffmpeg-here'),
      FFPROBE_PATH: join(workDir, 'no-ffprobe-here'),
      SITE_ADMIN: 'on',
      SMTP_URL: `smtp://127.0.0.1:${relay.port}`,
      MAIL_FROM: 'no-reply@photos.example.org',
      PUBLIC_URL: 'https://photos.example.org',
      BOOTSTRAP_OWNER_EMAIL: OPERATOR,
      BOOTSTRAP_OWNER_PASSWORD: PASSWORD,
    }),
  )
  return container
}

/** The relay received `count` messages, or the test fails after a few seconds. */
const received = async (count: number) => {
  const deadline = Date.now() + 5000
  while ((relay?.messages.length ?? 0) < count && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  // A moment more: a mail that should not exist would arrive in it.
  await new Promise((resolve) => setTimeout(resolve, 150))
  return (relay?.messages ?? []).map((message) => ({
    to: message.envelopeTo,
    subject: parseMessage(message.raw).subject ?? '',
    text: parseMessage(message.raw).text ?? '',
  }))
}

const idOf = (booted: Container, email: string): string =>
  booted.db
    .prepare<[string], { readonly id: string }>('SELECT id FROM users WHERE email = ?')
    .get(email)?.id ?? ''

describe('createContainer: the account notices (spec 32, A1)', () => {
  it('tells nothing of the forced first change, then one mail for the next change, with the reset link', async () => {
    const booted = await boot()
    const userId = asUserId(idOf(booted, OPERATOR))

    // The bootstrap account must change its password at first sign-in: that change is no security event.
    const first = await booted.usecases.changePassword({
      userId,
      currentPassword: OLD,
      newPassword: FIRST,
    })
    expect(first.ok).toBe(true)
    const second = await booted.usecases.changePassword({
      userId,
      currentPassword: FIRST,
      newPassword: SECOND,
    })
    expect(second.ok).toBe(true)

    const mails = await received(1)

    expect(mails).toHaveLength(1)
    expect(mails[0]?.to).toEqual([OPERATOR])
    expect(mails[0]?.subject).toBe('Votre mot de passe EventSlide a été changé')
    expect(mails[0]?.text).toContain('https://photos.example.org/password/forgot')
  })

  it('sends one mail for a deletion by deleteAccount, and none when finalizeOffboardedClients deletes accounts', async () => {
    const booted = await boot()
    booted.db.prepare('UPDATE users SET must_change_password = 0').run()
    const users = new SqliteUserRepository(booted.db)
    const clients = new SqliteClientRepository(booted.db)
    await users.save(
      aUser({ id: '22222222-2222-4222-8222-222222222222', email: 'personne@example.test' }),
    )
    await users.save(
      aUser({ id: '33333333-3333-4333-8333-333333333333', email: 'clos@example.test' }),
    )
    // A client whose engagement ended and whose grace is over, with one member who belongs to nothing else.
    await clients.save(
      aClient({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        purgeAfter: new Date(Date.now() - 1000),
      }),
    )
    await clients.grantMember({
      clientId: asClientId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
      userId: asUserId('33333333-3333-4333-8333-333333333333'),
      role: 'owner',
      grantedAt: new Date(),
    })

    const finalised = await booted.usecases.finalizeOffboardedClients()
    expect(finalised.accountsDeleted).toBeGreaterThanOrEqual(1)

    const deleted = await booted.usecases.deleteAccount({
      userId: asUserId('22222222-2222-4222-8222-222222222222'),
      actor: { kind: 'operator', userId: asUserId(idOf(booted, OPERATOR)) },
    })
    expect(deleted.ok).toBe(true)

    const mails = await received(1)

    expect(mails).toHaveLength(1)
    expect(mails[0]?.to).toEqual(['personne@example.test'])
    expect(mails[0]?.subject).toBe('Votre compte EventSlide a été supprimé')
    expect(mails[0]?.text).not.toContain('password/forgot')
  })
})
