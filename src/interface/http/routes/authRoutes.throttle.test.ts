import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { authRoutes } from './authRoutes'
import { buildHarness, testHttpConfig, type Harness } from '../testing/middlewareHarness'
import { aUser } from '../../../application/testing/builders'
import { FakeAccountTokenRepository } from '../../../application/testing/fakeAccountTokenRepository'
import { FakeMailer } from '../../../application/testing/fakeMailer'
import { FakeSecretTokens } from '../../../application/testing/fakeSecretTokens'
import { FakeUserRepository } from '../../../application/testing/fakeUserRepository'
import { SequentialIdGenerator } from '../../../application/testing/sequentialIdGenerator'
import type { Logger, LogContext } from '../../../application/ports/logger'
import type { PasswordHasher } from '../../../application/ports/passwordHasher'
import { makeAuthenticateUser } from '../../../application/usecases/auth/authenticateUser'
import { makeChangePassword } from '../../../application/usecases/auth/changePassword'
import { makeRequestPasswordReset } from '../../../application/usecases/auth/requestPasswordReset'
import { makeResetPassword } from '../../../application/usecases/auth/resetPassword'
import { makeRevokeOtherSessions } from '../../../application/usecases/auth/revokeOtherSessions'
import { asUserId } from '../../../domain/shared/ids'
import type { Password } from '../../../domain/users/password'
import type { PasswordHash } from '../../../domain/users/user'

/**
 * The per-account sign-in throttle (free plan G3-04, paid plan P4-07), through the real
 * `authRoutes` and the real use cases over fakes.
 *
 * Every test here is a security invariant, named for the rule it holds:
 *
 * - it slows attempts **per account** and never refuses the right password for good;
 * - it keeps the **per-client** limit, which counts across accounts;
 * - it answers a known and an unknown address **identically**, so it cannot be used to ask
 *   which addresses are accounts;
 * - a success, a malformed request and a refusal spend nothing.
 *
 * The rules themselves (the arithmetic of the waits, the memory bound) are held one ring
 * down, in `domain/users/signInThrottle.test.ts`.
 */

const OWNER_ID = 'owner-id'
const OWNER = 'camille@example.test'
const FORMER = 'ancienne@example.test'
const UNKNOWN = 'inconnu@example.test'
const NOT_AN_ADDRESS = 'pas-une-adresse'

/** The plaintext behind `builders.aUser`'s default hash. */
const PASSWORD = 'un-mot-de-passe-solide'
const WRONG = 'un-autre-mot-de-passe'

/**
 * `hash:<plaintext>`, like the fake the other route tests use. Counts how many comparisons
 * were started, and can hold them all open until a test lets them go: the means to put
 * twelve guesses in flight at once.
 */
class CountingHasher implements PasswordHasher {
  readonly dummyHash: PasswordHash = 'hash:*no-such-account*'
  started = 0

  constructor(private readonly gate: Promise<void> = Promise.resolve()) {}

  async hash(password: Password): Promise<PasswordHash> {
    return `hash:${password.value}`
  }

  async verify(attempt: string, hash: PasswordHash): Promise<boolean> {
    this.started += 1
    await this.gate
    return hash === `hash:${attempt}`
  }

  needsRehash(): boolean {
    return false
  }
}

interface Warning {
  readonly message: string
  readonly context: LogContext | undefined
}

interface Subject extends Harness {
  readonly hasher: CountingHasher
  readonly mailer: FakeMailer
  readonly tokens: FakeAccountTokenRepository
  /** The durations the throttle was asked to hold a request for, instead of holding it. */
  readonly holds: number[]
  readonly warnings: Warning[]
}

interface SubjectOptions {
  /** The per-client limit. Out of the way by default: most of these tests are about the other one. */
  readonly perMinute?: number
  readonly gate?: Promise<void>
  /** Session regeneration fails, as when the store goes away between the password and the cookie. */
  readonly sessionStoreDown?: boolean
}

const subjectOf = ({
  perMinute = 10_000,
  gate,
  sessionStoreDown = false,
}: SubjectOptions = {}): Subject => {
  const users = new FakeUserRepository()
  users.seed(aUser({ id: OWNER_ID, email: OWNER, displayName: 'Camille' }))
  users.seed(aUser({ id: 'former-id', email: FORMER, disabledAt: new Date(0) }))
  const hasher = new CountingHasher(gate)
  const mailer = new FakeMailer()
  const tokens = new FakeAccountTokenRepository().withAccounts(asUserId(OWNER_ID))
  const secrets = new FakeSecretTokens()
  const ids = new SequentialIdGenerator()
  const holds: number[] = []
  const warnings: Warning[] = []
  const logger: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: (message, context) => {
      warnings.push({ message, context })
    },
    error: () => undefined,
    child: () => logger,
  }

  const built = buildHarness({
    config: { rateLimits: { ...testHttpConfig().rateLimits, loginPerMinute: perMinute } },
    users,
    mailer,
    routes: (app, deps) => {
      // One proxy hop, so `X-Forwarded-For` is the client address: the only way a test can
      // present more than one network, and the deployment this product actually has.
      app.set('trust proxy', 1)
      if (sessionStoreDown) {
        app.use((req, _res, next) => {
          req.session.regenerate = (done) => {
            done(new Error('session store unavailable'))
            return req.session
          }
          next()
        })
      }
      app.use(
        '/api',
        authRoutes({
          deps: { ...deps, users, logger },
          usecases: {
            authenticateUser: makeAuthenticateUser({ users, hasher, clock: deps.clock }),
            changePassword: makeChangePassword({ users, hasher, clock: deps.clock }),
            revokeOtherSessions: makeRevokeOtherSessions({ users, clock: deps.clock }),
            requestPasswordReset: makeRequestPasswordReset({
              users,
              tokens,
              secrets,
              mailer,
              ids,
              clock: deps.clock,
              logger,
              publicUrl: deps.config.publicUrl,
            }),
            resetPassword: makeResetPassword({ users, tokens, secrets, hasher, clock: deps.clock }),
          },
          throttleHold: async (ms) => {
            holds.push(ms)
          },
        }),
      )
    },
  })

  return { ...built, hasher, mailer, tokens, holds, warnings }
}

/** Addresses that are different networks: IPv4 is its own key, and these never share a /56. */
const network = (n: number): string => `198.51.100.${n}`
const HOME = network(1)

interface Attempt {
  readonly from?: string
  readonly email?: string
  readonly password?: string
}

const signIn = (subject: Subject, { from = HOME, email = OWNER, password = WRONG }: Attempt = {}) =>
  request(subject.app)
    .post('/api/auth/login')
    .set('X-Forwarded-For', from)
    .send({ email, password })

const askForReset = (subject: Subject, email: string, from = HOME) =>
  request(subject.app)
    .post('/api/auth/password-reset/request')
    .set('X-Forwarded-For', from)
    .send({ email })

/** Everything a caller can observe of an answer, for comparing two of them. */
const observed = (response: {
  readonly status: number
  readonly body: unknown
  readonly headers: Record<string, unknown>
}) => ({
  status: response.status,
  body: response.body,
  retryAfter: response.headers['retry-after'],
})

/** `count` wrong guesses from one network, each one answered `401`. */
const failFrom = async (subject: Subject, count: number, attempt: Attempt = {}): Promise<void> => {
  for (let made = 0; made < count; made += 1) {
    const response = await signIn(subject, attempt)
    expect(response.status).toBe(401)
  }
}

/**
 * `count` wrong guesses from one network, waiting out every wait it is asked to, so that a
 * test can pile failures up without writing out the arithmetic. The last one has just been
 * made, so the network is inside the wait it earned.
 */
const pileUp = async (subject: Subject, count: number, attempt: Attempt = {}): Promise<void> => {
  let failures = 0
  // Bounded: a throttle that kept asking for longer waits would otherwise loop here for ever.
  for (let tries = 0; failures < count; tries += 1) {
    if (tries > count * 2 + 10) throw new Error(`still being asked to wait after ${tries} tries`)
    const response = await signIn(subject, attempt)
    if (response.status === 429) {
      subject.clock.advance(Number(response.headers['retry-after']) * 1_000)
    } else {
      expect(response.status).toBe(401)
      failures += 1
    }
  }
}

/** Lets the work behind a `202` (the lookup, the token, the mail) finish. */
const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 3; turn += 1) await new Promise((resolve) => setImmediate(resolve))
}

describe('the sign-in throttle, per account', () => {
  it('lets five wrong passwords through and asks the sixth to wait', async () => {
    const subject = subjectOf()

    await failFrom(subject, 5)
    const sixth = await signIn(subject)

    expect(sixth.status).toBe(429)
    expect(sixth.body.error.code).toBe('rate.limited')
    expect(sixth.headers['retry-after']).toBe('1')
  })

  it('asks for a wait that doubles with every failure and never exceeds fifteen minutes', async () => {
    const subject = subjectOf()
    await failFrom(subject, 5)

    const waits: number[] = []
    for (let round = 0; round < 12; round += 1) {
      const refused = await signIn(subject)
      expect(refused.status).toBe(429)
      const seconds = Number(refused.headers['retry-after'])
      waits.push(seconds)
      subject.clock.advance(seconds * 1_000)
      expect((await signIn(subject)).status).toBe(401)
    }

    expect(waits).toEqual([1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 900, 900])
  })

  it('does not lengthen the wait when it is knocked on during it', async () => {
    const subject = subjectOf()
    await pileUp(subject, 8)

    for (let knock = 0; knock < 40; knock += 1) {
      const refused = await signIn(subject)
      expect(refused.status).toBe(429)
      expect(refused.headers['retry-after']).toBe('8')
    }
    subject.clock.advance(8_000)

    expect((await signIn(subject)).status).toBe(401)
  })

  it('refuses even the right password while a wait runs, and accepts it when the wait is over', async () => {
    const subject = subjectOf()
    await pileUp(subject, 8)

    const during = await signIn(subject, { password: PASSWORD })
    subject.clock.advance(8_000)
    const after = await signIn(subject, { password: PASSWORD })

    expect(during.status).toBe(429)
    expect(after.status).toBe(200)
    expect(after.body.email).toBe(OWNER)
  })

  it('never locks an account out: after sixty failures the right password signs in a quarter hour later', async () => {
    const subject = subjectOf()
    await failFrom(subject, 5)
    for (let round = 0; round < 55; round += 1) {
      const refused = await signIn(subject)
      expect(refused.status).toBe(429)
      subject.clock.advance(Number(refused.headers['retry-after']) * 1_000)
      expect((await signIn(subject)).status).toBe(401)
    }
    const refused = await signIn(subject, { password: PASSWORD })
    expect(refused.status).toBe(429)
    expect(Number(refused.headers['retry-after'])).toBeLessThanOrEqual(900)

    subject.clock.advance(15 * 60_000)
    const signedIn = await signIn(subject, { password: PASSWORD })

    expect(signedIn.status).toBe(200)
  })

  it('does not slow the owner on their own network for what strangers did on ten others', async () => {
    const subject = subjectOf()
    for (let stranger = 10; stranger < 20; stranger += 1) {
      await failFrom(subject, 1, { from: network(stranger) })
    }

    const owner = await signIn(subject, { from: network(99), password: PASSWORD })

    expect(owner.status).toBe(200)
    expect(subject.holds).toEqual([])
  })

  it("does not let a stranger on another network spend the owner's free tries", async () => {
    const subject = subjectOf()
    await pileUp(subject, 40, { from: network(50) })

    await failFrom(subject, 5, { from: network(99) })
    const sixth = await signIn(subject, { from: network(99) })

    expect(sixth.status).toBe(429)
    expect(sixth.headers['retry-after']).toBe('1')
  })

  it('counts the network as its /56 prefix, so one IPv6 household has one budget', async () => {
    const subject = subjectOf()
    const households = ['2001:db8:1:2::1', '2001:db8:1:2:ffff::9']

    await failFrom(subject, 5, { from: households[0] ?? '' })

    expect((await signIn(subject, { from: households[1] ?? '' })).status).toBe(429)
    expect((await signIn(subject, { from: '2001:db8:1:200::1' })).status).toBe(401)
  })

  it('gives each account its own budget on the same network', async () => {
    const subject = subjectOf()

    for (const email of ['a@example.test', 'b@example.test', 'c@example.test', OWNER]) {
      await failFrom(subject, 5, { email })
    }

    for (const email of ['a@example.test', 'b@example.test', 'c@example.test', OWNER]) {
      expect((await signIn(subject, { email })).status).toBe(429)
    }
  })

  it('shares one budget between every spelling of an address', async () => {
    const subject = subjectOf()
    const spellings = [
      OWNER,
      'CAMILLE@example.test',
      ` ${OWNER} `,
      'Camille@Example.Test',
      'camille@EXAMPLE.test',
    ]

    for (const email of spellings) {
      expect((await signIn(subject, { email })).status).toBe(401)
    }
    const sixth = await signIn(subject, { email: 'camILLE@example.test' })

    expect(sixth.status).toBe(429)
  })

  it('keeps the per-client limit, which counts across accounts', async () => {
    const subject = subjectOf({ perMinute: 10 })

    const statuses: number[] = []
    for (let account = 0; account < 11; account += 1) {
      statuses.push((await signIn(subject, { email: `compte-${account}@example.test` })).status)
    }

    // Eleven accounts, one try each: no account is anywhere near its own five.
    expect(statuses).toEqual([401, 401, 401, 401, 401, 401, 401, 401, 401, 401, 429])
  })

  it('does not charge a success, and a success clears the wait of the network it came from', async () => {
    const subject = subjectOf()

    for (let round = 0; round < 30; round += 1) {
      expect((await signIn(subject, { password: PASSWORD })).status).toBe(200)
    }
    await failFrom(subject, 4)
    expect((await signIn(subject, { password: PASSWORD })).status).toBe(200)
    await failFrom(subject, 5)

    expect((await signIn(subject)).status).toBe(429)
  })

  it('does not charge a request the handler refuses as malformed', async () => {
    const subject = subjectOf()
    const malformed = [
      { email: OWNER },
      { email: OWNER, password: WRONG, userId: OWNER_ID },
      { email: OWNER, password: 'x'.repeat(1_001) },
      { password: WRONG },
    ]

    for (const body of malformed) {
      for (let again = 0; again < 4; again += 1) {
        const response = await request(subject.app)
          .post('/api/auth/login')
          .set('X-Forwarded-For', HOME)
          .send(body)
        expect(response.status).toBe(400)
      }
    }
    await failFrom(subject, 5)

    expect((await signIn(subject)).status).toBe(429)
  })

  it('does not charge a sign-in that failed on the server after the right password', async () => {
    const subject = subjectOf({ sessionStoreDown: true })

    for (let tries = 0; tries < 5; tries += 1) {
      expect((await signIn(subject, { password: PASSWORD })).status).toBe(500)
    }
    await failFrom(subject, 5)

    expect((await signIn(subject)).status).toBe(429)
  })

  it('does not let guesses started together outrun the free tries', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const subject = subjectOf({ gate })
    const answered: number[] = []

    const guesses = Array.from({ length: 12 }, () =>
      signIn(subject).then((response) => {
        answered.push(response.status)
        return response
      }),
    )
    // Five are inside their password comparison; the other seven were turned away at the
    // door, before any of the five could say it was a failure.
    await vi.waitFor(() => {
      expect(subject.hasher.started).toBe(5)
      expect(answered).toEqual(Array.from({ length: 7 }, () => 429))
    })
    release()
    const all = await Promise.all(guesses)

    expect(all.map((response) => response.status).sort()).toEqual([
      ...Array.from({ length: 5 }, () => 401),
      ...Array.from({ length: 7 }, () => 429),
    ])
  })
})

describe('the sign-in throttle, and the accounts a stranger can tell apart', () => {
  const addresses: readonly [string, string][] = [
    ['an account', OWNER],
    ['an address nobody uses', UNKNOWN],
    ['an account that was switched off', FORMER],
    ['an address that is not an address', NOT_AN_ADDRESS],
  ]

  it('answers every address the same way at every step: status, body and Retry-After', async () => {
    const sequences: unknown[][] = []

    for (const [, email] of addresses) {
      const subject = subjectOf()
      const seen: unknown[] = []
      for (let step = 0; step < 12; step += 1) {
        seen.push(observed(await signIn(subject, { email, password: WRONG })))
        subject.clock.advance(700)
      }
      sequences.push(seen)
    }

    const [first, ...others] = sequences
    for (const other of others) expect(other).toEqual(first)
    // Not vacuous: the sequence contains both answers, and the refusals carry a wait.
    expect(first?.some((step) => (step as { status: number }).status === 401)).toBe(true)
    expect(first?.some((step) => (step as { retryAfter?: string }).retryAfter !== undefined)).toBe(
      true,
    )
  })

  it('answers the right password of a real account the way a wrong one is answered during a wait', async () => {
    const real = subjectOf()
    const ghost = subjectOf()
    await failFrom(real, 5, { email: OWNER })
    await failFrom(ghost, 5, { email: UNKNOWN })

    const asked = observed(await signIn(real, { email: OWNER, password: PASSWORD }))
    const alike = observed(await signIn(ghost, { email: UNKNOWN, password: PASSWORD }))

    expect(asked).toEqual(alike)
    expect(asked.status).toBe(429)
  })

  it('refuses with the same code as the per-client limit, so it names no bucket', async () => {
    const perClient = subjectOf({ perMinute: 1 })
    await signIn(perClient)
    const byClient = await signIn(perClient)

    const perAccount = subjectOf()
    await failFrom(perAccount, 5)
    const byAccount = await signIn(perAccount)

    expect(byClient.status).toBe(429)
    expect(byAccount.status).toBe(429)
    expect(byAccount.body.error.code).toBe(byClient.body.error.code)
  })
})

describe('the sign-in throttle, on an account being stuffed from everywhere', () => {
  const stuff = async (subject: Subject, networks: number): Promise<void> => {
    for (let n = 1; n <= networks; n += 1) {
      await failFrom(subject, 1, { from: `203.0.113.${n}` })
    }
  }

  it('holds an attempt two seconds once the account has taken a hundred failures, and never refuses one', async () => {
    const subject = subjectOf()
    await stuff(subject, 100)
    expect(subject.holds).toEqual([])

    const wrong = await signIn(subject, { from: network(150) })
    const right = await signIn(subject, { from: network(151), password: PASSWORD })

    expect(wrong.status).toBe(401)
    expect(right.status).toBe(200)
    expect(subject.holds).toEqual([2_000, 2_000])
  })

  it('holds the owner no longer than two seconds on their own network, whatever strangers did', async () => {
    const subject = subjectOf()
    await stuff(subject, 100)

    const owner = await signIn(subject, { from: network(99), password: PASSWORD })

    expect(owner.status).toBe(200)
    expect(Math.max(...subject.holds)).toBeLessThanOrEqual(2_000)
  })

  it('stops holding when the hour is over', async () => {
    const subject = subjectOf()
    await stuff(subject, 100)
    subject.clock.advance(61 * 60_000)

    const owner = await signIn(subject, { from: network(99), password: PASSWORD })

    expect(owner.status).toBe(200)
    expect(subject.holds).toEqual([])
  })

  it('raises one alert for the account, without its address in it', async () => {
    const subject = subjectOf()
    await stuff(subject, 100)

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await signIn(subject, { from: network(120 + attempt) })
    }

    expect(subject.warnings).toHaveLength(1)
    expect(subject.warnings[0]?.message).toMatch(/credential stuffing/)
    expect(JSON.stringify(subject.warnings)).not.toContain('camille')
    expect(subject.warnings[0]?.context?.['account']).toMatch(/^[0-9a-f]{12}$/)
  })

  it('does not hold another account for it', async () => {
    const subject = subjectOf()
    await stuff(subject, 100)

    await signIn(subject, { from: network(120), email: UNKNOWN })

    expect(subject.holds).toEqual([])
  })
})

describe('the same throttle on POST /api/auth/password-reset/request', () => {
  it('answers a known and an unknown address the same way at every step', async () => {
    const sequences: unknown[][] = []

    for (const email of [OWNER, UNKNOWN, FORMER, NOT_AN_ADDRESS]) {
      const subject = subjectOf()
      const seen: unknown[] = []
      for (let step = 0; step < 10; step += 1) {
        seen.push(observed(await askForReset(subject, email)))
        subject.clock.advance(700)
      }
      sequences.push(seen)
    }

    const [first, ...others] = sequences
    for (const other of others) expect(other).toEqual(first)
    expect((first ?? []).map((step) => (step as { status: number }).status)).toContain(202)
    expect((first ?? []).map((step) => (step as { status: number }).status)).toContain(429)
  })

  it('lets five requests through, then asks the sixth to wait', async () => {
    const subject = subjectOf()

    const statuses: number[] = []
    for (let n = 0; n < 7; n += 1) {
      statuses.push((await askForReset(subject, OWNER)).status)
    }

    expect(statuses).toEqual([202, 202, 202, 202, 202, 429, 429])
  })

  it('does not contradict the cap on mails: a throttled request is never mailed, and the cap still binds', async () => {
    const subject = subjectOf()

    for (let n = 0; n < 5; n += 1) await askForReset(subject, OWNER)
    await settle()
    expect(subject.mailer.sent).toHaveLength(3)

    const refused = await askForReset(subject, OWNER)
    await settle()
    expect(refused.status).toBe(429)
    expect(subject.mailer.sent).toHaveLength(3)

    subject.clock.advance(1_000)
    const later = await askForReset(subject, OWNER)
    await settle()
    // Accepted again by the throttle, and answered the same 202 by the cap: still three mails.
    expect(later.status).toBe(202)
    expect(subject.mailer.sent).toHaveLength(3)
  })

  it('keeps a budget of its own, apart from the sign-in', async () => {
    const subject = subjectOf()

    // Spent on sign-in failures, the reset route still has its five...
    await failFrom(subject, 5)
    const statuses: number[] = []
    for (let n = 0; n < 6; n += 1) statuses.push((await askForReset(subject, OWNER)).status)
    expect(statuses).toEqual([202, 202, 202, 202, 202, 429])

    // ...and spent on reset requests, the sign-in still has its five.
    subject.clock.advance(3_600_000)
    for (let n = 0; n < 5; n += 1) await askForReset(subject, OWNER)
    await failFrom(subject, 5)
  })

  it('gives another network its own budget for the same address', async () => {
    const subject = subjectOf()
    for (let n = 0; n < 6; n += 1) await askForReset(subject, OWNER)

    expect((await askForReset(subject, OWNER, network(2))).status).toBe(202)
  })
})
