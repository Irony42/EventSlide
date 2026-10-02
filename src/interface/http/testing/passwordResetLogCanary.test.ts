import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { AT, aUser } from '../../../application/testing/builders'
import { FakeAccountTokenRepository } from '../../../application/testing/fakeAccountTokenRepository'
import { FakeClock } from '../../../application/testing/fakeClock'
import { FakeMailer } from '../../../application/testing/fakeMailer'
import { FakeSecretTokens } from '../../../application/testing/fakeSecretTokens'
import { FakeUserRepository } from '../../../application/testing/fakeUserRepository'
import { SequentialIdGenerator } from '../../../application/testing/sequentialIdGenerator'
import { makeRequestPasswordReset } from '../../../application/usecases/auth/requestPasswordReset'
import { makeResetPassword } from '../../../application/usecases/auth/resetPassword'
import { asUserId } from '../../../domain/shared/ids'
import type { Password } from '../../../domain/users/password'
import type { PasswordHash } from '../../../domain/users/user'
import { createPinoLogger } from '../../../infrastructure/logging/pinoLogger'
import { CSRF_COOKIE, CSRF_HEADER } from '../middleware/csrf'
import { captureAllOutputWhile } from './captureOutput'
import { buildServerHarness } from './serverHarness'

/**
 * A password reset must write no credential into any log (docs/SECURITY.md §9; roadmap
 * G2-08 / P3-09).
 *
 * A reset link **is** a password for the next hour. One line in a log shipper, a proxy's
 * access log or a support transcript makes it a leaked one, and the places it could be
 * written are not one place: the use case logs, the mailer logs, the access log writes a
 * line per request, the error handler logs what it catches. So this does not read a log
 * statement — it runs the whole journey against a *real* logger and a *real, enabled*
 * access log, and reads every byte the process wrote, on every channel it could have used
 * (the same net `logCanary.test.ts` casts over the route table).
 *
 * The values it plants are the four things a reset handles: the address, the token, the link
 * the token travels in, and the password chosen with it — each distinctive enough that
 * finding one anywhere in the output is conclusive.
 */

const ADDRESS = 'canary-reset-7f3a9c1e@example.test'
const NEW_PASSWORD = 'canary-new-password-7f3a9c1e5b2d'
const INSTANCE = { service: 'eventslide', version: 'reset-canary', instance: 'reset-canary-box' }

class FakeHasher {
  readonly dummyHash: PasswordHash = 'hash:factice'
  async hash(password: Password): Promise<PasswordHash> {
    return `hash:${password.value}`
  }
  async verify(attempt: string, hash: PasswordHash): Promise<boolean> {
    return hash === `hash:${attempt}`
  }
  needsRehash(): boolean {
    return false
  }
}

const journey = async (mailer: FakeMailer): Promise<{ token: string; link: string }> => {
  const logger = createPinoLogger({ level: 'trace', pretty: false, bindings: INSTANCE })
  const users = new FakeUserRepository().seed(aUser({ id: 'user-1', email: ADDRESS }))
  const tokens = new FakeAccountTokenRepository().withAccounts(asUserId('user-1'))
  const secrets = new FakeSecretTokens()
  const clock = new FakeClock(AT)
  const subject = buildServerHarness({
    logger,
    mailer,
    config: { accessLog: { enabled: true, level: 'trace', pretty: false, ...INSTANCE } },
    usecases: {
      requestPasswordReset: makeRequestPasswordReset({
        users,
        tokens,
        secrets,
        mailer,
        ids: new SequentialIdGenerator(),
        clock,
        logger,
        publicUrl: 'https://photos.example.test',
      }),
      resetPassword: makeResetPassword({
        users,
        tokens,
        secrets,
        hasher: new FakeHasher(),
        clock,
      }),
    },
  })

  const agent = request.agent(subject.app)
  const first = await agent.get('/api/auth/me')
  const cookie = (first.headers['set-cookie'] as unknown as string[] | undefined)?.find((value) =>
    value.startsWith(`${CSRF_COOKIE}=`),
  )
  const csrf = cookie?.slice(CSRF_COOKIE.length + 1).split(';')[0] ?? ''

  await agent
    .post('/api/auth/password-reset/request')
    .set(CSRF_HEADER, csrf)
    .send({ email: ADDRESS })
  // A second request for an address that does not exist, and a link that never existed.
  await agent
    .post('/api/auth/password-reset/request')
    .set(CSRF_HEADER, csrf)
    .send({ email: 'canary-nobody-7f3a9c1e@example.test' })
  await agent
    .post('/api/auth/password-reset/confirm')
    .set(CSRF_HEADER, csrf)
    .send({ token: 'canary-bogus-token-7f3a9c1e5b2d', password: NEW_PASSWORD })

  await vi.waitFor(() => expect(mailer.sent.length).toBeGreaterThanOrEqual(1))
  const link = /(https:\/\/\S+\/password\/reset\/\S+)/.exec(mailer.sent[0]?.text ?? '')?.[1] ?? ''
  const token = link.split('/').at(-1) ?? ''
  await agent
    .post('/api/auth/password-reset/confirm')
    .set(CSRF_HEADER, csrf)
    .send({ token, password: NEW_PASSWORD })
  // And the same link a second time, which the box refuses and must refuse quietly.
  await agent
    .post('/api/auth/password-reset/confirm')
    .set(CSRF_HEADER, csrf)
    .send({ token, password: NEW_PASSWORD })

  return { token, link }
}

describe('the log canary: a password reset', () => {
  const secretsOf = (token: string, link: string): readonly string[] => [
    ADDRESS,
    'canary-nobody-7f3a9c1e',
    'canary-bogus-token-7f3a9c1e5b2d',
    NEW_PASSWORD,
    token,
    link,
    '/password/reset/',
  ]

  it('writes neither the address, the token, the link nor the password, on any channel', async () => {
    let planted: { token: string; link: string } = { token: '', link: '' }
    const output = await captureAllOutputWhile(async () => {
      planted = await journey(new FakeMailer())
    })

    expect(planted.token).not.toBe('')
    expect(output.length).toBeGreaterThan(0)
    for (const secret of secretsOf(planted.token, planted.link)) {
      expect(output).not.toContain(secret)
    }
  })

  it('does record that a mail was refused, by its code, so an operator can see it', async () => {
    const output = await captureAllOutputWhile(async () => {
      const refusing = new FakeMailer().failNextWith('transient')
      const logger = createPinoLogger({ level: 'trace', pretty: false, bindings: INSTANCE })
      const users = new FakeUserRepository().seed(aUser({ id: 'user-1', email: ADDRESS }))
      const reset = makeRequestPasswordReset({
        users,
        tokens: new FakeAccountTokenRepository().withAccounts(asUserId('user-1')),
        secrets: new FakeSecretTokens(),
        mailer: refusing,
        ids: new SequentialIdGenerator(),
        clock: new FakeClock(AT),
        logger,
        publicUrl: 'https://photos.example.test',
      })
      const result = await reset({ email: ADDRESS, locale: 'fr' })
      if (result.ok) await result.value.completion
    })

    expect(output).toContain('a password reset mail was not sent')
    expect(output).toContain('mail.transient')
    expect(output).not.toContain(ADDRESS)
  })
})
