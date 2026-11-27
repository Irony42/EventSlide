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
import { decodeBase32 } from '../domain/users/base32'
import { totpStepAt } from '../domain/users/totp'
import { nodeTotpEngine } from '../infrastructure/crypto/nodeTotpEngine'
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
      MFA_ENCRYPTION_KEY: Buffer.alloc(32, 11).toString('base64'),
      SMTP_URL: `smtp://127.0.0.1:${relay.port}`,
      MAIL_FROM: 'no-reply@photos.example.org',
      PUBLIC_URL: 'https://photos.example.org',
      BOOTSTRAP_OWNER_EMAIL: OPERATOR,
      BOOTSTRAP_OWNER_PASSWORD: PASSWORD,
    }),
  )
  return container
}

/** What the relay received once every account notice started so far is over. */
const received = async (booted: Container) => {
  await booted.usecases.accountNotice.idle()
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

    const mails = await received(booted)

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
    expect(finalised.accountsDeleted).toBe(1)
    expect(await received(booted)).toEqual([])

    const deleted = await booted.usecases.deleteAccount({
      userId: asUserId('22222222-2222-4222-8222-222222222222'),
      actor: { kind: 'operator', userId: asUserId(idOf(booted, OPERATOR)) },
    })
    expect(deleted.ok).toBe(true)

    const mails = await received(booted)

    expect(mails).toHaveLength(1)
    expect(mails[0]?.to).toEqual(['personne@example.test'])
    expect(mails[0]?.subject).toBe('Votre compte EventSlide a été supprimé')
    expect(mails[0]?.text).not.toContain('password/forgot')
  })

  it('sends exactly one mail for each of the other acts: the composition wires every one', async () => {
    const booted = await boot()
    booted.db.prepare('UPDATE users SET must_change_password = 0').run()
    const users = new SqliteUserRepository(booted.db)
    await users.save(
      aUser({ id: '22222222-2222-4222-8222-222222222222', email: 'membre@example.test' }),
    )
    const operator = asUserId(idOf(booted, OPERATOR))
    const member = asUserId('22222222-2222-4222-8222-222222222222')
    const subjectsSince = async (before: number) =>
      (await received(booted)).slice(before).map((mail) => mail.subject)
    let seen = 0
    const next = async (): Promise<string[]> => {
      const all = await subjectsSince(seen)
      seen += all.length
      return all
    }

    // disableAccount and enableAccount (the operator acts on a member).
    await booted.usecases.disableAccount({
      userId: member,
      actor: { kind: 'operator', userId: operator },
    })
    expect(await next()).toEqual(['Votre compte EventSlide a été désactivé'])
    await booted.usecases.enableAccount({
      userId: member,
      actor: { kind: 'operator', userId: operator },
    })
    expect(await next()).toEqual(['Votre compte EventSlide a été réactivé'])

    // confirmTotpEnrollment, regenerateRecoveryCodes, disableSecondFactor (the operator's own factor).
    const started = await booted.usecases.enrollTotp({ userId: operator, password: PASSWORD })
    if (!started.ok) throw new Error('enrolment refused')
    const secret = decodeBase32(started.value.secret)
    if (secret === null) throw new Error('secret')
    const confirmed = await booted.usecases.confirmTotpEnrollment({
      userId: operator,
      code: nodeTotpEngine.codeAt(secret, totpStepAt(new Date())),
    })
    expect(confirmed.ok).toBe(true)
    expect(await next()).toEqual(['La vérification en deux étapes est activée'])
    expect((await booted.usecases.regenerateRecoveryCodes({ userId: operator })).ok).toBe(true)
    expect(await next()).toEqual(['Vos codes de secours ont été renouvelés'])
    expect((await booted.usecases.disableSecondFactor({ userId: operator })).ok).toBe(true)
    expect(await next()).toEqual(['La vérification en deux étapes est désactivée'])

    // resetPassword: the request mails the link (not an account notice), the reset itself mails the holder once.
    const asked = await booted.usecases.requestPasswordReset({ email: OPERATOR, locale: 'fr' })
    if (!asked.ok) throw new Error('reset not asked')
    await asked.value.completion
    const link = (await received(booted)).slice(seen)
    seen += link.length
    const token = /\/password\/reset\/([A-Za-z0-9_-]+)/.exec(link.at(-1)?.text ?? '')?.[1]
    if (token === undefined) throw new Error('no reset link was mailed')
    const reset = await booted.usecases.resetPassword({ token, newPassword: SECOND })
    expect(reset.ok).toBe(true)
    expect(await next()).toEqual(['Votre mot de passe EventSlide a été réinitialisé'])
  })
})
