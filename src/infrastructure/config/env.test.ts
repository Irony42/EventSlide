import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ConfigError, loadConfig } from './env'
import { Password } from '../../domain/users/password'

/**
 * Ring 3. `loadConfig` takes its source as a parameter, so every case here is a plain
 * object and the real `process.env` is never read or mutated.
 *
 * The refusals are security controls, not validation niceties: a production boot with a
 * placeholder secret, a plain-http public origin, or the Playwright timing hooks
 * enabled is a boot that looks configured and is not. Each one gets its own test named
 * after what it refuses.
 */

/** Long enough for the HMAC token service, and absent from the placeholder list. */
const A_REAL_SECRET = 'f3b1c9d7e5a2408c9b6d1e4f7a0c3b5d8e2f6a19c4d7b0e3'
const ANOTHER_REAL_SECRET = '9a7c5e3b1d8f6042ae1c3b5d7f9014682a4c6e8b0d2f4a6c'

type Source = Record<string, string | undefined>

/** A production environment that boots, so a test can break exactly one thing in it. */
const aProductionEnv = (overrides: Source = {}): Source => ({
  NODE_ENV: 'production',
  PUBLIC_URL: 'https://photos.example.com',
  SESSION_SECRET: A_REAL_SECRET,
  GUEST_TOKEN_SECRET: ANOTHER_REAL_SECRET,
  ...overrides,
})

/**
 * Narrows the refusal once, so each test reads as `expect(issues)...` and fails with
 * the issue list rather than with an unhandled throw.
 */
const refusalIssues = (source: Source): readonly string[] => {
  try {
    loadConfig(source)
  } catch (error) {
    if (error instanceof ConfigError) return error.issues
    throw error
  }
  throw new Error('loadConfig accepted a configuration that the test expected it to refuse')
}

/** `KEY=value` lines only; comments and blanks are what `.env.example` is mostly made of. */
const parseDotEnv = (contents: string): Source =>
  Object.fromEntries(
    contents
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'))
      .map((line) => {
        const separator = line.indexOf('=')
        return [line.slice(0, separator), line.slice(separator + 1)] as const
      }),
  )

describe('loadConfig', () => {
  describe('defaults', () => {
    it('boots a development server from an empty environment, with every documented default', () => {
      const config = loadConfig({})

      expect(config).toEqual({
        env: 'development',
        isProduction: false,
        port: 4300,
        publicUrl: 'http://localhost:5173',
        logLevel: 'info',
        trustProxyHops: 0,
        secrets: {
          session: 'development-only-session-secret-not-for-production',
          guestToken: 'development-only-guest-token-secret-not-for-prod',
        },
        session: { secureCookie: false },
        storage: { databasePath: './data/eventslide.sqlite', mediaRoot: './media' },
        uploads: {
          maxBytes: 25_000_000,
          maxFiles: 20,
          maxPixels: 50_000_000,
          defaultEventQuotaBytes: 5_000_000_000,
        },
        guests: { selfDeleteGraceMs: 900_000 },
        retention: { sweepIntervalMs: 3_600_000 },
        schedule: { sweepIntervalMs: 300_000 },
        rateLimits: {
          uploadPerMinute: 12,
          joinPerMinute: 20,
          loginPerMinute: 10,
          reactionPerMinute: 30,
        },
        crypto: { bcryptCost: 12 },
        bootstrap: { ownerEmail: null, ownerPassword: null },
        e2eHooks: false,
      })
    })

    it('gives development two different fallback secrets, so a guest cookie cannot be replayed as a session', () => {
      const config = loadConfig({})

      expect(config.secrets.session).not.toBe(config.secrets.guestToken)
    })

    it('makes both development fallback secrets long enough for the HMAC token service to accept', () => {
      const config = loadConfig({})

      // createHmacGuestTokenService refuses a secret under 32 characters, so a
      // fallback shorter than that would make `npm run dev` crash on the first join.
      expect(config.secrets.session.length).toBeGreaterThanOrEqual(32)
      expect(config.secrets.guestToken.length).toBeGreaterThanOrEqual(32)
    })

    it('strips a trailing slash from PUBLIC_URL, so a join QR code cannot contain a double slash', () => {
      const config = loadConfig({ PUBLIC_URL: 'https://photos.example.com///' })

      expect(config.publicUrl).toBe('https://photos.example.com')
    })

    it('converts the guest self-delete grace period from seconds to milliseconds', () => {
      const config = loadConfig({ GUEST_SELF_DELETE_GRACE_SECONDS: '60' })

      expect(config.guests.selfDeleteGraceMs).toBe(60_000)
    })

    it('turns on the Secure cookie flag in production without being told to', () => {
      const config = loadConfig(aProductionEnv())

      expect(config.session.secureCookie).toBe(true)
    })

    it('lets SESSION_COOKIE_SECURE override the NODE_ENV default, for a proxy that terminates TLS', () => {
      const config = loadConfig(aProductionEnv({ SESSION_COOKIE_SECURE: 'false' }))

      expect(config.session.secureCookie).toBe(false)
    })

    it('passes through the bootstrap owner credentials that create the first account', () => {
      const config = loadConfig({
        BOOTSTRAP_OWNER_EMAIL: 'host@example.com',
        BOOTSTRAP_OWNER_PASSWORD: 'a-first-owner-password',
      })

      expect(config.bootstrap).toEqual({
        ownerEmail: 'host@example.com',
        ownerPassword: 'a-first-owner-password',
      })
    })

    it.each([
      ['true', true],
      ['1', true],
      ['false', false],
      ['0', false],
    ])('reads E2E_HOOKS=%s as %s', (given, expected) => {
      const config = loadConfig({ NODE_ENV: 'test', E2E_HOOKS: given })

      expect(config.e2eHooks).toBe(expected)
    })
  })

  describe('each variable reaches its own field', () => {
    it('never crosses two numeric limits, which sharing a default would hide', () => {
      // Every value here is distinct, so a field reading the wrong variable fails —
      // MAX_FILES_PER_UPLOAD and JOIN_RATE_LIMIT_PER_MINUTE both default to 20, so a
      // test built from defaults would pass with those two swapped.
      const config = loadConfig({
        PORT: '4301',
        TRUST_PROXY_HOPS: '3',
        MAX_UPLOAD_BYTES: '1111',
        MAX_FILES_PER_UPLOAD: '7',
        MAX_IMAGE_PIXELS: '2222',
        DEFAULT_EVENT_QUOTA_BYTES: '3333',
        GUEST_SELF_DELETE_GRACE_SECONDS: '61',
        UPLOAD_RATE_LIMIT_PER_MINUTE: '101',
        JOIN_RATE_LIMIT_PER_MINUTE: '102',
        LOGIN_RATE_LIMIT_PER_MINUTE: '103',
        REACTION_RATE_LIMIT_PER_MINUTE: '104',
        BCRYPT_COST: '14',
      })

      expect(config).toMatchObject({
        port: 4301,
        trustProxyHops: 3,
        uploads: {
          maxBytes: 1111,
          maxFiles: 7,
          maxPixels: 2222,
          defaultEventQuotaBytes: 3333,
        },
        guests: { selfDeleteGraceMs: 61_000 },
        rateLimits: {
          uploadPerMinute: 101,
          joinPerMinute: 102,
          loginPerMinute: 103,
          reactionPerMinute: 104,
        },
        crypto: { bcryptCost: 14 },
      })
    })
  })

  describe('a complete production environment', () => {
    it('is accepted, and the configured secrets are the ones handed to the application', () => {
      const config = loadConfig(
        aProductionEnv({
          PORT: '8443',
          LOG_LEVEL: 'warn',
          TRUST_PROXY_HOPS: '1',
          DATABASE_PATH: '/srv/eventslide/eventslide.sqlite',
          MEDIA_ROOT: '/srv/eventslide/media',
          BCRYPT_COST: '13',
        }),
      )

      expect(config).toMatchObject({
        env: 'production',
        isProduction: true,
        port: 8443,
        publicUrl: 'https://photos.example.com',
        logLevel: 'warn',
        trustProxyHops: 1,
        secrets: { session: A_REAL_SECRET, guestToken: ANOTHER_REAL_SECRET },
        session: { secureCookie: true },
        storage: {
          databasePath: '/srv/eventslide/eventslide.sqlite',
          mediaRoot: '/srv/eventslide/media',
        },
        crypto: { bcryptCost: 13 },
        e2eHooks: false,
      })
    })

    it('allows a plain-http PUBLIC_URL on localhost, which is how a TLS-terminating proxy is deployed', () => {
      const config = loadConfig(aProductionEnv({ PUBLIC_URL: 'http://localhost:4300' }))

      expect(config.publicUrl).toBe('http://localhost:4300')
    })
  })

  describe('production refusals', () => {
    it('refuses to boot without SESSION_SECRET', () => {
      const issues = refusalIssues(aProductionEnv({ SESSION_SECRET: undefined }))

      expect(issues).toContain('SESSION_SECRET: SESSION_SECRET is required in production')
    })

    it('refuses to boot without GUEST_TOKEN_SECRET', () => {
      const issues = refusalIssues(aProductionEnv({ GUEST_TOKEN_SECRET: undefined }))

      expect(issues).toContain('GUEST_TOKEN_SECRET: GUEST_TOKEN_SECRET is required in production')
    })

    it('refuses to boot with the Playwright timing hooks enabled', () => {
      const issues = refusalIssues(aProductionEnv({ E2E_HOOKS: 'true' }))

      expect(issues).toContain('E2E_HOOKS: E2E_HOOKS must not be enabled in production')
    })

    it('refuses to boot with a plain-http PUBLIC_URL, because a Secure session cookie would never be sent', () => {
      const issues = refusalIssues(aProductionEnv({ PUBLIC_URL: 'http://photos.example.com' }))

      expect(issues.some((issue) => issue.startsWith('PUBLIC_URL: '))).toBe(true)
    })

    it('accepts an explicitly disabled E2E_HOOKS in production, since only enabling it is the hazard', () => {
      const config = loadConfig(aProductionEnv({ E2E_HOOKS: '0' }))

      expect(config.e2eHooks).toBe(false)
    })

    it('names every problem at once, so setting up in a venue is not one restart per variable', () => {
      const issues = refusalIssues({
        NODE_ENV: 'production',
        PUBLIC_URL: 'http://photos.example.com',
        E2E_HOOKS: '1',
      })

      expect(issues).toHaveLength(4)
      expect(issues.map((issue) => issue.split(':')[0]).sort()).toEqual([
        'E2E_HOOKS',
        'GUEST_TOKEN_SECRET',
        'PUBLIC_URL',
        'SESSION_SECRET',
      ])
    })

    it('reports the refusal as a ConfigError whose message lists each issue on its own line', () => {
      expect(() => loadConfig(aProductionEnv({ SESSION_SECRET: undefined }))).toThrow(ConfigError)
      expect(() => loadConfig(aProductionEnv({ SESSION_SECRET: undefined }))).toThrow(
        /Invalid configuration:\n {2}- SESSION_SECRET: /,
      )
    })
  })

  describe('placeholder secrets', () => {
    it.each([
      'change-me-in-production-at-least-32-characters',
      'change-me-too-at-least-32-characters-long',
    ])('refuses %s, because a shipped .env.example looks configured and is not', (placeholder) => {
      const issues = refusalIssues(aProductionEnv({ SESSION_SECRET: placeholder }))

      expect(issues).toContain(
        'SESSION_SECRET: SESSION_SECRET is still the example value from .env.example',
      )
    })

    it('refuses a placeholder GUEST_TOKEN_SECRET as well, since it signs every guest cookie', () => {
      const issues = refusalIssues(
        aProductionEnv({ GUEST_TOKEN_SECRET: 'change-me-too-at-least-32-characters-long' }),
      )

      expect(issues).toContain(
        'GUEST_TOKEN_SECRET: GUEST_TOKEN_SECRET is still the example value from .env.example',
      )
    })

    it('refuses a placeholder even outside production, so it can never become the real value', () => {
      const issues = refusalIssues({
        NODE_ENV: 'development',
        SESSION_SECRET: 'change-me-in-production-at-least-32-characters',
      })

      expect(issues).toContain(
        'SESSION_SECRET: SESSION_SECRET is still the example value from .env.example',
      )
    })

    it('refuses the checked-in .env.example verbatim when it is used as a production .env', () => {
      // vitest runs from the repository root, as `src/main/container.ts` also assumes.
      const example = parseDotEnv(readFileSync(resolve(process.cwd(), '.env.example'), 'utf8'))

      const issues = refusalIssues({ ...example, NODE_ENV: 'production' })

      // Its PUBLIC_URL is a localhost origin, which production exempts, so the two
      // placeholder secrets are the whole of what stops the boot.
      expect(issues.map((issue) => issue.split(':')[0]).sort()).toEqual([
        'GUEST_TOKEN_SECRET',
        'SESSION_SECRET',
      ])
    })

    it.each(['dev-session-secret', 'secret', 'short'])(
      'refuses the secret %s for being under 32 characters',
      (weak) => {
        const issues = refusalIssues(aProductionEnv({ SESSION_SECRET: weak }))

        expect(issues).toContain('SESSION_SECRET: SESSION_SECRET must be at least 32 characters')
      },
    )
  })

  describe('malformed values are refused, never coerced', () => {
    it.each(['not-a-number', '', '0', '-1', '4300.5', '70000', 'Infinity'])(
      'refuses PORT=%s',
      (port) => {
        const issues = refusalIssues({ PORT: port })

        expect(issues.some((issue) => issue.startsWith('PORT: '))).toBe(true)
      },
    )

    it.each(['yes', 'no', 'on', 'TRUE', '2', ''])(
      'refuses SESSION_COOKIE_SECURE=%s rather than treating a non-empty string as true',
      (given) => {
        const issues = refusalIssues({ SESSION_COOKIE_SECURE: given })

        expect(issues.some((issue) => issue.startsWith('SESSION_COOKIE_SECURE: '))).toBe(true)
      },
    )

    it('refuses E2E_HOOKS=yes rather than enabling the hooks on a truthy string', () => {
      const issues = refusalIssues({ E2E_HOOKS: 'yes' })

      expect(issues.some((issue) => issue.startsWith('E2E_HOOKS: '))).toBe(true)
    })

    it.each(['photos.example.com', 'not a url', ''])('refuses PUBLIC_URL=%s', (url) => {
      const issues = refusalIssues({ PUBLIC_URL: url })

      expect(issues.some((issue) => issue.startsWith('PUBLIC_URL: '))).toBe(true)
    })

    it.each(['javascript:alert(1)', 'data:text/html,x', 'file:///c:/', 'ws://photos.example.com'])(
      'refuses PUBLIC_URL=%s, which parses as a URL but cannot be a join link',
      (url) => {
        // The value is concatenated into the event DTO's joinUrl, which the admin
        // console renders as an anchor and as a QR code, so a `javascript:` origin
        // would put a script URI behind the join button. Every one of these passes
        // `z.string().url()`.
        const issues = refusalIssues({ PUBLIC_URL: url })

        expect(issues.some((issue) => issue.startsWith('PUBLIC_URL: '))).toBe(true)
      },
    )

    it('refuses an unknown LOG_LEVEL instead of falling back to info', () => {
      const issues = refusalIssues({ LOG_LEVEL: 'verbose' })

      expect(issues.some((issue) => issue.startsWith('LOG_LEVEL: '))).toBe(true)
    })

    it('refuses an unknown NODE_ENV, so a typo cannot silently disable the production checks', () => {
      const issues = refusalIssues({ NODE_ENV: 'prod' })

      expect(issues.some((issue) => issue.startsWith('NODE_ENV: '))).toBe(true)
    })

    it.each(['-1', '11', '1.5'])(
      'refuses TRUST_PROXY_HOPS=%s, because a wrong hop count breaks per-IP rate limiting',
      (hops) => {
        const issues = refusalIssues({ TRUST_PROXY_HOPS: hops })

        expect(issues.some((issue) => issue.startsWith('TRUST_PROXY_HOPS: '))).toBe(true)
      },
    )

    it.each([
      ['DATABASE_PATH', ''],
      ['MEDIA_ROOT', ''],
    ])('refuses an empty %s', (name, value) => {
      const issues = refusalIssues({ [name]: value })

      expect(issues.some((issue) => issue.startsWith(`${name}: `))).toBe(true)
    })

    it.each([
      ['MAX_FILES_PER_UPLOAD', '101'],
      ['GUEST_SELF_DELETE_GRACE_SECONDS', '86401'],
      ['BCRYPT_COST', '16'],
      ['UPLOAD_RATE_LIMIT_PER_MINUTE', '601'],
      ['JOIN_RATE_LIMIT_PER_MINUTE', '601'],
      ['LOGIN_RATE_LIMIT_PER_MINUTE', '601'],
      ['REACTION_RATE_LIMIT_PER_MINUTE', '601'],
    ])('refuses %s=%s for exceeding its ceiling', (name, value) => {
      const issues = refusalIssues({ [name]: value })

      expect(issues.some((issue) => issue.startsWith(`${name}: `))).toBe(true)
    })

    it.each(['9', '1'])(
      'refuses BCRYPT_COST=%s here rather than letting the hasher throw while the container is assembled',
      (cost) => {
        // createBcryptPasswordHasher refuses a cost under 10 with a bare Error that
        // names neither the variable nor this file. Naming every bad variable at once
        // is this module's job, so the floor has to live here.
        const issues = refusalIssues({ BCRYPT_COST: cost })

        expect(issues.some((issue) => issue.startsWith('BCRYPT_COST: '))).toBe(true)
      },
    )

    it.each([
      'MAX_UPLOAD_BYTES',
      'MAX_IMAGE_PIXELS',
      'DEFAULT_EVENT_QUOTA_BYTES',
      'MAX_FILES_PER_UPLOAD',
    ])('refuses %s=0, because a zero limit would refuse every upload silently', (name) => {
      const issues = refusalIssues({ [name]: '0' })

      expect(issues.some((issue) => issue.startsWith(`${name}: `))).toBe(true)
    })
  })

  describe('the first-owner bootstrap', () => {
    const A_GOOD_PASSWORD = 'a-first-owner-password'

    it('refuses a password under the domain minimum here, rather than in a log line while the container assembles', () => {
      // `bootstrapOwner` already applies `Password`, but it applies it during
      // composition, where the only outcome is one log line and an operator meeting a
      // login form that rejects them. Same reasoning as BCRYPT_COST's floor.
      const issues = refusalIssues({
        BOOTSTRAP_OWNER_EMAIL: 'host@example.com',
        BOOTSTRAP_OWNER_PASSWORD: 'short',
      })

      expect(issues.some((issue) => issue.startsWith('BOOTSTRAP_OWNER_PASSWORD: '))).toBe(true)
      // The number comes from the domain, so the message cannot drift from the rule.
      expect(issues.join('\n')).toContain(`at least ${Password.minLength} characters`)
    })

    it('applies the whole password policy, not a length check restated here', () => {
      // Twelve characters, so a length-only rule would let it through. The blocklist
      // belongs to the domain and this is what reaching for it buys.
      const issues = refusalIssues({
        BOOTSTRAP_OWNER_EMAIL: 'host@example.com',
        BOOTSTRAP_OWNER_PASSWORD: 'changemenow1',
      })

      expect(issues.some((issue) => issue.startsWith('BOOTSTRAP_OWNER_PASSWORD: '))).toBe(true)
    })

    it('reads the empty string compose renders for an unset variable as absent, not as a value', () => {
      // `BOOTSTRAP_OWNER_PASSWORD: ${BOOTSTRAP_OWNER_PASSWORD:-}` is what every default
      // `docker compose up` sends. Treated as a value it made the container log
      // "could not create the first owner account" on every boot; treated as a policy
      // failure it would now refuse to boot at all.
      const config = loadConfig({ BOOTSTRAP_OWNER_EMAIL: '', BOOTSTRAP_OWNER_PASSWORD: '' })

      expect(config.bootstrap).toEqual({ ownerEmail: null, ownerPassword: null })
    })

    it('refuses an email with no password, because half a bootstrap creates no account', () => {
      const issues = refusalIssues({ BOOTSTRAP_OWNER_EMAIL: 'host@example.com' })

      expect(issues.some((issue) => issue.startsWith('BOOTSTRAP_OWNER_PASSWORD: '))).toBe(true)
    })

    it('refuses a password with no email, for the same reason in the other direction', () => {
      const issues = refusalIssues({ BOOTSTRAP_OWNER_PASSWORD: A_GOOD_PASSWORD })

      expect(issues.some((issue) => issue.startsWith('BOOTSTRAP_OWNER_EMAIL: '))).toBe(true)
    })

    it('accepts a pair that satisfies the policy, which is the case an operator actually sets', () => {
      const config = loadConfig({
        BOOTSTRAP_OWNER_EMAIL: 'host@example.com',
        BOOTSTRAP_OWNER_PASSWORD: A_GOOD_PASSWORD,
      })

      expect(config.bootstrap).toEqual({
        ownerEmail: 'host@example.com',
        ownerPassword: A_GOOD_PASSWORD,
      })
    })
  })

  describe('the retention sweep interval', () => {
    const NAME = 'RETENTION_SWEEP_INTERVAL_MINUTES'

    it('sweeps hourly with nothing configured, so a single-box install honours retention', () => {
      // The whole point of the setting: `docker compose up` and nothing else must act on
      // a host's "delete after 30 days". A default of off would ship the same lie the
      // product told before there was a trigger at all.
      const config = loadConfig({})

      expect(config.retention.sweepIntervalMs).toBe(3_600_000)
    })

    it('sweeps hourly in production with nothing configured', () => {
      const config = loadConfig(aProductionEnv())

      expect(config.retention.sweepIntervalMs).toBe(3_600_000)
    })

    it('never sweeps under NODE_ENV=test unless asked', () => {
      // tests/e2e/fixtures/startTestApp.ts boots this binary with NODE_ENV=test and no
      // retention variable. A background sweep firing mid-journey would delete the event
      // a spec is asserting on, on a timer nothing in the test can see.
      const config = loadConfig({ NODE_ENV: 'test' })

      expect(config.retention.sweepIntervalMs).toBeNull()
    })

    it('converts the configured interval from minutes to milliseconds', () => {
      const config = loadConfig({ [NAME]: '15' })

      expect(config.retention.sweepIntervalMs).toBe(900_000)
    })

    it('accepts an explicit interval under NODE_ENV=test, for a test that is about the sweep', () => {
      const config = loadConfig({ NODE_ENV: 'test', [NAME]: '5' })

      expect(config.retention.sweepIntervalMs).toBe(300_000)
    })

    it("turns the sweep off for the word 'off', which is the only way to turn it off", () => {
      const config = loadConfig({ [NAME]: 'off' })

      expect(config.retention.sweepIntervalMs).toBeNull()
    })

    it("ignores surrounding whitespace, which a compose file's quoting adds easily", () => {
      expect(loadConfig({ [NAME]: ' off ' }).retention.sweepIntervalMs).toBeNull()
      expect(loadConfig({ [NAME]: ' 30 ' }).retention.sweepIntervalMs).toBe(1_800_000)
    })

    it.each(['0', '', '  ', 'false', 'no', '-1', '1.5', 'never', 'OFF'])(
      'refuses %s rather than silently never deleting anything again',
      (value) => {
        // This is the failure nobody notices, because its only symptom is that nothing
        // happens. `z.coerce.number()` reads '' as 0, so a dangling
        // `RETENTION_SWEEP_INTERVAL_MINUTES=` in a compose file would have switched off a
        // deletion the host promised their guests. Disabling retention takes a word.
        const issues = refusalIssues({ [NAME]: value })

        expect(issues.some((issue) => issue.startsWith(`${NAME}: `))).toBe(true)
      },
    )

    it('refuses an interval longer than a day, which is indistinguishable from off', () => {
      const issues = refusalIssues({ [NAME]: '1441' })

      expect(issues.some((issue) => issue.startsWith(`${NAME}: `))).toBe(true)
    })

    it('accepts the boundaries', () => {
      expect(loadConfig({ [NAME]: '1' }).retention.sweepIntervalMs).toBe(60_000)
      expect(loadConfig({ [NAME]: '1440' }).retention.sweepIntervalMs).toBe(86_400_000)
    })

    it('names the variable and both accepted shapes when it refuses', () => {
      // The operator reading this is looking at a boot that exited 78 an hour before the
      // guests arrive. The message has to say what to type.
      const issues = refusalIssues({ [NAME]: 'yes' })
      const issue = issues.find((candidate) => candidate.startsWith(`${NAME}: `)) ?? ''

      expect(issue).toContain('1 to 1440')
      expect(issue).toContain("'off'")
    })
  })

  describe('the scheduling sweep interval', () => {
    const NAME = 'SCHEDULE_SWEEP_INTERVAL_MINUTES'

    it('sweeps every five minutes with nothing configured', () => {
      // The lag a guest can see: an event scheduled for 18:00 opens somewhere in
      // 18:00-18:05, and anyone scanning the QR code before it does is told the party
      // has not started. A default of off would ship the same lie retention told before
      // it had a trigger — two fields the host can set and nothing that acts on them.
      expect(loadConfig({}).schedule.sweepIntervalMs).toBe(300_000)
      expect(loadConfig(aProductionEnv()).schedule.sweepIntervalMs).toBe(300_000)
    })

    it('never sweeps under NODE_ENV=test unless asked', () => {
      // A sweep firing between two steps of a journey would open — or close — the event
      // the spec is asserting on, on a timer nothing in the test can see.
      expect(loadConfig({ NODE_ENV: 'test' }).schedule.sweepIntervalMs).toBeNull()
    })

    it('converts the configured interval from minutes to milliseconds', () => {
      expect(loadConfig({ [NAME]: '15' }).schedule.sweepIntervalMs).toBe(900_000)
    })

    it("turns the sweep off for the word 'off', which is the only way to turn it off", () => {
      expect(loadConfig({ [NAME]: 'off' }).schedule.sweepIntervalMs).toBeNull()
    })

    it('leaves the retention sweep alone, because they are two separate decisions', () => {
      const config = loadConfig({ [NAME]: 'off' })

      expect(config.retention.sweepIntervalMs).toBe(3_600_000)
    })

    it.each(['0', '', '  ', '-1', '1.5', 'never', 'OFF', '1441'])(
      'refuses %p rather than silently never opening anything again',
      (value) => {
        const issues = refusalIssues({ [NAME]: value })

        expect(issues.some((issue) => issue.startsWith(`${NAME}: `))).toBe(true)
      },
    )

    it('accepts the boundaries', () => {
      expect(loadConfig({ [NAME]: '1' }).schedule.sweepIntervalMs).toBe(60_000)
      expect(loadConfig({ [NAME]: '1440' }).schedule.sweepIntervalMs).toBe(86_400_000)
    })

    it('names the variable and both accepted shapes when it refuses', () => {
      const issues = refusalIssues({ [NAME]: 'yes' })
      const issue = issues.find((candidate) => candidate.startsWith(`${NAME}: `)) ?? ''

      expect(issue).toContain('1 to 1440')
      expect(issue).toContain("'off'")
    })
  })
})
