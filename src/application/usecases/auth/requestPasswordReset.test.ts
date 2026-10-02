import { beforeEach, describe, expect, it } from 'vitest'
import { asUserId } from '../../../domain/shared/ids'
import {
  ACCOUNT_TOKEN_RETENTION_AFTER_EXPIRY_MS,
  PASSWORD_RESET_MAX_REQUESTS_PER_HOUR,
  PASSWORD_RESET_REQUEST_WINDOW_MS,
} from '../../../domain/users/accountToken'
import type { LogContext, Logger } from '../../ports/logger'
import { AT, aUser, anAccountToken } from '../../testing/builders'
import { FakeAccountTokenRepository } from '../../testing/fakeAccountTokenRepository'
import { FakeClock } from '../../testing/fakeClock'
import { FakeMailer } from '../../testing/fakeMailer'
import { FakeSecretTokens } from '../../testing/fakeSecretTokens'
import { FakeUserRepository } from '../../testing/fakeUserRepository'
import { SequentialIdGenerator } from '../../testing/sequentialIdGenerator'
import { mailFailure, type Mailer } from '../../ports/mailer'
import { err } from '../../../domain/shared/result'
import { makeRequestPasswordReset, type RequestPasswordResetInput } from './requestPasswordReset'

/** A box with no SMTP relay: the production `NullMailer`'s answer, written out. */
const nullMailer: Mailer = {
  canDeliver: false,
  send: async () => err(mailFailure('notConfigured')),
}

const PUBLIC_URL = 'https://photos.example.test'
const HOST_EMAIL = 'hote@example.test'
const HOUR = 60 * 60 * 1000

/** Records everything the use case logs, context included, so a test can read all of it. */
class RecordingLogger implements Logger {
  readonly lines: { level: string; message: string; context: LogContext }[] = []

  private record(level: string, message: string, context: LogContext = {}): void {
    this.lines.push({ level, message, context })
  }

  debug(message: string, context?: LogContext): void {
    this.record('debug', message, context)
  }
  info(message: string, context?: LogContext): void {
    this.record('info', message, context)
  }
  warn(message: string, context?: LogContext): void {
    this.record('warn', message, context)
  }
  error(message: string, context?: LogContext): void {
    this.record('error', message, context)
  }
  child(): Logger {
    return this
  }

  get everything(): string {
    return JSON.stringify(this.lines)
  }
}

describe('requestPasswordReset', () => {
  let users: FakeUserRepository
  let tokens: FakeAccountTokenRepository
  let secrets: FakeSecretTokens
  let mailer: FakeMailer
  let clock: FakeClock
  let logger: RecordingLogger
  let ids: SequentialIdGenerator

  const build = (withMailer: Mailer = mailer) =>
    makeRequestPasswordReset({
      users,
      tokens,
      secrets,
      mailer: withMailer,
      ids,
      clock,
      logger,
      publicUrl: PUBLIC_URL,
    })

  /** Asks, and waits for the work behind the answer — which the real caller does not. */
  const ask = async (
    email: string,
    overrides: Partial<RequestPasswordResetInput> = {},
    withMailer: Mailer = mailer,
  ) => {
    const result = await build(withMailer)({ email, locale: 'fr', ...overrides })
    if (result.ok) await result.value.completion
    return result
  }

  beforeEach(() => {
    users = new FakeUserRepository().seed(
      aUser({ id: 'user-1', email: HOST_EMAIL }),
      aUser({ id: 'user-disabled', email: 'parti@example.test', disabledAt: AT }),
    )
    tokens = new FakeAccountTokenRepository().withAccounts(
      asUserId('user-1'),
      asUserId('user-disabled'),
    )
    secrets = new FakeSecretTokens()
    mailer = new FakeMailer()
    clock = new FakeClock(AT)
    logger = new RecordingLogger()
    ids = new SequentialIdGenerator()
  })

  // ----------------------------------------------------------- the happy path --

  it('mails the account a link that carries a fresh token', async () => {
    const result = await ask(HOST_EMAIL)

    expect(result.ok).toBe(true)
    expect(mailer.sent).toHaveLength(1)
    expect(mailer.sent[0]?.to).toBe(HOST_EMAIL)
    expect(mailer.sent[0]?.text).toContain(`${PUBLIC_URL}/password/reset/secret-1`)
  })

  it('stores the digest of the token it mailed, and not the token', async () => {
    await ask(HOST_EMAIL)

    const [stored] = tokens.all
    expect(stored?.tokenDigest).toBe(secrets.digestOf('secret-1'))
    expect(JSON.stringify(stored)).not.toContain('secret-1')
  })

  it('issues a token for a password reset, for that account, that lives an hour', async () => {
    await ask(HOST_EMAIL)

    const [stored] = tokens.all
    expect(stored).toMatchObject({
      purpose: 'passwordReset',
      userId: 'user-1',
      delivery: 'mail',
      createdBy: null,
      requiresApproval: false,
    })
    expect(stored?.expiresAt.getTime()).toBe(AT.getTime() + HOUR)
  })

  it('writes the mail in the language of the page that asked', async () => {
    await ask(HOST_EMAIL, { locale: 'de' })

    expect(mailer.sent[0]?.text).toContain('Guten Tag')
  })

  it('finds the account whatever the capitalisation and spacing of the address typed', async () => {
    await ask('  Hote@Example.TEST ')

    expect(mailer.sent).toHaveLength(1)
  })

  // ------------------------------------------- the same answer, whoever asks --

  it.each([
    ['an address no account uses', 'inconnu@example.test'],
    ['an address that is not an address', 'pas une adresse'],
    ['an empty address', ''],
    ['a disabled account', 'parti@example.test'],
  ])('answers ok and sends nothing for %s', async (_label, email) => {
    const result = await ask(email)

    expect(result.ok).toBe(true)
    expect(mailer.sent).toEqual([])
    expect(tokens.all).toEqual([])
  })

  it('hands back a completion for every one of them, so the caller waits for none', async () => {
    const real = await build()({ email: HOST_EMAIL, locale: 'fr' })
    const unknown = await build()({ email: 'inconnu@example.test', locale: 'fr' })

    expect(real.ok && real.value.completion).toBeInstanceOf(Promise)
    expect(unknown.ok && unknown.value.completion).toBeInstanceOf(Promise)
    await Promise.all([real.ok && real.value.completion, unknown.ok && unknown.value.completion])
  })

  it('answers the same for a real account as for an unknown one, before any work is done', async () => {
    const real = await build()({ email: HOST_EMAIL, locale: 'fr' })
    const unknown = await build()({ email: 'inconnu@example.test', locale: 'fr' })

    expect(Object.keys(real.ok ? real.value : {})).toEqual(
      Object.keys(unknown.ok ? unknown.value : {}),
    )
    expect(real.ok).toBe(unknown.ok)
  })

  // ------------------------------------------------------------- no mailer --

  it('answers 404 feature.unavailable when the box has no mail relay, for any address', async () => {
    for (const email of [HOST_EMAIL, 'inconnu@example.test']) {
      const result = await ask(email, {}, nullMailer)

      expect(!result.ok && result.error.code).toBe('feature.unavailable')
      expect(!result.ok && result.error.kind).toBe('notFound')
    }
  })

  it('does no work at all without a mail relay: no token is issued, nothing is shown', async () => {
    await ask(HOST_EMAIL, {}, nullMailer)

    expect(tokens.all).toEqual([])
  })

  // ------------------------------------------------------------ one live link --

  it('revokes the earlier link when a newer one is issued, so only the newest works', async () => {
    await ask(HOST_EMAIL)
    clock.advance(60_000)

    await ask(HOST_EMAIL)

    const first = await tokens.findUsable(
      secrets.digestOf('secret-1'),
      'passwordReset',
      clock.now(),
    )
    const second = await tokens.findUsable(
      secrets.digestOf('secret-2'),
      'passwordReset',
      clock.now(),
    )
    expect(first).toBeNull()
    expect(second).not.toBeNull()
  })

  it('does not revoke the link it has just issued', async () => {
    await ask(HOST_EMAIL)

    const usable = await tokens.findUsable(
      secrets.digestOf('secret-1'),
      'passwordReset',
      clock.now(),
    )

    expect(usable).not.toBeNull()
  })

  it('leaves another account’s link alone', async () => {
    users.seed(aUser({ id: 'user-2', email: 'sacha@example.test' }))
    tokens.withAccounts(asUserId('user-2'))
    await ask('sacha@example.test')
    clock.advance(1_000)

    await ask(HOST_EMAIL)

    const theirs = await tokens.findUsable(
      secrets.digestOf('secret-1'),
      'passwordReset',
      clock.now(),
    )
    expect(theirs).not.toBeNull()
  })

  // ------------------------------------------------------------- the hourly cap --

  it(`mails an address at most ${PASSWORD_RESET_MAX_REQUESTS_PER_HOUR} times an hour`, async () => {
    for (let attempt = 0; attempt < PASSWORD_RESET_MAX_REQUESTS_PER_HOUR + 2; attempt += 1) {
      await ask(HOST_EMAIL)
      clock.advance(1_000)
    }

    expect(mailer.sent).toHaveLength(PASSWORD_RESET_MAX_REQUESTS_PER_HOUR)
    expect(tokens.all).toHaveLength(PASSWORD_RESET_MAX_REQUESTS_PER_HOUR)
  })

  it('answers the request over the cap exactly as it answers one under it', async () => {
    for (let attempt = 0; attempt < PASSWORD_RESET_MAX_REQUESTS_PER_HOUR; attempt += 1) {
      await ask(HOST_EMAIL)
    }

    const over = await ask(HOST_EMAIL)

    expect(over.ok).toBe(true)
  })

  it('mails again once the earliest request has left the hour', async () => {
    for (let attempt = 0; attempt < PASSWORD_RESET_MAX_REQUESTS_PER_HOUR; attempt += 1) {
      await ask(HOST_EMAIL)
    }
    clock.advance(PASSWORD_RESET_REQUEST_WINDOW_MS + 1)

    await ask(HOST_EMAIL)

    expect(mailer.sent).toHaveLength(PASSWORD_RESET_MAX_REQUESTS_PER_HOUR + 1)
  })

  it('counts each address on its own', async () => {
    users.seed(aUser({ id: 'user-2', email: 'sacha@example.test' }))
    tokens.withAccounts(asUserId('user-2'))
    for (let attempt = 0; attempt < PASSWORD_RESET_MAX_REQUESTS_PER_HOUR; attempt += 1) {
      await ask(HOST_EMAIL)
    }

    await ask('sacha@example.test')

    expect(mailer.sent.at(-1)?.to).toBe('sacha@example.test')
  })

  // ------------------------------------------------------------ housekeeping --

  it('deletes tokens that expired more than a day ago, which hold an address', async () => {
    await tokens.save(
      anAccountToken({
        id: 'tok-old',
        email: 'ancien@example.test',
        createdAt: new Date(AT.getTime() - 3 * 24 * HOUR),
      }),
    )

    await ask(HOST_EMAIL)

    expect(tokens.all.map((token) => token.id)).not.toContain('tok-old')
  })

  it('keeps a token that expired less than a day ago', async () => {
    await tokens.save(
      anAccountToken({
        id: 'tok-recent',
        email: 'recent@example.test',
        createdAt: new Date(AT.getTime() - 2 * HOUR),
      }),
    )

    await ask(HOST_EMAIL)

    expect(tokens.all.map((token) => token.id)).toContain('tok-recent')
  })

  it('keeps a token for exactly the retention period after it expires', async () => {
    const expiresAt = new Date(AT.getTime() - ACCOUNT_TOKEN_RETENTION_AFTER_EXPIRY_MS)
    await tokens.save(
      anAccountToken({
        id: 'tok-edge',
        email: 'edge@example.test',
        createdAt: new Date(expiresAt.getTime() - HOUR),
        expiresAt,
      }),
    )

    await ask(HOST_EMAIL)

    expect(tokens.all.map((token) => token.id)).toContain('tok-edge')
  })

  // ------------------------------------------------------------- the relay fails --

  it.each(['rejected', 'transient'] as const)(
    'answers ok when the relay says %s, and keeps the link issued',
    async (reason) => {
      mailer.failNextWith(reason)

      const result = await ask(HOST_EMAIL)

      expect(result.ok).toBe(true)
      expect(tokens.all).toHaveLength(1)
    },
  )

  it('logs a failed send by its code, and nothing that could identify the person or open the link', async () => {
    mailer.failNextWith('transient')

    await ask(HOST_EMAIL)

    expect(logger.lines).toContainEqual({
      level: 'warn',
      message: 'a password reset mail was not sent',
      context: { code: 'mail.transient' },
    })
  })

  it('answers ok and logs the failure when a repository throws, rather than rejecting', async () => {
    const broken: typeof tokens = Object.assign(tokens, {
      countCreatedSince: async () => {
        throw new Error('database is locked')
      },
    })
    tokens = broken

    const result = await build()({ email: HOST_EMAIL, locale: 'fr' })
    expect(result.ok).toBe(true)
    if (result.ok) await expect(result.value.completion).resolves.toBeUndefined()

    expect(logger.lines.map((line) => line.level)).toContain('error')
  })

  // ------------------------------------------------------------- nothing secret --

  it('writes the address, the token and the link into no log line, whatever happened', async () => {
    mailer.failNextWith('rejected')
    await ask(HOST_EMAIL)
    await ask('inconnu@example.test')
    for (let attempt = 0; attempt < PASSWORD_RESET_MAX_REQUESTS_PER_HOUR; attempt += 1) {
      await ask(HOST_EMAIL)
    }

    for (const secret of [
      HOST_EMAIL,
      'inconnu',
      'secret-1',
      'secret-2',
      '/password/reset/',
      'example.test',
    ]) {
      expect(logger.everything).not.toContain(secret)
    }
  })
})
