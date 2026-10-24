import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ConfigError, loadConfig, loadMaintenanceConfig, resolveSourceUrl } from './env'
import { ClientCeilings } from '../../domain/clients/clientCeilings'
import { OPERATOR_NAME_MAX_LENGTH } from '../../domain/privacy/privacyNotice'
import { Password } from '../../domain/users/password'

/**
 * The source of the configuration module as one string (every file of this folder but the tests): the
 * schema is in several files now, and what a test reading it means is "the module says this".
 */
const configSource = (): string =>
  readdirSync(__dirname)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .sort()
    .map((name) => readFileSync(join(__dirname, name), 'utf8'))
    .join('\n')

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

/**
 * Development has to say so now.
 *
 * `NODE_ENV` defaults to `production`, so an empty source is a production boot and is
 * refused for want of secrets — which is the point of the default and has a test of its
 * own below. Every case here that is about a coercion, a ceiling or a default rather than
 * about the environment spreads this first, and any case that names its own `NODE_ENV`
 * overrides it.
 */
const DEV: Source = { NODE_ENV: 'development' }

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
      const config = loadConfig({ ...DEV })

      expect(config).toEqual({
        env: 'development',
        isProduction: false,
        port: 4300,
        publicUrl: 'http://localhost:5173',
        logLevel: 'info',
        trustProxyHops: 0,
        // Generated for this boot, so there is no constant to write down here. The two
        // properties that matter — that they differ, and that they are not a value this
        // repository publishes — have tests of their own below.
        secrets: {
          session: expect.any(String),
          guestToken: expect.any(String),
          generated: ['SESSION_SECRET', 'GUEST_TOKEN_SECRET'],
        },
        session: { secureCookie: false },
        storage: {
          databasePath: './data/eventslide.sqlite',
          mediaRoot: './media',
          backupDir: './backups',
          minFreeDiskBytes: 1_000_000_000,
          sqliteShutdownCheckpoint: 'truncate',
        },
        uploads: {
          maxBytes: 25_000_000,
          maxFiles: 20,
          maxPixels: 50_000_000,
          defaultEventQuotaBytes: 5_000_000_000,
          maxEventQuotaBytes: null,
          maxConcurrentRequests: 4,
        },
        clips: {
          maxBytes: 80_000_000,
          maxDurationMs: 15_000,
          maxQueuedClips: 20,
          maxQueuedClipsPerEvent: 20,
          maxHeight: 720,
          maxPixels: 33_177_600,
          ffmpegPath: null,
          ffprobePath: null,
          // `PATH` and `PATHEXT` are carried as values because this module is the only
          // one allowed to read the environment at all, and the binary resolver needs
          // them: `spawn` is never given a shell, so Node does not apply `PATHEXT` and a
          // bare `ffmpeg` fails where `ffmpeg.exe` is on the path. An empty source object
          // therefore means "search nowhere", which is exactly what it should mean.
          executableSearch: { path: '', extensions: '' },
          // The raw material for `minimalChildEnv` (menace T9, `docs/SECURITY.md` §4.1):
          // carried as values for the same reason as `executableSearch` just above, and
          // an empty source object means "nothing beyond PATH and LANG=C", which is
          // exactly what an operator who named none of these should get.
          childEnvSource: {
            path: '',
            pathExt: '',
            systemRoot: '',
            winDir: '',
            temp: '',
            tmp: '',
          },
        },
        realtime: {
          maxStreamsPerClient: 12,
          maxStreamsTotal: 500,
          maxSubscribersPerEvent: 200,
        },
        retention: { sweepIntervalMs: 3_600_000, capNoticeDays: 30 },
        schedule: { sweepIntervalMs: 300_000 },
        rateLimits: {
          uploadPerMinute: 12,
          joinPerMinute: 20,
          loginPerMinute: 10,
          reactionPerMinute: 30,
          guestWritePerMinute: 300,
          galleryPerMinute: 120,
          galleryMediaPerMinute: 3000,
          galleryUnlockPerClient: 10,
          galleryUnlockPerLink: 50,
          eventCreationPerHour: 20,
        },
        crypto: { bcryptCost: 12 },
        bootstrap: { ownerEmail: null, ownerPassword: null },
        e2eHooks: false,
        siteAdmin: false,
        operatorResetLinks: 'mailOnly',
        source: { url: null, ref: null },
        support: { donationUrl: null, budgetUrl: null },
        operator: {
          name: null,
          contactEmail: null,
          termsUrl: null,
          privacyUrl: null,
          legalNoticeUrl: null,
          supportUrl: null,
          reportUrl: null,
        },
        // Neither the address nor the version: an invitation asks for no terms (G2-20).
        termsOfUse: null,
        events: {
          slugSuffix: 'none',
          allowCustomSlugs: true,
          joinCodeLength: 6,
          creation: 'anyAccount',
        },
        // No relay: the composition root wires `NullMailer` and a caller shows a link to copy.
        mail: { smtp: null },
        // A development boot never gets a warning: every case below is production-only.
        warnings: [],
        audit: { retentionDays: 1095 },
        // No ceiling for a client, and clips allowed: a box that sets none of them is unchanged.
        newClientCeilings: {
          maxEvents: null,
          maxEventsPerPeriod: null,
          maxTotalBytes: null,
          maxEventQuotaBytes: null,
          maxRetentionDays: null,
          maxLiveDays: null,
          clipsAllowed: true,
        },
        // Nobody has set a key, and nobody is required to hold a second factor.
        mfa: { encryptionKey: null, requireOperatorSecondFactor: false },
      })
    })

    it('gives development two different fallback secrets, so a guest cookie cannot be replayed as a session', () => {
      const config = loadConfig({ ...DEV })

      expect(config.secrets.session).not.toBe(config.secrets.guestToken)
    })

    it('never signs a development boot with a value this repository publishes', () => {
      // The defect this replaced: two constants lived in env.ts, so every reader of the
      // repository held the key to any instance that reached them. A generated secret is
      // what makes "a box booting with a repo-public secret" impossible rather than
      // discouraged — there is no longer such a value for any configuration to select.
      const first = loadConfig({ ...DEV })
      const second = loadConfig({ ...DEV })

      expect(first.secrets.session).not.toBe(second.secrets.session)
      expect(first.secrets.guestToken).not.toBe(second.secrets.guestToken)
    })

    it('names both secrets as generated when a boot configures neither', () => {
      // `src/main/index.ts` turns this into the one boot line that says which
      // arrangement is in force — docs/SECURITY.md §14.7 recorded that nothing did.
      expect(loadConfig({ ...DEV }).secrets.generated).toEqual([
        'SESSION_SECRET',
        'GUEST_TOKEN_SECRET',
      ])
    })

    it('names nothing when both are configured, so the warning is silent where it should be', () => {
      expect(loadConfig(aProductionEnv()).secrets.generated).toEqual([])
    })

    it('names only the half that was generated, because only that half dies with the process', () => {
      // A developer who set SESSION_SECRET keeps their sign-in across a reload and loses
      // every guest token. One boolean told them both were going.
      expect(loadConfig({ ...DEV, SESSION_SECRET: A_REAL_SECRET }).secrets.generated).toEqual([
        'GUEST_TOKEN_SECRET',
      ])
    })

    it('makes both development fallback secrets long enough for the HMAC token service to accept', () => {
      const config = loadConfig({ ...DEV })

      // createHmacGuestTokenService refuses a secret under 32 characters, so a
      // fallback shorter than that would make `npm run dev` crash on the first join.
      expect(config.secrets.session.length).toBeGreaterThanOrEqual(32)
      expect(config.secrets.guestToken.length).toBeGreaterThanOrEqual(32)
    })

    it('strips a trailing slash from PUBLIC_URL, so a join QR code cannot contain a double slash', () => {
      const config = loadConfig({ ...DEV, PUBLIC_URL: 'https://photos.example.com///' })

      expect(config.publicUrl).toBe('https://photos.example.com')
    })

    describe('GUEST_SELF_DELETE_GRACE_SECONDS, deprecated and read by nothing', () => {
      // The grace is a setting of each event. The key was validated, mapped into the config and
      // read by no one, so it is kept parsing (a box that sets it boots as it did), warned about,
      // and listed under Deprecated in the 3.0.0 entry; docs/UPGRADING.md says why it is not just
      // gone: a documented setting is removed in a major, after a deprecation.
      it('still boots with it, and no longer carries it in the configuration', () => {
        const config = loadConfig({ ...DEV, GUEST_SELF_DELETE_GRACE_SECONDS: '60' })

        expect(config).not.toHaveProperty('guests')
      })

      it('says at boot that it does nothing, in every environment', () => {
        for (const env of [
          { ...DEV, GUEST_SELF_DELETE_GRACE_SECONDS: '60' },
          aProductionEnv({ TRUST_PROXY_HOPS: '1', GUEST_SELF_DELETE_GRACE_SECONDS: '60' }),
        ]) {
          const { warnings } = loadConfig(env)

          expect(warnings).toHaveLength(1)
          expect(warnings[0]).toContain('GUEST_SELF_DELETE_GRACE_SECONDS is deprecated')
        }
      })

      it('says nothing when it is not set', () => {
        expect(loadConfig({ ...DEV }).warnings).toEqual([])
      })

      it('still refuses a value it always refused, so a box does not start booting with a typo', () => {
        expect(() => loadConfig({ ...DEV, GUEST_SELF_DELETE_GRACE_SECONDS: '86401' })).toThrow(
          ConfigError,
        )
      })
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
        ...DEV,
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
      const config = loadConfig({ ...DEV, NODE_ENV: 'test', E2E_HOOKS: given })

      expect(config.e2eHooks).toBe(expected)
    })
  })

  describe('each variable reaches its own field', () => {
    it('never crosses two numeric limits, which sharing a default would hide', () => {
      // Every value here is distinct, so a field reading the wrong variable fails —
      // MAX_FILES_PER_UPLOAD and JOIN_RATE_LIMIT_PER_MINUTE both default to 20, so a
      // test built from defaults would pass with those two swapped.
      const config = loadConfig({
        ...DEV,
        PORT: '4301',
        TRUST_PROXY_HOPS: '3',
        MAX_UPLOAD_BYTES: '1111',
        MAX_FILES_PER_UPLOAD: '7',
        MAX_IMAGE_PIXELS: '2222',
        DEFAULT_EVENT_QUOTA_BYTES: '3333',
        MAX_CONCURRENT_UPLOAD_REQUESTS: '8',
        MIN_FREE_DISK_BYTES: '4444',
        UPLOAD_RATE_LIMIT_PER_MINUTE: '101',
        JOIN_RATE_LIMIT_PER_MINUTE: '102',
        LOGIN_RATE_LIMIT_PER_MINUTE: '103',
        REACTION_RATE_LIMIT_PER_MINUTE: '104',
        GUEST_WRITE_RATE_LIMIT_PER_MINUTE: '110',
        GALLERY_RATE_LIMIT_PER_MINUTE: '105',
        GALLERY_MEDIA_RATE_LIMIT_PER_MINUTE: '106',
        GALLERY_UNLOCK_ATTEMPTS_PER_CLIENT: '107',
        GALLERY_UNLOCK_ATTEMPTS_PER_LINK: '108',
        // Distinct from JOIN_RATE_LIMIT_PER_MINUTE's default on purpose: both default
        // to 20, so a field reading the wrong one would pass against two defaults.
        EVENT_CREATION_RATE_LIMIT_PER_HOUR: '109',
        BCRYPT_COST: '14',
        JOIN_CODE_LENGTH: '9',
        MAX_QUEUED_CLIPS: '112',
        MAX_QUEUED_CLIPS_PER_EVENT: '15',
        MAX_STREAMS_PER_CLIENT: '16',
        MAX_STREAMS_TOTAL: '110',
        MAX_SUBSCRIBERS_PER_EVENT: '111',
      })

      expect(config).toMatchObject({
        port: 4301,
        trustProxyHops: 3,
        uploads: {
          maxBytes: 1111,
          maxFiles: 7,
          maxPixels: 2222,
          defaultEventQuotaBytes: 3333,
          maxConcurrentRequests: 8,
        },
        storage: { minFreeDiskBytes: 4444 },
        clips: {
          maxQueuedClips: 112,
          maxQueuedClipsPerEvent: 15,
        },
        realtime: {
          maxStreamsPerClient: 16,
          maxStreamsTotal: 110,
          maxSubscribersPerEvent: 111,
        },
        rateLimits: {
          uploadPerMinute: 101,
          joinPerMinute: 102,
          loginPerMinute: 103,
          reactionPerMinute: 104,
          guestWritePerMinute: 110,
          galleryPerMinute: 105,
          galleryMediaPerMinute: 106,
          galleryUnlockPerClient: 107,
          galleryUnlockPerLink: 108,
          eventCreationPerHour: 109,
        },
        crypto: { bcryptCost: 14 },
        events: { joinCodeLength: 9 },
      })
    })

    it('carries SYSTEMROOT, WINDIR, TEMP and TMP through as values, for the same reason as PATH and PATHEXT', () => {
      // Four distinct values, so a field reading the wrong variable — or `minimalChildEnv`
      // one day being handed this object with two keys swapped — fails loudly rather than
      // happening to agree, the way four identical placeholders would let it.
      const config = loadConfig({
        ...DEV,
        PATH: '/usr/bin',
        PATHEXT: '.EXE',
        SYSTEMROOT: 'C:\\Windows-root',
        WINDIR: 'C:\\Windows-dir',
        TEMP: 'C:\\Windows-temp',
        TMP: 'C:\\Windows-tmp',
      })

      expect(config.clips.childEnvSource).toEqual({
        path: '/usr/bin',
        pathExt: '.EXE',
        systemRoot: 'C:\\Windows-root',
        winDir: 'C:\\Windows-dir',
        temp: 'C:\\Windows-temp',
        tmp: 'C:\\Windows-tmp',
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
          BACKUP_DIR: '/srv/eventslide/backups',
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
          backupDir: '/srv/eventslide/backups',
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

  describe('the environment nobody named', () => {
    /**
     * The security default of the whole module, and the one an operator reaches by
     * saying nothing at all. It used to be `development`, which turned off five controls
     * at once: both signing secrets fell back to constants published in this repository,
     * the session cookie lost `Secure`, HSTS and `upgrade-insecure-requests` were not
     * sent, and `script-src` admitted `'unsafe-inline'`.
     */
    it('is production, so a box that was never told which environment it is in gets the strict posture', () => {
      const config = loadConfig({
        SESSION_SECRET: A_REAL_SECRET,
        GUEST_TOKEN_SECRET: ANOTHER_REAL_SECRET,
      })

      expect(config.env).toBe('production')
      expect(config.isProduction).toBe(true)
    })

    it('carries the strict posture into the session cookie, which is the control an operator cannot see is off', () => {
      const config = loadConfig({
        SESSION_SECRET: A_REAL_SECRET,
        GUEST_TOKEN_SECRET: ANOTHER_REAL_SECRET,
      })

      expect(config.session.secureCookie).toBe(true)
    })

    it('refuses to boot at all when it has no secrets either, rather than inventing two', () => {
      const issues = refusalIssues({})

      expect(issues).toContain('SESSION_SECRET: SESSION_SECRET is required in production')
      expect(issues).toContain('GUEST_TOKEN_SECRET: GUEST_TOKEN_SECRET is required in production')
    })

    it.each(['SESSION_SECRET', 'GUEST_TOKEN_SECRET'])(
      'reads a blank %s as absent, so a dangling variable is named as missing rather than as short',
      (name) => {
        // `scripts/verify-image.sh` greps the image's refusal for "is required in
        // production". A blank that fell through to the 32-character floor would leave
        // that check reading as one assertion and making another.
        const issues = refusalIssues({ [name]: '' })

        expect(issues).toContain(`${name}: ${name} is required in production`)
      },
    )

    it('reads a blank NODE_ENV as absent, so a dangling compose variable cannot relax the posture', () => {
      // The `Number('')` lesson from the sweep intervals, applied to the one variable
      // whose absence used to be the weak answer: a template that rendered empty must
      // land on the strict default like any other absence, not on an enum error and not
      // on development.
      const issues = refusalIssues({ NODE_ENV: '' })

      expect(issues).toContain('SESSION_SECRET: SESSION_SECRET is required in production')
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

    it.each([
      'HTTP://photos.example.com',
      'Http://photos.example.com',
      'hTtP://photos.example.com',
      'HTTP://photos.example.com:8080/',
    ])(
      'refuses a plain-http PUBLIC_URL however its scheme is cased (%s), because a scheme is not case-sensitive',
      (url) => {
        // The scheme check that admits the value is case-insensitive; this one read the
        // typed prefix, so `HTTP://` got past it and guests were handed an http join link
        // that a Secure session cookie is never sent over.
        const issues = refusalIssues(aProductionEnv({ PUBLIC_URL: url }))

        expect(issues).toEqual([expect.stringContaining('PUBLIC_URL must use https in production')])
      },
    )

    it.each([
      'HTTPS://photos.example.com',
      'Https://Photos.Example.com/',
      'hTTpS://photos.example.com:8443',
    ])('accepts an https PUBLIC_URL however its scheme is cased (%s)', (url) => {
      const config = loadConfig(aProductionEnv({ PUBLIC_URL: url }))

      expect(config.isProduction).toBe(true)
    })

    it.each(['HTTP://localhost:4300', 'Http://localhost:4300', 'http://LOCALHOST:4300'])(
      'keeps the localhost exemption whatever the case of the scheme or the host (%s)',
      (url) => {
        const config = loadConfig(aProductionEnv({ PUBLIC_URL: url }))

        expect(config.isProduction).toBe(true)
      },
    )

    it.each([
      ['a host that only starts with localhost', 'http://localhost.example.com'],
      ['a host that merely continues the word', 'http://localhostx:4300'],
      ['a loopback address, which was never exempt', 'http://127.0.0.1:4300'],
      ['an IPv6 loopback address, which was never exempt', 'http://[::1]:4300'],
      ['a .localhost name, which was never exempt', 'http://app.localhost:4300'],
      ['the localhost name with a trailing dot', 'http://localhost.:4300'],
    ])('does not extend the localhost exemption to %s', (_name, url) => {
      const issues = refusalIssues(aProductionEnv({ PUBLIC_URL: url }))

      expect(issues).toEqual([expect.stringContaining('PUBLIC_URL must use https in production')])
    })

    it.each([
      ['a localhost user name in front of another host', 'http://localhost@photos.example.com'],
      ['a localhost user name, in capitals', 'HTTP://localhost:4300@photos.example.com'],
    ])('does not extend the localhost exemption to %s either', (_name, url) => {
      // These carry a user name, so the credentials rule refuses them as well and the list
      // is longer than one: the https rule must still be in it, because the host is not
      // localhost and a refusal for the credentials alone would be the wrong reason.
      const issues = refusalIssues(aProductionEnv({ PUBLIC_URL: url }))

      expect(issues).toContainEqual(
        expect.stringContaining('PUBLIC_URL must use https in production'),
      )
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
      ['BACKUP_DIR', ''],
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
      ['GUEST_WRITE_RATE_LIMIT_PER_MINUTE', '6001'],
      ['MAX_CONCURRENT_UPLOAD_REQUESTS', '1001'],
      ['MAX_QUEUED_CLIPS', '501'],
      ['MAX_QUEUED_CLIPS_PER_EVENT', '501'],
      ['MAX_STREAMS_PER_CLIENT', '10001'],
      ['MAX_STREAMS_TOTAL', '100001'],
      ['MAX_SUBSCRIBERS_PER_EVENT', '10001'],
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
      'MAX_CONCURRENT_UPLOAD_REQUESTS',
      'MIN_FREE_DISK_BYTES',
      'MAX_QUEUED_CLIPS_PER_EVENT',
      'MAX_STREAMS_PER_CLIENT',
      'MAX_STREAMS_TOTAL',
      'MAX_SUBSCRIBERS_PER_EVENT',
    ])('refuses %s=0, because a zero limit would refuse every upload silently', (name) => {
      const issues = refusalIssues({ [name]: '0' })

      expect(issues.some((issue) => issue.startsWith(`${name}: `))).toBe(true)
    })

    it.each(['TRUNCATE', 'Passive', 'wal'])(
      'refuses SQLITE_SHUTDOWN_CHECKPOINT=%s rather than guessing the intended mode',
      (value) => {
        const issues = refusalIssues({ SQLITE_SHUTDOWN_CHECKPOINT: value })

        expect(issues.some((issue) => issue.startsWith('SQLITE_SHUTDOWN_CHECKPOINT: '))).toBe(true)
      },
    )

    it('reads a blank SQLITE_SHUTDOWN_CHECKPOINT as absent, landing on the unconditional default', () => {
      const config = loadConfig({ ...DEV, SQLITE_SHUTDOWN_CHECKPOINT: '' })

      expect(config.storage.sqliteShutdownCheckpoint).toBe('truncate')
    })
  })

  describe('the box-wide quota ceiling (G3-02)', () => {
    it('is absent by default, which is the behaviour every self-hosted box has always had', () => {
      const config = loadConfig({ ...DEV })

      expect(config.uploads.maxEventQuotaBytes).toBeNull()
    })

    it('is carried as the configured number when set above the default', () => {
      const config = loadConfig({
        ...DEV,
        DEFAULT_EVENT_QUOTA_BYTES: '5000000000',
        MAX_EVENT_QUOTA_BYTES: '6000000000',
      })

      expect(config.uploads.maxEventQuotaBytes).toBe(6_000_000_000)
    })

    it('accepts a ceiling exactly equal to the default', () => {
      const config = loadConfig({
        ...DEV,
        DEFAULT_EVENT_QUOTA_BYTES: '5000000000',
        MAX_EVENT_QUOTA_BYTES: '5000000000',
      })

      expect(config.uploads.maxEventQuotaBytes).toBe(5_000_000_000)
    })

    it('refuses a ceiling below the default, because every event created with no opinion would already violate it', () => {
      const issues = refusalIssues({
        ...DEV,
        DEFAULT_EVENT_QUOTA_BYTES: '5000000000',
        MAX_EVENT_QUOTA_BYTES: '4999999999',
      })

      expect(issues.some((issue) => issue.startsWith('MAX_EVENT_QUOTA_BYTES: '))).toBe(true)
    })

    it('reads a blank MAX_EVENT_QUOTA_BYTES as absent rather than as a ceiling of zero', () => {
      const config = loadConfig({ ...DEV, MAX_EVENT_QUOTA_BYTES: '' })

      expect(config.uploads.maxEventQuotaBytes).toBeNull()
    })
  })

  /**
   * The ceilings a new client starts with (G2-18 / roadmap §10.5): seven optional variables,
   * parsed at boot and refused, naming the variable, when they do not fit.
   *
   * The posture is the one `MAX_EVENT_QUOTA_BYTES` has, and it is the whole point: **a box
   * that sets none of them is unchanged**, and one that sets them with `SITE_ADMIN=off` does
   * not boot, because there is no way to create a client for them to apply to.
   */
  describe('NEW_CLIENT_*, the ceilings a new client starts with (G2-18)', () => {
    /** Every numeric variable: its field in the config, and the bounds of its `CHECK`. */
    const NUMERIC = [
      ['NEW_CLIENT_MAX_EVENTS', 'maxEvents', 1, Number.MAX_SAFE_INTEGER],
      ['NEW_CLIENT_MAX_EVENTS_PER_PERIOD', 'maxEventsPerPeriod', 1, Number.MAX_SAFE_INTEGER],
      ['NEW_CLIENT_MAX_TOTAL_BYTES', 'maxTotalBytes', 1, Number.MAX_SAFE_INTEGER],
      ['NEW_CLIENT_MAX_EVENT_QUOTA_BYTES', 'maxEventQuotaBytes', 1, Number.MAX_SAFE_INTEGER],
      ['NEW_CLIENT_MAX_RETENTION_DAYS', 'maxRetentionDays', 1, 3650],
      ['NEW_CLIENT_MAX_LIVE_DAYS', 'maxLiveDays', 1, 365],
    ] as const

    /** Every variable of the family, which is what `SITE_ADMIN=off` refuses. */
    const ALL = [...NUMERIC.map(([name]) => name), 'NEW_CLIENT_CLIPS_ALLOWED'] as const

    /** A box that has an operator, which is the only kind that may set any of them. */
    const hosted = (overrides: Source = {}): Source =>
      aProductionEnv({ SITE_ADMIN: 'on', ...overrides })

    const UNLIMITED = {
      maxEvents: null,
      maxEventsPerPeriod: null,
      maxTotalBytes: null,
      maxEventQuotaBytes: null,
      maxRetentionDays: null,
      maxLiveDays: null,
      clipsAllowed: true,
    }

    it('is no ceiling at all on a box that never mentions them, so a self-hosted box is unchanged', () => {
      expect(loadConfig({ ...DEV }).newClientCeilings).toEqual(UNLIMITED)
      expect(loadConfig(aProductionEnv()).newClientCeilings).toEqual(UNLIMITED)
      expect(loadConfig(hosted()).newClientCeilings).toEqual(UNLIMITED)
    })

    it('is what the domain calls unlimited, so the two cannot drift apart', () => {
      // `liveAllowed` and `periodStartedAt` have no variable: a new client is always allowed
      // to open, and its period starts when it is provisioned.
      expect(ClientCeilings.unlimited().toProps()).toMatchObject(UNLIMITED)
    })

    it.each(NUMERIC)('carries %s as the number it was given', (name, field) => {
      const config = loadConfig(hosted({ [name]: '12' }))

      expect(config.newClientCeilings).toEqual({ ...UNLIMITED, [field]: 12 })
    })

    it.each(NUMERIC)(
      'accepts %s at both ends of its range, and nothing past either',
      (name, field, min, max) => {
        expect(loadConfig(hosted({ [name]: String(min) })).newClientCeilings).toMatchObject({
          [field]: min,
        })
        expect(loadConfig(hosted({ [name]: String(max) })).newClientCeilings).toMatchObject({
          [field]: max,
        })
        expect(refusalIssues(hosted({ [name]: String(min - 1) })).join('\n')).toContain(`${name}: `)
        // `max + 1` is not representable for the byte counts, so the first value past a safe
        // integer stands for it there; for the day counts it is simply the next integer.
        const past = max === Number.MAX_SAFE_INTEGER ? '9007199254740993' : String(max + 1)
        expect(refusalIssues(hosted({ [name]: past })).join('\n')).toContain(`${name}: `)
      },
    )

    it('accepts every variable at the edge of its range together, and the domain accepts what they produce', () => {
      const config = loadConfig(
        hosted({
          NEW_CLIENT_MAX_EVENTS: '1',
          NEW_CLIENT_MAX_EVENTS_PER_PERIOD: String(Number.MAX_SAFE_INTEGER),
          NEW_CLIENT_MAX_TOTAL_BYTES: '1',
          NEW_CLIENT_MAX_EVENT_QUOTA_BYTES: '1',
          NEW_CLIENT_MAX_RETENTION_DAYS: '3650',
          NEW_CLIENT_MAX_LIVE_DAYS: '365',
          NEW_CLIENT_CLIPS_ALLOWED: 'false',
        }),
      )

      // The refusal at boot and the refusal of `ClientCeilings.create` are one rule, or a
      // default that boots would fail on the first client an operator provisions.
      expect(ClientCeilings.create(config.newClientCeilings).ok).toBe(true)
    })

    it.each(ALL)(
      'reads a blank %s as absent, so an empty compose variable is no ceiling of zero',
      (name) => {
        expect(loadConfig(hosted({ [name]: '' })).newClientCeilings).toEqual(UNLIMITED)
        // Blank is absent for the mode check too: a compose file that passes every variable
        // empty must not stop a box that has no operator.
        expect(loadConfig({ ...DEV, [name]: '' }).newClientCeilings).toEqual(UNLIMITED)
      },
    )

    it.each([
      ['0', false],
      ['false', false],
      ['1', true],
      ['true', true],
    ])('reads NEW_CLIENT_CLIPS_ALLOWED=%s as clipsAllowed %s', (given, expected) => {
      const config = loadConfig(hosted({ NEW_CLIENT_CLIPS_ALLOWED: given }))

      expect(config.newClientCeilings.clipsAllowed).toBe(expected)
    })

    it.each(['yes', 'no', 'on', 'off', 'TRUE', 'False', '2', '-1', 'allowed', ' true'])(
      'refuses NEW_CLIENT_CLIPS_ALLOWED=%j rather than guess which way it was meant',
      (given) => {
        const issues = refusalIssues(hosted({ NEW_CLIENT_CLIPS_ALLOWED: given }))

        expect(issues.some((issue) => issue.startsWith('NEW_CLIENT_CLIPS_ALLOWED: '))).toBe(true)
      },
    )

    describe.each(NUMERIC)('%s, hostile values', (name) => {
      it.each([
        '0',
        '-1',
        '1.5',
        '0.5',
        'abc',
        'one',
        'NaN',
        'Infinity',
        '-Infinity',
        '1e999',
        ' ',
        '1 2',
        '12abc',
        '9007199254740993',
        '99999999999999999999',
      ])('refuses %j, naming the variable', (given) => {
        const issues = refusalIssues(hosted({ [name]: given }))

        expect(issues.some((issue) => issue.startsWith(`${name}: `))).toBe(true)
      })

      it('names itself in the message too, so a log line read without its prefix still says which', () => {
        const issue =
          refusalIssues(hosted({ [name]: 'abc' })).find((line) => line.startsWith(`${name}: `)) ??
          ''

        expect(issue.slice(name.length + 2)).toContain(name)
      })
    })

    describe('with SITE_ADMIN off, which is its default', () => {
      it.each(ALL)('refuses %s, naming it and the setting that would allow it', (name) => {
        // `1` is a valid value for every variable of the family: the refusal is that the
        // variable is set at all, whatever it says.
        const issues = refusalIssues({ ...DEV, [name]: '1' })
        const issue = issues.find((line) => line.startsWith(`${name}: `)) ?? ''

        expect(issue).toContain('SITE_ADMIN=on')
      })

      it.each(ALL)('refuses %s beside an explicit SITE_ADMIN=off, in production too', (name) => {
        const issues = refusalIssues(aProductionEnv({ SITE_ADMIN: 'off', [name]: '1' }))

        expect(issues.some((line) => line.startsWith(`${name}: `))).toBe(true)
      })

      it('refuses a permissive value as much as a restrictive one: setting it is the error', () => {
        const issues = refusalIssues({ ...DEV, NEW_CLIENT_CLIPS_ALLOWED: 'true' })

        expect(issues.some((line) => line.startsWith('NEW_CLIENT_CLIPS_ALLOWED: '))).toBe(true)
      })

      it('lists every variable that is set, instead of stopping at the first', () => {
        const issues = refusalIssues({
          ...DEV,
          NEW_CLIENT_MAX_EVENTS: '1',
          NEW_CLIENT_MAX_LIVE_DAYS: '3',
          NEW_CLIENT_CLIPS_ALLOWED: 'false',
        })

        const named = ALL.filter((name) => issues.some((line) => line.startsWith(`${name}: `)))
        expect(named).toEqual([
          'NEW_CLIENT_MAX_EVENTS',
          'NEW_CLIENT_MAX_LIVE_DAYS',
          'NEW_CLIENT_CLIPS_ALLOWED',
        ])
      })

      it('refuses every NEW_CLIENT_ key the schema declares, and the list this file keeps is that schema’s', () => {
        // The refusal reads the family by its prefix so that a key added later is covered
        // without anybody remembering to extend a list. This holds the other half: the
        // family this file lists is the family the schema has, so a new variable that
        // arrives with no test of its own still meets the mode check.
        const declared = [...configSource().matchAll(/^ {6}(NEW_CLIENT_[A-Z0-9_]+):/gm)].map(
          (match) => match[1] ?? '',
        )

        expect(declared.length).toBeGreaterThan(0)
        expect([...declared].sort()).toEqual([...ALL].sort())
        for (const name of declared) {
          expect(
            refusalIssues({ ...DEV, [name]: '1' }).some((line) => line.startsWith(`${name}: `)),
            name,
          ).toBe(true)
        }
      })

      it('is refused by a maintenance command too, since db:migrate loads the same configuration', () => {
        expect(() =>
          loadMaintenanceConfig({ NODE_ENV: 'production', NEW_CLIENT_MAX_EVENTS: '1' }),
        ).toThrow(ConfigError)
      })
    })

    describe('a name this version does not read', () => {
      // A misspelt ceiling is not a setting, and a schema drops a key it does not declare without
      // a word: the box would boot with no ceiling at all for every new client.
      it.each([
        'NEW_CLIENT_MAX_EVENT',
        'NEW_CLIENT_MAX_EVENTS_PER_YEAR',
        'NEW_CLIENT_CLIP_ALLOWED',
        'NEW_CLIENT_MAX_LIVE_DAY',
        'NEW_CLIENT_',
      ])('refuses %s, naming it and the seven it may have meant, with SITE_ADMIN on', (name) => {
        const issues = refusalIssues(hosted({ [name]: '3' }))
        const issue = issues.find((line) => line.startsWith(`${name}: `)) ?? ''

        for (const known of ALL) expect(issue, known).toContain(known)
      })

      it('refuses it with SITE_ADMIN off too, and in a maintenance command', () => {
        expect(
          refusalIssues({ ...DEV, NEW_CLIENT_MAX_EVENT: '3' }).some((line) =>
            line.startsWith('NEW_CLIENT_MAX_EVENT: '),
          ),
        ).toBe(true)
        expect(() =>
          loadMaintenanceConfig({ NODE_ENV: 'production', NEW_CLIENT_MAX_EVENT: '3' }),
        ).toThrow(ConfigError)
      })

      it('refuses it even when its value is empty: the name is the mistake', () => {
        const issues = refusalIssues(hosted({ NEW_CLIENT_MAX_EVENT: '' }))

        expect(issues.some((line) => line.startsWith('NEW_CLIENT_MAX_EVENT: '))).toBe(true)
      })

      it('never prints the value it was given', () => {
        const issues = refusalIssues(hosted({ NEW_CLIENT_MAX_EVENT: 'a-pasted-secret-value' }))

        expect(JSON.stringify(issues)).not.toContain('a-pasted-secret-value')
      })

      it('is listed beside the other problems, so one restart shows them all', () => {
        const issues = refusalIssues(
          hosted({ NEW_CLIENT_MAX_EVENT: '3', NEW_CLIENT_MAX_LIVE_DAYS: '366' }),
        )

        expect(issues.some((line) => line.startsWith('NEW_CLIENT_MAX_EVENT: '))).toBe(true)
        expect(issues.some((line) => line.startsWith('NEW_CLIENT_MAX_LIVE_DAYS: '))).toBe(true)
      })

      it('leaves alone a name that merely contains the prefix, which is nobody’s ceiling', () => {
        const config = loadConfig(
          hosted({ MY_NEW_CLIENT_MAX_EVENTS: '3', OLD_CLIENT_MAX_EVENTS: '3', new_client_x: '3' }),
        )

        expect(config.newClientCeilings).toEqual(UNLIMITED)
      })
    })

    describe('how a number is read', () => {
      it('reads exponent notation as the sibling MAX_EVENT_QUOTA_BYTES does, so 5e9 is five billion', () => {
        const config = loadConfig(hosted({ NEW_CLIENT_MAX_EVENT_QUOTA_BYTES: '5e9' }))

        expect(config.newClientCeilings.maxEventQuotaBytes).toBe(5_000_000_000)
      })

      it('accepts a per-event default above the total, which the total simply binds first', () => {
        const config = loadConfig(
          hosted({
            NEW_CLIENT_MAX_TOTAL_BYTES: '1000000000',
            NEW_CLIENT_MAX_EVENT_QUOTA_BYTES: '5000000000',
          }),
        )

        expect(config.newClientCeilings).toMatchObject({
          maxTotalBytes: 1_000_000_000,
          maxEventQuotaBytes: 5_000_000_000,
        })
      })
    })

    describe('against the box-wide ceiling, MAX_EVENT_QUOTA_BYTES', () => {
      const BOX = '5000000000'

      it('accepts a default equal to the box-wide ceiling: it is the most a client could ever have', () => {
        const config = loadConfig(
          hosted({ MAX_EVENT_QUOTA_BYTES: BOX, NEW_CLIENT_MAX_EVENT_QUOTA_BYTES: BOX }),
        )

        expect(config.newClientCeilings.maxEventQuotaBytes).toBe(5_000_000_000)
      })

      it('accepts a default below it', () => {
        const config = loadConfig(
          hosted({ MAX_EVENT_QUOTA_BYTES: BOX, NEW_CLIENT_MAX_EVENT_QUOTA_BYTES: '1000000000' }),
        )

        expect(config.newClientCeilings.maxEventQuotaBytes).toBe(1_000_000_000)
      })

      it('refuses a default one byte above it, naming both variables', () => {
        const issues = refusalIssues(
          hosted({ MAX_EVENT_QUOTA_BYTES: BOX, NEW_CLIENT_MAX_EVENT_QUOTA_BYTES: '5000000001' }),
        )
        const issue =
          issues.find((line) => line.startsWith('NEW_CLIENT_MAX_EVENT_QUOTA_BYTES: ')) ?? ''

        expect(issue).toContain('MAX_EVENT_QUOTA_BYTES')
        expect(issue).toContain('5000000001')
        expect(issue).toContain(BOX)
      })

      it('compares nothing when the box has no ceiling, which is every self-hosted box', () => {
        const config = loadConfig(hosted({ NEW_CLIENT_MAX_EVENT_QUOTA_BYTES: '900000000000' }))

        expect(config.newClientCeilings.maxEventQuotaBytes).toBe(900_000_000_000)
      })

      it('lets a default sit below DEFAULT_EVENT_QUOTA_BYTES: a new event is lowered to it, not refused', () => {
        // The reverse of the rule `MAX_EVENT_QUOTA_BYTES` is held to, on purpose: that ceiling
        // refuses a request, and `createEvent` clamps an event's default quota to a client's.
        const config = loadConfig(
          hosted({
            DEFAULT_EVENT_QUOTA_BYTES: '5000000000',
            NEW_CLIENT_MAX_EVENT_QUOTA_BYTES: '1000000000',
          }),
        )

        expect(config.newClientCeilings.maxEventQuotaBytes).toBe(1_000_000_000)
      })

      it('is listed beside every other problem, not instead of them', () => {
        const issues = refusalIssues(
          hosted({
            MAX_EVENT_QUOTA_BYTES: BOX,
            NEW_CLIENT_MAX_EVENT_QUOTA_BYTES: '9000000000',
            NEW_CLIENT_MAX_LIVE_DAYS: '366',
          }),
        )

        expect(issues.some((line) => line.startsWith('NEW_CLIENT_MAX_EVENT_QUOTA_BYTES: '))).toBe(
          true,
        )
        expect(issues.some((line) => line.startsWith('NEW_CLIENT_MAX_LIVE_DAYS: '))).toBe(true)
      })
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
      const config = loadConfig({ ...DEV, BOOTSTRAP_OWNER_EMAIL: '', BOOTSTRAP_OWNER_PASSWORD: '' })

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
        ...DEV,
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
      const config = loadConfig({ ...DEV })

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
      const config = loadConfig({ ...DEV, NODE_ENV: 'test' })

      expect(config.retention.sweepIntervalMs).toBeNull()
    })

    it('converts the configured interval from minutes to milliseconds', () => {
      const config = loadConfig({ ...DEV, [NAME]: '15' })

      expect(config.retention.sweepIntervalMs).toBe(900_000)
    })

    it('accepts an explicit interval under NODE_ENV=test, for a test that is about the sweep', () => {
      const config = loadConfig({ ...DEV, NODE_ENV: 'test', [NAME]: '5' })

      expect(config.retention.sweepIntervalMs).toBe(300_000)
    })

    it("turns the sweep off for the word 'off', which is the only way to turn it off", () => {
      const config = loadConfig({ ...DEV, [NAME]: 'off' })

      expect(config.retention.sweepIntervalMs).toBeNull()
    })

    it("ignores surrounding whitespace, which a compose file's quoting adds easily", () => {
      expect(loadConfig({ ...DEV, [NAME]: ' off ' }).retention.sweepIntervalMs).toBeNull()
      expect(loadConfig({ ...DEV, [NAME]: ' 30 ' }).retention.sweepIntervalMs).toBe(1_800_000)
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
      expect(loadConfig({ ...DEV, [NAME]: '1' }).retention.sweepIntervalMs).toBe(60_000)
      expect(loadConfig({ ...DEV, [NAME]: '1440' }).retention.sweepIntervalMs).toBe(86_400_000)
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

  describe('the retention ceiling notice', () => {
    const NAME = 'RETENTION_CAP_NOTICE_DAYS'

    it('is thirty days with nothing configured, in every environment', () => {
      expect(loadConfig({ ...DEV }).retention.capNoticeDays).toBe(30)
      expect(loadConfig(aProductionEnv()).retention.capNoticeDays).toBe(30)
    })

    it('takes the configured number of days', () => {
      expect(loadConfig({ ...DEV, [NAME]: '45' }).retention.capNoticeDays).toBe(45)
    })

    it('accepts both boundaries, a day and a year', () => {
      expect(loadConfig({ ...DEV, [NAME]: '1' }).retention.capNoticeDays).toBe(1)
      expect(loadConfig({ ...DEV, [NAME]: '365' }).retention.capNoticeDays).toBe(365)
    })

    it.each(['0', '-1', '1.5', 'never', '366'])(
      'refuses %p rather than purging with a notice nobody chose',
      (value) => {
        const issues = refusalIssues({ [NAME]: value })

        expect(issues.some((issue) => issue.startsWith(`${NAME}: `))).toBe(true)
      },
    )
  })

  describe('the scheduling sweep interval', () => {
    const NAME = 'SCHEDULE_SWEEP_INTERVAL_MINUTES'

    it('sweeps every five minutes with nothing configured', () => {
      // The lag a guest can see: an event scheduled for 18:00 opens somewhere in
      // 18:00-18:05, and anyone scanning the QR code before it does is told the party
      // has not started. A default of off would ship the same lie retention told before
      // it had a trigger — two fields the host can set and nothing that acts on them.
      expect(loadConfig({ ...DEV }).schedule.sweepIntervalMs).toBe(300_000)
      expect(loadConfig(aProductionEnv()).schedule.sweepIntervalMs).toBe(300_000)
    })

    it('never sweeps under NODE_ENV=test unless asked', () => {
      // A sweep firing between two steps of a journey would open — or close — the event
      // the spec is asserting on, on a timer nothing in the test can see.
      expect(loadConfig({ ...DEV, NODE_ENV: 'test' }).schedule.sweepIntervalMs).toBeNull()
    })

    it('converts the configured interval from minutes to milliseconds', () => {
      expect(loadConfig({ ...DEV, [NAME]: '15' }).schedule.sweepIntervalMs).toBe(900_000)
    })

    it("turns the sweep off for the word 'off', which is the only way to turn it off", () => {
      expect(loadConfig({ ...DEV, [NAME]: 'off' }).schedule.sweepIntervalMs).toBeNull()
    })

    it('leaves the retention sweep alone, because they are two separate decisions', () => {
      const config = loadConfig({ ...DEV, [NAME]: 'off' })

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
      expect(loadConfig({ ...DEV, [NAME]: '1' }).schedule.sweepIntervalMs).toBe(60_000)
      expect(loadConfig({ ...DEV, [NAME]: '1440' }).schedule.sweepIntervalMs).toBe(86_400_000)
    })

    it('names the variable and both accepted shapes when it refuses', () => {
      const issues = refusalIssues({ [NAME]: 'yes' })
      const issue = issues.find((candidate) => candidate.startsWith(`${NAME}: `)) ?? ''

      expect(issue).toContain('1 to 1440')
      expect(issue).toContain("'off'")
    })
  })

  /**
   * docs/ROADMAP.md §10.9: one product, with site administration off unless the box asks.
   *
   * The default is the half that carries the promise. §10.1 said an install that never
   * wanted any of this must behave exactly as it does today, and on a box whose compose
   * file predates the variable, "never wanted" is spelled as silence.
   */
  describe('the site administration switch', () => {
    const NAME = 'SITE_ADMIN'

    it('is off on a box that never mentions it, so a solo install mounts no operator surface', () => {
      expect(loadConfig({ ...DEV }).siteAdmin).toBe(false)
      expect(loadConfig(aProductionEnv()).siteAdmin).toBe(false)
    })

    it("is on for the word 'on', which is the only way to turn it on", () => {
      expect(loadConfig({ ...DEV, [NAME]: 'on' }).siteAdmin).toBe(true)
      expect(loadConfig(aProductionEnv({ [NAME]: 'on' })).siteAdmin).toBe(true)
    })

    it("is off for the word 'off', which is what compose.yaml sends when nothing is set", () => {
      expect(loadConfig(aProductionEnv({ [NAME]: 'off' })).siteAdmin).toBe(false)
    })

    it('reads a blank SITE_ADMIN as absent, so a dangling compose variable lands on off', () => {
      expect(loadConfig(aProductionEnv({ [NAME]: '' })).siteAdmin).toBe(false)
    })

    it.each(['ON', 'Off', 'yes', 'no', 'true', 'false', '1', '0', ' on', 'enabled'])(
      "refuses SITE_ADMIN='%s' rather than guessing which side of the switch was meant",
      (value) => {
        // Strict lower case, like NODE_ENV and LOG_LEVEL. A boolean spelling accepted here
        // would be a second vocabulary for one switch, and `yes` read as off is an operator
        // who believes their console is mounted and meets a 404 instead of a boot refusal.
        const issues = refusalIssues(aProductionEnv({ [NAME]: value }))

        expect(issues.some((issue) => issue.startsWith(`${NAME}: `))).toBe(true)
      },
    )

    it('names both accepted words when it refuses, beside every other problem at once', () => {
      const issues = refusalIssues({ ...DEV, [NAME]: 'yes', LOG_LEVEL: 'verbose' })
      const issue = issues.find((candidate) => candidate.startsWith(`${NAME}: `)) ?? ''

      expect(issue).toContain("'off'")
      expect(issue).toContain("'on'")
      expect(issues.some((candidate) => candidate.startsWith('LOG_LEVEL: '))).toBe(true)
    })
  })

  /**
   * G1-04 / P1-05, P1-06: the link AGPL section 13 obliges a network service to offer.
   *
   * It is rendered as an `<a href>` on every guest and host screen and printed by a public
   * endpoint, so the scheme is the security control: a `javascript:` value here is a
   * script URI behind a link every visitor is invited to press. The default is the half
   * that carries the licence, because a box that sets nothing must still offer the source
   * of the build it is running.
   */
  describe('the source offer (SOURCE_CODE_URL and SOURCE_REF)', () => {
    const VERSION = '7.8.9'
    const UPSTREAM = 'https://github.com/Irony42/EventSlide'

    const offeredBy = (source: Source): string =>
      resolveSourceUrl(VERSION, loadConfig({ ...DEV, ...source }).source)

    it('points at the tag of the running version upstream when the box says nothing', () => {
      expect(offeredBy({})).toBe(`${UPSTREAM}/tree/v7.8.9`)
    })

    it('does the same on a production box, since production is where the licence bites', () => {
      expect(resolveSourceUrl(VERSION, loadConfig(aProductionEnv()).source)).toBe(
        `${UPSTREAM}/tree/v7.8.9`,
      )
    })

    it('offers SOURCE_CODE_URL instead when the operator has set it', () => {
      expect(offeredBy({ SOURCE_CODE_URL: 'https://git.example.org/me/eventslide' })).toBe(
        'https://git.example.org/me/eventslide',
      )
    })

    it('canonicalises the address it accepts, so what is rendered is what was parsed', () => {
      expect(offeredBy({ SOURCE_CODE_URL: 'HTTPS://Git.Example.ORG' })).toBe(
        'https://git.example.org/',
      )
    })

    it('trims the whitespace a quoted compose value brings along', () => {
      expect(offeredBy({ SOURCE_CODE_URL: '  https://git.example.org/me/eventslide  ' })).toBe(
        'https://git.example.org/me/eventslide',
      )
    })

    it('reads a blank SOURCE_CODE_URL as absent, so a dangling compose variable keeps the default', () => {
      // `SOURCE_CODE_URL: ${SOURCE_CODE_URL:-}` renders an empty string when unset. Read as
      // a value it would be refused as not-a-URL and stop every default deployment.
      expect(offeredBy({ SOURCE_CODE_URL: '' })).toBe(`${UPSTREAM}/tree/v7.8.9`)
    })

    it.each([
      ['a javascript: URI', 'javascript:alert(document.cookie)'],
      ['a data: URI', 'data:text/html,<script>alert(1)</script>'],
      ['plain http', 'http://git.example.org/me/eventslide'],
      ['plain http on localhost', 'http://localhost:3000/eventslide'],
      ['an uppercase HTTP scheme', 'HTTP://git.example.org/me/eventslide'],
      ['a file: URI', 'file:///etc/passwd'],
      ['an ftp: address', 'ftp://git.example.org/eventslide'],
      ['a protocol-relative address', '//git.example.org/me/eventslide'],
      ['a path with no origin', '/me/eventslide'],
      ['something that is not a URL at all', 'the source is on my laptop'],
      ['credentials in the address', 'https://user:secret@git.example.org/me/eventslide'],
      ['a username with no password', 'https://token@git.example.org/me/eventslide'],
      [
        'a newline inside the address, which the URL parser would silently delete',
        'https://git.example.org/me/\nevent',
      ],
      ['a tab inside the address', 'https://git.example.org/me/\tevent'],
      ['a space inside the address', 'https://git.example.org/me/ event'],
    ])('refuses %s', (_name, value) => {
      const issues = refusalIssues({ ...DEV, SOURCE_CODE_URL: value })

      expect(issues.some((issue) => issue.startsWith('SOURCE_CODE_URL: '))).toBe(true)
    })

    it('names the variable and the rule when it refuses, beside every other problem at once', () => {
      const issues = refusalIssues({
        ...DEV,
        SOURCE_CODE_URL: 'http://git.example.org/me/eventslide',
        LOG_LEVEL: 'verbose',
      })
      const issue = issues.find((candidate) => candidate.startsWith('SOURCE_CODE_URL: ')) ?? ''

      expect(issue).toContain('https')
      expect(issues.some((candidate) => candidate.startsWith('LOG_LEVEL: '))).toBe(true)
    })

    it.each(['off', 'none', 'false', '0', 'no', 'disabled', '-'])(
      'has no spelling that switches the offer off: SOURCE_CODE_URL=%s is refused',
      (value) => {
        // The offer is a licence obligation. The configuration can say *where* the source
        // is, never that there is none, so the one variable that carries it has no
        // off-word to be mistaken for — `off` is the convention SITE_ADMIN, the sweeps and
        // the other switches in this file all use, which is what makes it the likely typo.
        const issues = refusalIssues({ ...DEV, SOURCE_CODE_URL: value })

        expect(issues.some((issue) => issue.startsWith('SOURCE_CODE_URL: '))).toBe(true)
      },
    )

    it('exposes where the source is and never whether it is offered', () => {
      expect(Object.keys(loadConfig({ ...DEV }).source).sort()).toEqual(['ref', 'url'])
    })

    describe('SOURCE_REF, the build argument', () => {
      it('replaces /tree/v<version> with the tag it names', () => {
        // The Dockerfile's `ARG SOURCE_REF` becomes this variable, so an image built from a
        // tag, a release branch or a commit offers *that* source and not a guess at one.
        expect(offeredBy({ SOURCE_REF: 'v2.1.0' })).toBe(`${UPSTREAM}/tree/v2.1.0`)
      })

      it('accepts a full commit sha, for a deployment on a commit no tag names', () => {
        const sha = 'a'.repeat(40)

        expect(offeredBy({ SOURCE_REF: sha })).toBe(`${UPSTREAM}/tree/${sha}`)
      })

      it('accepts a branch with a slash in it', () => {
        expect(offeredBy({ SOURCE_REF: 'release/2.1' })).toBe(`${UPSTREAM}/tree/release/2.1`)
      })

      it('does not use the version once a ref is given', () => {
        expect(offeredBy({ SOURCE_REF: 'abc1234' })).not.toContain(VERSION)
      })

      it('loses to SOURCE_CODE_URL, which names the source outright', () => {
        expect(
          offeredBy({ SOURCE_REF: 'v2.1.0', SOURCE_CODE_URL: 'https://git.example.org/x' }),
        ).toBe('https://git.example.org/x')
      })

      it('reads a blank SOURCE_REF as absent, which is what an unset build argument becomes', () => {
        // `ARG SOURCE_REF=""` then `ENV SOURCE_REF=$SOURCE_REF` leaves an empty variable in
        // every image built without the argument.
        expect(offeredBy({ SOURCE_REF: '' })).toBe(`${UPSTREAM}/tree/v7.8.9`)
      })

      it.each([
        ['a query string', 'v2.1.0?x=1'],
        ['a fragment', 'v2.1.0#top'],
        ['a path traversal', '../../other/repo'],
        ['a traversal inside a segment', 'a..b'],
        ['a leading slash', '/v2.1.0'],
        ['a trailing slash', 'v2.1.0/'],
        ['an empty segment', 'release//2.1'],
        ['a space', 'v2.1.0 beta'],
        ['a leading dot', '.hidden'],
        ['an absolute URL', 'https://evil.example/x'],
      ])('refuses %s', (_name, value) => {
        const issues = refusalIssues({ ...DEV, SOURCE_REF: value })

        expect(issues.some((issue) => issue.startsWith('SOURCE_REF: '))).toBe(true)
      })
    })
  })

  /**
   * The two optional support links (roadmap G4-02): where to donate, and where the money is
   * accounted for. Both are **empty by default** — a self-hoster who sets nothing must see
   * nothing about money anywhere — and both are validated exactly like `SOURCE_CODE_URL`,
   * because both are rendered as a link on screens the operator did not write.
   */
  describe.each([
    ['DONATION_URL', 'donationUrl', 'https://opencollective.com/eventslide'],
    ['BUDGET_URL', 'budgetUrl', 'https://opencollective.com/eventslide/budget'],
  ] as const)('the support link %s', (variable, field, address) => {
    it('is empty by default, so a box that sets nothing says nothing about money', () => {
      expect(loadConfig({ ...DEV }).support[field]).toBeNull()
      expect(loadConfig(aProductionEnv()).support[field]).toBeNull()
    })

    it('reads a blank value as absent, which is what a dangling compose variable renders', () => {
      // `${DONATION_URL:-}` is an empty string whenever the operator did not set it. Read
      // as a value it would be refused as not-a-URL and stop every default deployment.
      expect(loadConfig({ ...DEV, [variable]: '' }).support[field]).toBeNull()
    })

    it('carries the address the operator set', () => {
      expect(loadConfig({ ...DEV, [variable]: address }).support[field]).toBe(address)
    })

    it('canonicalises and trims what it accepts, so what is rendered is what was parsed', () => {
      expect(loadConfig({ ...DEV, [variable]: `  HTTPS://Pay.Example.ORG  ` }).support[field]).toBe(
        'https://pay.example.org/',
      )
    })

    it.each([
      ['a javascript: URI', 'javascript:alert(document.cookie)'],
      ['a data: URI', 'data:text/html,<script>alert(1)</script>'],
      ['plain http', 'http://pay.example.org/eventslide'],
      ['plain http on localhost', 'http://localhost:3000/eventslide'],
      ['an uppercase HTTP scheme', 'HTTP://pay.example.org/eventslide'],
      ['a file: URI', 'file:///etc/passwd'],
      ['a protocol-relative address', '//pay.example.org/eventslide'],
      ['a path with no origin', '/eventslide'],
      ['something that is not a URL at all', 'send me a coffee'],
      ['credentials in the address', 'https://user:secret@pay.example.org/eventslide'],
      ['a username with no password', 'https://token@pay.example.org/eventslide'],
      [
        'a newline inside the address',
        'https://pay.example.org/' + String.fromCharCode(10) + 'event',
      ],
      ['a space inside the address', 'https://pay.example.org/ event'],
    ])('refuses %s, naming the variable', (_name, value) => {
      const issues = refusalIssues({ ...DEV, [variable]: value })

      const issue = issues.find((candidate) => candidate.startsWith(`${variable}: `)) ?? ''
      expect(issue).toContain('https')
    })

    it('says who sees the link when it refuses: hosts and /about, not "every visitor"', () => {
      // The message is shared with SOURCE_CODE_URL, which really is on every screen. A
      // donation link is not, and an operator reading this should not be told it is.
      const issues = refusalIssues({ ...DEV, [variable]: 'http://pay.example.org/eventslide' })

      const issue = issues.find((candidate) => candidate.startsWith(`${variable}: `)) ?? ''
      expect(issue).toContain('hosts and on the public /about page')
      expect(issue).not.toContain('every visitor')
    })

    it('refuses beside every other problem at once, not one boot at a time', () => {
      const issues = refusalIssues({
        ...DEV,
        [variable]: 'http://pay.example.org/eventslide',
        LOG_LEVEL: 'verbose',
      })

      expect(issues.some((candidate) => candidate.startsWith(`${variable}: `))).toBe(true)
      expect(issues.some((candidate) => candidate.startsWith('LOG_LEVEL: '))).toBe(true)
    })

    it('is checked on a production box too, where an operator is most likely to paste one', () => {
      const issues = refusalIssues(aProductionEnv({ [variable]: 'http://pay.example.org' }))

      expect(issues.some((candidate) => candidate.startsWith(`${variable}: `))).toBe(true)
    })
  })

  describe('the support links together', () => {
    it('are independent: a budget page may be published without a donation page, and back', () => {
      const budgetOnly = loadConfig({ ...DEV, BUDGET_URL: 'https://ledger.example.org/' }).support
      const donationOnly = loadConfig({ ...DEV, DONATION_URL: 'https://pay.example.org/' }).support

      expect(budgetOnly).toEqual({ donationUrl: null, budgetUrl: 'https://ledger.example.org/' })
      expect(donationOnly).toEqual({ donationUrl: 'https://pay.example.org/', budgetUrl: null })
    })

    it('have no counterpart to configure: the config says where to give and nothing else', () => {
      // A donation unlocks nothing (G4-01 / G4-02). The shape is the guard: a field that
      // could carry a tier, a perk or a badge would be the first step to selling one.
      expect(Object.keys(loadConfig({ ...DEV }).support).sort()).toEqual([
        'budgetUrl',
        'donationUrl',
      ])
    })
  })

  /**
   * The operator's identity and the links they owe a visitor (roadmap G2-17 / P3-18): who
   * runs this box, how to reach them, where their terms, privacy policy and legal notice
   * are, where to get help, and where to report a piece of content (DSA art. 16).
   *
   * **Every one is empty by default**, and an empty box must stay silent: a self-hoster who
   * sets none of the seven sees no new link, no name and no extra line in the guest notice.
   * Each link is something an operator typed into a file and every visitor will be invited
   * to press, so the rule is the strict one: https, or a path on this site, and never a
   * script, a data URI, plain http or a protocol-relative address that would leave the site.
   */
  const OPERATOR_LINKS = [
    ['LEGAL_TERMS_URL', 'termsUrl', 'https://hosted.example.org/legal/cgu'],
    ['LEGAL_PRIVACY_URL', 'privacyUrl', 'https://hosted.example.org/legal/confidentialite'],
    ['LEGAL_NOTICE_URL', 'legalNoticeUrl', 'https://hosted.example.org/legal/mentions'],
    ['SUPPORT_URL', 'supportUrl', 'https://hosted.example.org/legal/avant-evenement'],
    ['REPORT_URL', 'reportUrl', 'https://hosted.example.org/legal/signaler'],
  ] as const

  describe('the operator identity', () => {
    it('is empty by default, so a box that sets nothing names nobody and links to nothing', () => {
      const empty = {
        name: null,
        contactEmail: null,
        termsUrl: null,
        privacyUrl: null,
        legalNoticeUrl: null,
        supportUrl: null,
        reportUrl: null,
      }

      expect(loadConfig({ ...DEV }).operator).toEqual(empty)
      expect(loadConfig(aProductionEnv()).operator).toEqual(empty)
    })

    it('reads a blank value as absent, which is what a dangling compose variable renders', () => {
      // `${OPERATOR_NAME:-}` and the six like it are empty strings whenever the operator
      // set nothing, which is the ordinary `docker compose up`.
      const blanks = Object.fromEntries(
        ['OPERATOR_NAME', 'OPERATOR_CONTACT_EMAIL', ...OPERATOR_LINKS.map(([name]) => name)].map(
          (name) => [name, ''],
        ),
      )

      expect(loadConfig({ ...DEV, ...blanks }).operator).toEqual({
        name: null,
        contactEmail: null,
        termsUrl: null,
        privacyUrl: null,
        legalNoticeUrl: null,
        supportUrl: null,
        reportUrl: null,
      })
    })

    it('has no field beyond the seven the plan names', () => {
      expect(Object.keys(loadConfig({ ...DEV }).operator).sort()).toEqual([
        'contactEmail',
        'legalNoticeUrl',
        'name',
        'privacyUrl',
        'reportUrl',
        'supportUrl',
        'termsUrl',
      ])
    })

    describe('OPERATOR_NAME', () => {
      it('carries the name, trimmed, with its accents and its ampersand', () => {
        expect(loadConfig({ ...DEV, OPERATOR_NAME: '  Café Photo & Fils  ' }).operator.name).toBe(
          'Café Photo & Fils',
        )
      })

      it('accepts a name with a zero-width joiner between its letters, as some scripts spell', () => {
        const name = 'Kar' + String.fromCharCode(0x200c) + 'im'

        expect(loadConfig({ ...DEV, OPERATOR_NAME: name }).operator.name).toBe(name)
      })

      it('accepts a name of exactly the longest length', () => {
        const longest = 'N'.repeat(OPERATOR_NAME_MAX_LENGTH)

        expect(loadConfig({ ...DEV, OPERATOR_NAME: longest }).operator.name).toBe(longest)
      })

      it.each([
        ['one character too long', 'N'.repeat(OPERATOR_NAME_MAX_LENGTH + 1)],
        ['only spaces', '   '],
        ['a newline inside', 'Les Photographes' + String.fromCharCode(10) + 'Association'],
        ['a tab inside', 'Les' + String.fromCharCode(9) + 'Photographes'],
        ['a NUL byte', 'Les Photographes' + String.fromCharCode(0)],
        [
          'a right-to-left override, which can make a name read backwards',
          'Les ' + String.fromCharCode(0x202e) + 'segmatsoN',
        ],
        ['a line separator', 'Les' + String.fromCharCode(0x2028) + 'Photographes'],
        [
          'only zero-width characters, which print as nothing and which trim leaves alone',
          String.fromCharCode(0x200b, 0x2060, 0xfeff),
        ],
        ['only punctuation', '. . .'],
      ])('refuses a name with %s, naming the variable', (_why, value) => {
        const issues = refusalIssues({ ...DEV, OPERATOR_NAME: value })

        expect(issues.some((issue) => issue.startsWith('OPERATOR_NAME: '))).toBe(true)
      })
    })

    describe('OPERATOR_CONTACT_EMAIL', () => {
      it('carries the address, trimmed, next to the name it belongs to', () => {
        const operator = loadConfig({
          ...DEV,
          OPERATOR_NAME: 'Les Photographes',
          OPERATOR_CONTACT_EMAIL: '  contact@hosted.example.org ',
        }).operator

        expect(operator.contactEmail).toBe('contact@hosted.example.org')
      })

      it('refuses an address longer than any mailbox can be', () => {
        const long = 'a'.repeat(250) + '@hosted.example.org'

        const issues = refusalIssues({
          ...DEV,
          OPERATOR_NAME: 'Les Photographes',
          OPERATOR_CONTACT_EMAIL: long,
        })

        expect(issues.some((issue) => issue.startsWith('OPERATOR_CONTACT_EMAIL: '))).toBe(true)
      })

      it.each([
        ['text that is not an address', 'write to the office'],
        ['an address with a space in it', 'contact @hosted.example.org'],
        ['a mailto: URI', 'mailto:contact@hosted.example.org'],
        ['two addresses', 'a@hosted.example.org,b@hosted.example.org'],
        [
          'an address that smuggles a header into the mailto: link',
          'a@hosted.example.org?bcc=x@y.zz',
        ],
        [
          'an address with a newline in it',
          'a@hosted.example.org' + String.fromCharCode(10) + 'bcc:x@y.zz',
        ],
        // The three above are also refused by the HTML5 pattern, which is the other one zod 4
        // ships. These four are not: they are what tells `z.email()` from it, and `z.email()`
        // is what keeps a `?` or an `&` out of the link built from this address.
        ['a ? in the local part', 'a?bcc=x@y.zz'],
        ['an ampersand', 'a&b@hosted.example.org'],
        ['a domain with no dot', 'a@b'],
        ['two dots in a row', 'a..b@hosted.example.org'],
      ])('refuses %s, naming the variable', (_why, value) => {
        const issues = refusalIssues({
          ...DEV,
          OPERATOR_NAME: 'Les Photographes',
          OPERATOR_CONTACT_EMAIL: value,
        })

        expect(issues.some((issue) => issue.startsWith('OPERATOR_CONTACT_EMAIL: '))).toBe(true)
      })

      it('is refused without a name, because /api/about has nowhere to put an address with no one behind it', () => {
        const issues = refusalIssues({
          ...DEV,
          OPERATOR_CONTACT_EMAIL: 'contact@hosted.example.org',
        })

        const issue = issues.find((candidate) => candidate.startsWith('OPERATOR_CONTACT_EMAIL: '))
        expect(issue).toContain('OPERATOR_NAME')
      })
    })

    describe.each(OPERATOR_LINKS)('%s', (variable, field, address) => {
      const configured = (value: string) =>
        loadConfig({ ...DEV, [variable]: value }).operator[field]

      it('is empty by default', () => {
        expect(loadConfig({ ...DEV }).operator[field]).toBeNull()
      })

      it('carries an https address, in its canonical form', () => {
        expect(configured(address)).toBe(address)
        expect(configured('  HTTPS://Hosted.Example.ORG/Legal  ')).toBe(
          'https://hosted.example.org/Legal',
        )
      })

      it('carries a path on this site as a path, because the hosted instance serves /legal/* itself', () => {
        expect(configured('/legal/signaler')).toBe('/legal/signaler')
        expect(configured('  /legal/signaler?lang=fr#form ')).toBe('/legal/signaler?lang=fr#form')
      })

      it('publishes a path in its canonical form, never as typed', () => {
        // Dot segments are resolved and a non-ASCII character is percent-encoded, exactly as
        // the browser would send them: what is published is what was parsed.
        expect(configured('/a/./b/../c')).toBe('/a/c')
        expect(configured('/café')).toBe('/caf%C3%A9')
      })

      it.each([
        ['a javascript: URI', 'javascript:alert(document.cookie)'],
        ['a data: URI', 'data:text/html,<script>alert(1)</script>'],
        ['plain http', 'http://hosted.example.org/legal'],
        ['plain http on localhost', 'http://localhost:3000/legal'],
        ['an uppercase HTTP scheme', 'HTTP://hosted.example.org/legal'],
        ['a file: URI', 'file:///etc/passwd'],
        ['a mailto: URI', 'mailto:abuse@hosted.example.org'],
        ['a protocol-relative address, which leaves the site', '//evil.example/legal'],
        ['a backslash that the browser reads as a slash', '/\\evil.example/legal'],
        [
          'a path whose dot segments resolve to a protocol-relative address',
          '/.//evil.example/legal',
        ],
        ['a path with no leading slash', 'legal/signaler'],
        ['text that is not an address at all', 'ask the organiser'],
        ['credentials in the address', 'https://user:secret@hosted.example.org/legal'],
        [
          'a newline inside an https address',
          'https://hosted.example.org/' + String.fromCharCode(10) + 'x',
        ],
        ['a newline inside a path', '/legal/' + String.fromCharCode(10) + 'signaler'],
        ['a space inside a path', '/legal/ signaler'],
        [
          'an address over two thousand characters',
          'https://hosted.example.org/' + 'a'.repeat(2_100),
        ],
      ])('refuses %s, naming the variable', (_why, value) => {
        const issues = refusalIssues({ ...DEV, [variable]: value })

        const issue = issues.find((candidate) => candidate.startsWith(`${variable}: `)) ?? ''
        expect(issue).toContain('https')
        expect(issue).toContain('path')
      })

      it('refuses beside every other problem at once, and on a production box too', () => {
        const issues = refusalIssues(
          aProductionEnv({ [variable]: 'http://hosted.example.org', LOG_LEVEL: 'verbose' }),
        )

        expect(issues.some((candidate) => candidate.startsWith(`${variable}: `))).toBe(true)
        expect(issues.some((candidate) => candidate.startsWith('LOG_LEVEL: '))).toBe(true)
      })
    })

    it('keeps the seven independent: a link is fine with no name, and each link stands alone', () => {
      const operator = loadConfig({ ...DEV, REPORT_URL: '/legal/signaler' }).operator

      expect(operator.reportUrl).toBe('/legal/signaler')
      expect(operator.name).toBeNull()
      expect(operator.termsUrl).toBeNull()
      expect(operator.privacyUrl).toBeNull()
    })

    /**
     * G2-20: `LEGAL_TERMS_URL` and `LEGAL_TERMS_VERSION` together make accepting an invitation
     * ask for the terms. Either one alone must leave a self-hosted box exactly as it was.
     */
    describe('the terms of use (LEGAL_TERMS_VERSION)', () => {
      const URL = 'https://hosted.example.org/legal/cgu'

      it('are off by default: a box that sets neither asks nobody for anything', () => {
        expect(loadConfig({ ...DEV }).termsOfUse).toBeNull()
        expect(loadConfig(aProductionEnv()).termsOfUse).toBeNull()
      })

      it('are off when only the address is set, which is the footer link and nothing more', () => {
        const config = loadConfig({ ...DEV, LEGAL_TERMS_URL: URL })

        expect(config.termsOfUse).toBeNull()
        expect(config.operator.termsUrl).toBe(URL)
      })

      it('are on with the address and the version together', () => {
        expect(
          loadConfig({ ...DEV, LEGAL_TERMS_URL: URL, LEGAL_TERMS_VERSION: '2027-01' }),
        ).toMatchObject({
          termsOfUse: { url: URL, version: '2027-01' },
        })
      })

      it('carry the address in its canonical form and the version trimmed', () => {
        const config = loadConfig({
          ...DEV,
          LEGAL_TERMS_URL: '  HTTPS://Hosted.Example.ORG/legal/cgu  ',
          LEGAL_TERMS_VERSION: '  2027-01  ',
        })

        expect(config.termsOfUse).toEqual({ url: URL, version: '2027-01' })
      })

      it('read a blank version as absent, which is what a dangling compose variable renders', () => {
        const config = loadConfig({ ...DEV, LEGAL_TERMS_URL: URL, LEGAL_TERMS_VERSION: '' })

        expect(config.termsOfUse).toBeNull()
      })

      it('read a blank pair as absent', () => {
        const config = loadConfig({ ...DEV, LEGAL_TERMS_URL: '', LEGAL_TERMS_VERSION: '' })

        expect(config.termsOfUse).toBeNull()
      })

      it('refuse a version with no address, since it would look configured and ask for nothing', () => {
        const issues = refusalIssues({ ...DEV, LEGAL_TERMS_VERSION: '2027-01' })

        const issue = issues.find((candidate) => candidate.startsWith('LEGAL_TERMS_VERSION: '))
        expect(issue).toContain('LEGAL_TERMS_URL')
      })

      it.each([
        ['a sentence', 'les nouvelles conditions'],
        ['an address', 'camille@example.org'],
        ['a path', '2027/01'],
        ['a leading hyphen', '-2027'],
        ['more than 32 characters', 'v'.repeat(33)],
      ])('refuse a version that is %s, and never echo what was typed', (_what, value) => {
        const issues = refusalIssues({ ...DEV, LEGAL_TERMS_URL: URL, LEGAL_TERMS_VERSION: value })

        const issue = issues.find((candidate) => candidate.startsWith('LEGAL_TERMS_VERSION: '))
        expect(issue).toBeDefined()
        expect(issue).not.toContain(value)
      })

      it('accept the longest version, which is 32 characters', () => {
        const version = 'v'.repeat(32)

        expect(
          loadConfig({ ...DEV, LEGAL_TERMS_URL: URL, LEGAL_TERMS_VERSION: version }).termsOfUse,
        ).toEqual({ url: URL, version })
      })

      it('are refused beside a refused address in one boot, so both are named at once', () => {
        const issues = refusalIssues({
          ...DEV,
          LEGAL_TERMS_URL: 'http://hosted.example.org/cgu',
          LEGAL_TERMS_VERSION: 'les nouvelles conditions',
        })

        expect(issues.some((issue) => issue.startsWith('LEGAL_TERMS_URL: '))).toBe(true)
        expect(issues.some((issue) => issue.startsWith('LEGAL_TERMS_VERSION: '))).toBe(true)
      })
    })
  })

  /**
   * P4-09 / D-14 (roadmap G3-05): random slug suffix, custom slugs, join code length,
   * and the creation limit. **D-14's whole point is the three defaults below** — a
   * self-hosted box that sets none of them keeps 2.0's only behaviour exactly, and the
   * hosted instance is the one that turns each switch.
   */
  describe('the slug and join-code configuration (P4-09 / D-14)', () => {
    describe('EVENT_SLUG_SUFFIX', () => {
      const NAME = 'EVENT_SLUG_SUFFIX'

      it('is "none" on a box that never mentions it, so a derived slug stays bare', () => {
        expect(loadConfig({ ...DEV }).events.slugSuffix).toBe('none')
        expect(loadConfig(aProductionEnv()).events.slugSuffix).toBe('none')
      })

      it("is 'random' for the word 'random', which the hosted instance sets", () => {
        expect(loadConfig(aProductionEnv({ [NAME]: 'random' })).events.slugSuffix).toBe('random')
      })

      it('reads a blank EVENT_SLUG_SUFFIX as absent, landing on "none" like any other absence', () => {
        expect(loadConfig(aProductionEnv({ [NAME]: '' })).events.slugSuffix).toBe('none')
      })

      it.each(['RANDOM', 'Random', 'true', 'sequential', 'always'])(
        "refuses EVENT_SLUG_SUFFIX='%s' rather than guessing which behaviour was meant",
        (value) => {
          const issues = refusalIssues(aProductionEnv({ [NAME]: value }))

          expect(issues.some((issue) => issue.startsWith(`${NAME}: `))).toBe(true)
        },
      )
    })

    describe('ALLOW_CUSTOM_SLUGS', () => {
      const NAME = 'ALLOW_CUSTOM_SLUGS'

      it('is true on a box that never mentions it, so a host keeps choosing their own address', () => {
        expect(loadConfig({ ...DEV }).events.allowCustomSlugs).toBe(true)
        expect(loadConfig(aProductionEnv()).events.allowCustomSlugs).toBe(true)
      })

      it('is false for "false", which the hosted instance sets', () => {
        expect(loadConfig(aProductionEnv({ [NAME]: 'false' })).events.allowCustomSlugs).toBe(false)
      })

      it.each(['true', '1'])('treats %s as true', (value) => {
        expect(loadConfig(aProductionEnv({ [NAME]: value })).events.allowCustomSlugs).toBe(true)
      })

      it.each(['false', '0'])('treats %s as false', (value) => {
        expect(loadConfig(aProductionEnv({ [NAME]: value })).events.allowCustomSlugs).toBe(false)
      })

      it.each(['yes', 'no', 'TRUE', 'on'])(
        "refuses ALLOW_CUSTOM_SLUGS='%s' rather than guessing which side was meant",
        (value) => {
          const issues = refusalIssues(aProductionEnv({ [NAME]: value }))

          expect(issues.some((issue) => issue.startsWith(`${NAME}: `))).toBe(true)
        },
      )
    })

    describe('JOIN_CODE_LENGTH', () => {
      const NAME = 'JOIN_CODE_LENGTH'

      it('is six on a box that never mentions it — 2.0’s only length', () => {
        expect(loadConfig({ ...DEV }).events.joinCodeLength).toBe(6)
        expect(loadConfig(aProductionEnv()).events.joinCodeLength).toBe(6)
      })

      it.each([6, 7, 8, 9, 10])('accepts %i, the whole configurable range', (length) => {
        expect(loadConfig(aProductionEnv({ [NAME]: String(length) })).events.joinCodeLength).toBe(
          length,
        )
      })

      it.each(['5', '11', '0', '-1', 'six'])('refuses JOIN_CODE_LENGTH=%s', (value) => {
        const issues = refusalIssues(aProductionEnv({ [NAME]: value }))

        expect(issues.some((issue) => issue.startsWith(`${NAME}: `))).toBe(true)
      })
    })

    /**
     * P3-05 / G2-04, and roadmap §10.9's "refuse operator-only settings when off". The
     * default is the half that carries the promise: a self-hosted box whose compose file
     * predates the variable keeps letting every account create events, exactly as before.
     * The refusal is the other half — a restriction to client members is a policy only an
     * operator can satisfy, so a box with no operator surface must stop the boot instead
     * of quietly ignoring a setting its owner believes is in force.
     */
    describe('EVENT_CREATION', () => {
      const NAME = 'EVENT_CREATION'

      it('is anyAccount on a box that never mentions it, so every account keeps creating events', () => {
        expect(loadConfig({ ...DEV }).events.creation).toBe('anyAccount')
        expect(loadConfig(aProductionEnv()).events.creation).toBe('anyAccount')
      })

      it('is clientMembers when SITE_ADMIN is on, which is what the hosted instance sets', () => {
        const config = loadConfig(aProductionEnv({ [NAME]: 'clientMembers', SITE_ADMIN: 'on' }))

        expect(config.events.creation).toBe('clientMembers')
      })

      it('accepts anyAccount spelled out, with the site administration off', () => {
        const config = loadConfig(aProductionEnv({ [NAME]: 'anyAccount', SITE_ADMIN: 'off' }))

        expect(config.events.creation).toBe('anyAccount')
      })

      it('reads a blank EVENT_CREATION as absent, landing on anyAccount like any other absence', () => {
        expect(loadConfig(aProductionEnv({ [NAME]: '' })).events.creation).toBe('anyAccount')
      })

      it('refuses clientMembers while SITE_ADMIN is off, which is its default', () => {
        const issues = refusalIssues(aProductionEnv({ [NAME]: 'clientMembers' }))
        const issue = issues.find((candidate) => candidate.startsWith(`${NAME}: `)) ?? ''

        // Names both variables, so the operator knows which of the two to change.
        expect(issue).toContain('SITE_ADMIN=on')
        expect(issue).toContain('clientMembers')
      })

      it('refuses clientMembers beside an explicit SITE_ADMIN=off, in development too', () => {
        // Not production-gated: a restriction nobody can satisfy is wrong on a laptop as
        // much as on a server, and it is the same refusal the operator meets either way.
        const issues = refusalIssues({ ...DEV, [NAME]: 'clientMembers', SITE_ADMIN: 'off' })

        expect(issues.some((issue) => issue.startsWith(`${NAME}: `))).toBe(true)
      })

      it('lists the refusal beside every other problem, instead of stopping at it', () => {
        const issues = refusalIssues({
          ...DEV,
          [NAME]: 'clientMembers',
          DEFAULT_EVENT_QUOTA_BYTES: '2000',
          MAX_EVENT_QUOTA_BYTES: '1000',
        })

        expect(issues.some((issue) => issue.startsWith(`${NAME}: `))).toBe(true)
        // Both come from the one refinement: a field that fails to parse at all stops the
        // refinement from running, which is true of every cross-field rule in this file.
        expect(issues.some((issue) => issue.startsWith('MAX_EVENT_QUOTA_BYTES: '))).toBe(true)
      })

      it.each(['ClientMembers', 'client_members', 'members', 'true', 'any', 'ANYACCOUNT'])(
        "refuses EVENT_CREATION='%s' rather than guessing which policy was meant",
        (value) => {
          const issues = refusalIssues(aProductionEnv({ [NAME]: value, SITE_ADMIN: 'on' }))

          expect(issues.some((issue) => issue.startsWith(`${NAME}: `))).toBe(true)
        },
      )
    })

    describe('OPERATOR_RESET_LINKS (G2-12 / P3-14, D-16)', () => {
      const NAME = 'OPERATOR_RESET_LINKS'

      it('is mailOnly on a box that never mentions it, so no link is ever shown to an operator', () => {
        expect(loadConfig({ ...DEV }).operatorResetLinks).toBe('mailOnly')
        expect(loadConfig(aProductionEnv()).operatorResetLinks).toBe('mailOnly')
      })

      it('reads a blank value as absent, which lands on the less permissive of the two words', () => {
        expect(loadConfig(aProductionEnv({ [NAME]: '' })).operatorResetLinks).toBe('mailOnly')
      })

      it('accepts mailOnly spelled out, with or without the site administration', () => {
        expect(
          loadConfig(aProductionEnv({ [NAME]: 'mailOnly', SITE_ADMIN: 'off' })).operatorResetLinks,
        ).toBe('mailOnly')
        expect(
          loadConfig(aProductionEnv({ [NAME]: 'mailOnly', SITE_ADMIN: 'on' })).operatorResetLinks,
        ).toBe('mailOnly')
      })

      it('is copyLinkWithOwnerApproval only when the box says so, with SITE_ADMIN on', () => {
        const config = loadConfig(
          aProductionEnv({ [NAME]: 'copyLinkWithOwnerApproval', SITE_ADMIN: 'on' }),
        )

        expect(config.operatorResetLinks).toBe('copyLinkWithOwnerApproval')
      })

      it('refuses the opt-in while SITE_ADMIN is off, which is its default, naming both variables', () => {
        const issues = refusalIssues(aProductionEnv({ [NAME]: 'copyLinkWithOwnerApproval' }))
        const issue = issues.find((candidate) => candidate.startsWith(`${NAME}: `)) ?? ''

        expect(issue).toContain('SITE_ADMIN=on')
        expect(issue).toContain('copyLinkWithOwnerApproval')
      })

      it('refuses the opt-in beside an explicit SITE_ADMIN=off, in development too', () => {
        const issues = refusalIssues({
          ...DEV,
          [NAME]: 'copyLinkWithOwnerApproval',
          SITE_ADMIN: 'off',
        })

        expect(issues.some((issue) => issue.startsWith(`${NAME}: `))).toBe(true)
      })

      it('lists the refusal beside every other problem, instead of stopping at it', () => {
        const issues = refusalIssues({
          ...DEV,
          [NAME]: 'copyLinkWithOwnerApproval',
          DEFAULT_EVENT_QUOTA_BYTES: '2000',
          MAX_EVENT_QUOTA_BYTES: '1000',
        })

        expect(issues.some((issue) => issue.startsWith(`${NAME}: `))).toBe(true)
        expect(issues.some((issue) => issue.startsWith('MAX_EVENT_QUOTA_BYTES: '))).toBe(true)
      })

      it('names both accepted words when it refuses, and does not repeat what was typed', () => {
        const issues = refusalIssues(
          aProductionEnv({ [NAME]: 'copyLink-secret-typo', SITE_ADMIN: 'on' }),
        )
        const issue = issues.find((candidate) => candidate.startsWith(`${NAME}: `)) ?? ''

        expect(issue).toContain("'mailOnly'")
        expect(issue).toContain("'copyLinkWithOwnerApproval'")
        expect(issue).not.toContain('secret-typo')
      })

      it.each([
        'copyLink',
        'copylinkwithownerapproval',
        'COPYLINKWITHOWNERAPPROVAL',
        'mailonly',
        'true',
        'on',
        'copy',
      ])(
        "refuses OPERATOR_RESET_LINKS='%s' rather than guessing: a typo is not the opt-in",
        (value) => {
          const issues = refusalIssues(aProductionEnv({ [NAME]: value, SITE_ADMIN: 'on' }))

          expect(issues.some((issue) => issue.startsWith(`${NAME}: `))).toBe(true)
        },
      )
    })

    describe('AUDIT_RETENTION_DAYS', () => {
      const NAME = 'AUDIT_RETENTION_DAYS'

      it('is three years on a box that never mentions it', () => {
        expect(loadConfig({ ...DEV }).audit.retentionDays).toBe(1095)
        expect(loadConfig(aProductionEnv()).audit.retentionDays).toBe(1095)
      })

      it('reads a blank value as absent, so a dangling compose variable keeps the default rather than becoming zero', () => {
        expect(loadConfig(aProductionEnv({ [NAME]: '' })).audit.retentionDays).toBe(1095)
      })

      it('accepts 365, the floor the hosted instance runs at', () => {
        expect(loadConfig(aProductionEnv({ [NAME]: '365' })).audit.retentionDays).toBe(365)
      })

      it('accepts ten years, the ceiling', () => {
        expect(loadConfig(aProductionEnv({ [NAME]: '3650' })).audit.retentionDays).toBe(3650)
      })

      it.each(['364', '30', '0', '-1', '3651', '400.5', 'three years'])(
        'refuses AUDIT_RETENTION_DAYS=%s, naming the variable',
        (value) => {
          const issues = refusalIssues(aProductionEnv({ [NAME]: value }))

          expect(issues.some((issue) => issue.startsWith(`${NAME}: `))).toBe(true)
        },
      )

      it('names the floor in the refusal, so the operator learns the number and not only that it failed', () => {
        const issues = refusalIssues(aProductionEnv({ [NAME]: '30' }))

        expect(issues.find((issue) => issue.startsWith(`${NAME}: `))).toContain('365')
      })

      it('is read by a maintenance command too, since npm run purge loads the same configuration', () => {
        expect(
          loadMaintenanceConfig({ NODE_ENV: 'production', [NAME]: '400' }).audit.retentionDays,
        ).toBe(400)
      })
    })

    describe('EVENT_CREATION_RATE_LIMIT_PER_HOUR', () => {
      it('is twenty on a box that never mentions it', () => {
        expect(loadConfig({ ...DEV }).rateLimits.eventCreationPerHour).toBe(20)
      })

      it('reaches its own field rather than another numeric limit', () => {
        const config = loadConfig({ ...DEV, EVENT_CREATION_RATE_LIMIT_PER_HOUR: '42' })

        expect(config.rateLimits.eventCreationPerHour).toBe(42)
      })
    })
  })

  /**
   * Outgoing mail (roadmap §10.3, G2-07 / P3-08). `SMTP_URL` is a credential: it is the one
   * value in this file whose refusal must never repeat what it refused, and the one whose
   * absence is the supported, default arrangement.
   */
  describe('outgoing mail (SMTP_URL and MAIL_FROM)', () => {
    const A_PASSWORD = 'HUNTER2-canary-pw'

    it('is no mail at all on a box that never set either variable', () => {
      expect(loadConfig({ ...DEV }).mail.smtp).toBeNull()
    })

    it('reads a relay and a sender into parsed settings, never the raw URL', () => {
      const { mail } = loadConfig({
        ...DEV,
        SMTP_URL: `smtps://camille:${A_PASSWORD}@mail.example.com:2465`,
        MAIL_FROM: 'EventSlide <no-reply@photos.example.org>',
      })

      expect(mail.smtp).toEqual({
        endpoint: {
          host: 'mail.example.com',
          port: 2465,
          implicitTls: true,
          credentials: { username: 'camille', password: A_PASSWORD },
        },
        from: { name: 'EventSlide', address: 'no-reply@photos.example.org' },
      })
    })

    it('accepts a relay with no login, which is a local one', () => {
      const { mail } = loadConfig({
        ...DEV,
        SMTP_URL: 'smtp://localhost:1025',
        MAIL_FROM: 'no-reply@example.org',
      })

      expect(mail.smtp?.endpoint).toEqual({
        host: 'localhost',
        port: 1025,
        implicitTls: false,
        credentials: null,
      })
    })

    it('is accepted in production, where it is the deployment that sets it', () => {
      const config = loadConfig(
        aProductionEnv({
          SMTP_URL: 'smtp://mail.example.com:587',
          MAIL_FROM: 'no-reply@photos.example.org',
        }),
      )

      expect(config.mail.smtp?.endpoint.host).toBe('mail.example.com')
    })

    it('reads the empty strings compose renders for unset variables as absent, not as values', () => {
      // `compose.yaml` passes `${SMTP_URL:-}` and `${MAIL_FROM:-}`, so the ordinary
      // deployment with no relay arrives here as two empty strings.
      const config = loadConfig({ ...DEV, SMTP_URL: '', MAIL_FROM: '' })

      expect(config.mail.smtp).toBeNull()
      expect(config.warnings).toEqual([])
    })

    it('refuses SMTP_URL without MAIL_FROM, naming MAIL_FROM, because a relay will not take a message with no sender', () => {
      const issues = refusalIssues({ ...DEV, SMTP_URL: 'smtp://mail.example.com' })

      expect(issues).toHaveLength(1)
      expect(issues[0]).toMatch(/^MAIL_FROM: MAIL_FROM is required when SMTP_URL is set/)
    })

    it('refuses it in production too, which is where it would otherwise fail on the first invitation', () => {
      const issues = refusalIssues(aProductionEnv({ SMTP_URL: 'smtps://mail.example.com' }))

      expect(issues.some((issue) => issue.startsWith('MAIL_FROM: '))).toBe(true)
    })

    it('accepts MAIL_FROM with no SMTP_URL, and sends nothing', () => {
      const config = loadConfig({ ...DEV, MAIL_FROM: 'no-reply@example.org' })

      expect(config.mail.smtp).toBeNull()
    })

    it('warns in production about a sender with no relay, because mail the operator expects will not arrive', () => {
      const config = loadConfig(
        aProductionEnv({ TRUST_PROXY_HOPS: '1', MAIL_FROM: 'no-reply@example.org' }),
      )

      expect(config.warnings).toHaveLength(1)
      expect(config.warnings[0]).toContain('MAIL_FROM is set but SMTP_URL is not')
    })

    it('does not warn about a sender when there is a relay, or outside production', () => {
      expect(
        loadConfig(
          aProductionEnv({
            TRUST_PROXY_HOPS: '1',
            SMTP_URL: 'smtps://mail.example.com',
            MAIL_FROM: 'no-reply@example.org',
          }),
        ).warnings,
      ).toEqual([])
      expect(loadConfig({ ...DEV, MAIL_FROM: 'no-reply@example.org' }).warnings).toEqual([])
    })

    it.each([
      ['another scheme', 'https://mail.example.com'],
      ['a path', 'smtp://mail.example.com/queue'],
      ['a query string', 'smtp://mail.example.com?tls.rejectUnauthorized=false'],
      ['a user with no password', 'smtps://camille@mail.example.com'],
      ['a port out of range', 'smtp://mail.example.com:0'],
      ['no host', 'smtp://'],
    ])('refuses an SMTP_URL with %s, naming the variable', (_name, value) => {
      const issues = refusalIssues({ ...DEV, SMTP_URL: value, MAIL_FROM: 'no-reply@example.org' })

      expect(issues).toHaveLength(1)
      expect(issues[0]).toMatch(/^SMTP_URL: SMTP_URL /)
    })

    it('never repeats a refused SMTP_URL, because it may still carry the password it was refused with', () => {
      // The boot prints its problems to a terminal and the output is kept.
      const refused = [
        `smtps://camille:${A_PASSWORD}@mail.example.com/queue`,
        `imaps://camille:${A_PASSWORD}@mail.example.com`,
        `smtps://:${A_PASSWORD}@mail.example.com`,
        `smtps://camille:${A_PASSWORD}@mail.example.com?x=1`,
      ]

      for (const value of refused) {
        let message = ''
        try {
          loadConfig({ ...DEV, SMTP_URL: value, MAIL_FROM: 'no-reply@example.org' })
        } catch (error) {
          message = error instanceof ConfigError ? error.message : String(error)
        }
        expect(message, value).toContain('SMTP_URL')
        expect(message).not.toContain(A_PASSWORD)
        expect(message).not.toContain('camille')
      }
    })

    it.each([
      ['a list of addresses', 'a@example.org, b@example.com'],
      ['no address', 'EventSlide'],
      ['an unclosed bracket', 'EventSlide <no-reply@example.org'],
    ])('refuses a MAIL_FROM that is %s, naming the variable', (_name, value) => {
      const issues = refusalIssues({ ...DEV, SMTP_URL: 'smtp://localhost:1025', MAIL_FROM: value })

      expect(issues).toHaveLength(1)
      expect(issues[0]).toMatch(/^MAIL_FROM: MAIL_FROM must be one address/)
    })

    it('names both problems when the URL is malformed and there is no sender, since fixing the URL alone would not boot', () => {
      // A refused URL leaves zod's aborted marker in its place, which is not `undefined`, so
      // the "sender required" refinement still runs. The second line stays true after the
      // first is fixed, which is why it is kept rather than suppressed.
      const issues = refusalIssues({ ...DEV, SMTP_URL: 'ftp://mail.example.com' })

      expect(issues.map((issue) => issue.split(':')[0])).toEqual(['SMTP_URL', 'MAIL_FROM'])
    })

    it('lists a bad SMTP_URL beside every other problem, like every other variable', () => {
      const issues = refusalIssues({
        ...DEV,
        SMTP_URL: 'ftp://mail.example.com',
        MAIL_FROM: 'no-reply@example.org',
        JOIN_CODE_LENGTH: '99',
      })

      expect(issues.some((issue) => issue.startsWith('SMTP_URL: '))).toBe(true)
      expect(issues.some((issue) => issue.startsWith('JOIN_CODE_LENGTH: '))).toBe(true)
    })
  })

  /**
   * G2-13 / P3-15. The refusals are the point: a box that says its operators need a second
   * factor and cannot decrypt one is a box that either locks them out or is believed to be
   * guarded when it is not, so both are named at boot beside every other bad variable.
   */
  describe('the operator second factor (MFA_ENCRYPTION_KEY and REQUIRE_OPERATOR_2FA)', () => {
    const HEX_KEY = 'a1'.repeat(32)
    const BASE64_KEY = Buffer.from(HEX_KEY, 'hex').toString('base64')
    const BASE64URL_KEY = Buffer.from(HEX_KEY, 'hex').toString('base64url')
    const aHostedEnv = (overrides: Source = {}): Source =>
      aProductionEnv({
        SITE_ADMIN: 'on',
        REQUIRE_OPERATOR_2FA: 'true',
        MFA_ENCRYPTION_KEY: BASE64_KEY,
        ...overrides,
      })

    it('leaves a self-hosted box exactly as it was: no key, nothing required', () => {
      expect(loadConfig(aProductionEnv()).mfa).toEqual({
        encryptionKey: null,
        requireOperatorSecondFactor: false,
      })
    })

    it('reads a blank key as absent, so a dangling compose variable changes nothing', () => {
      const config = loadConfig({ ...DEV, MFA_ENCRYPTION_KEY: '' })

      expect(config.mfa).toEqual({ encryptionKey: null, requireOperatorSecondFactor: false })
    })

    it('refuses a blank REQUIRE_OPERATOR_2FA: a protection must not be switched off by an empty string', () => {
      // The hosted instance's compose file rendering the variable empty would otherwise
      // boot, look configured and guard nothing.
      const issues = refusalIssues(aHostedEnv({ REQUIRE_OPERATOR_2FA: '' }))

      expect(issues).toHaveLength(1)
      expect(issues[0]).toMatch(/^REQUIRE_OPERATOR_2FA: /)
    })

    it.each([
      ['hex', HEX_KEY],
      ['base64', BASE64_KEY],
      ['base64url', BASE64URL_KEY],
      ['base64 without its padding', BASE64_KEY.replace(/=+$/, '')],
    ])('accepts 32 random bytes written as %s, and keeps the bytes', (_name, key) => {
      const config = loadConfig({ ...DEV, MFA_ENCRYPTION_KEY: key })

      expect(Buffer.from(config.mfa.encryptionKey ?? []).toString('hex')).toBe(HEX_KEY)
    })

    it('accepts a longer key than 32 bytes', () => {
      const config = loadConfig({ ...DEV, MFA_ENCRYPTION_KEY: 'a1'.repeat(48) })

      expect(config.mfa.encryptionKey?.length).toBe(48)
    })

    it('lets a key stand without the requirement, so a self-hosted operator may enrol voluntarily', () => {
      const config = loadConfig(aProductionEnv({ MFA_ENCRYPTION_KEY: BASE64_KEY }))

      expect(config.mfa.requireOperatorSecondFactor).toBe(false)
      expect(config.mfa.encryptionKey).not.toBeNull()
    })

    it.each([
      ['31 bytes of hex', 'a1'.repeat(31)],
      ['an odd number of hex digits', 'a'.repeat(65)],
      ['31 bytes of base64', Buffer.alloc(31, 7).toString('base64')],
      ['a word', 'correct-horse-battery-staple'],
      ['text that is not base64', 'not a key at all, but quite long enough to pass for one!!'],
      ['a base64 length no byte string has', Buffer.alloc(32, 7).toString('base64url') + 'AA'],
      ['the example value of SESSION_SECRET', 'change-me-in-production-at-least-32-characters'],
      ['the example value of GUEST_TOKEN_SECRET', 'change-me-too-at-least-32-characters-long'],
    ])('refuses %s, naming the variable and never repeating the value', (_name, key) => {
      const issues = refusalIssues({ ...DEV, MFA_ENCRYPTION_KEY: key })

      expect(issues).toHaveLength(1)
      expect(issues[0]).toMatch(/^MFA_ENCRYPTION_KEY: /)
      expect(issues[0]).not.toContain(key)
    })

    it('refuses REQUIRE_OPERATOR_2FA=true with no key: the box would refuse every operator forever', () => {
      const issues = refusalIssues(aHostedEnv({ MFA_ENCRYPTION_KEY: undefined }))

      expect(issues).toHaveLength(1)
      expect(issues[0]).toMatch(
        /^MFA_ENCRYPTION_KEY: MFA_ENCRYPTION_KEY is required when REQUIRE_OPERATOR_2FA is true/,
      )
    })

    it('refuses REQUIRE_OPERATOR_2FA=true with a blank key, which is absent', () => {
      expect(refusalIssues(aHostedEnv({ MFA_ENCRYPTION_KEY: '' }))[0]).toMatch(
        /^MFA_ENCRYPTION_KEY: MFA_ENCRYPTION_KEY is required/,
      )
    })

    it('refuses REQUIRE_OPERATOR_2FA=true with an invalid key, once, and with the format problem', () => {
      const issues = refusalIssues(aHostedEnv({ MFA_ENCRYPTION_KEY: 'too-short' }))

      expect(issues.filter((issue) => issue.startsWith('MFA_ENCRYPTION_KEY: '))).toHaveLength(1)
      expect(issues[0]).toContain('at least 32 random bytes')
    })

    it('refuses REQUIRE_OPERATOR_2FA=true without SITE_ADMIN=on: it would guard a namespace nobody mounted', () => {
      const issues = refusalIssues(aHostedEnv({ SITE_ADMIN: undefined }))

      expect(issues).toHaveLength(1)
      expect(issues[0]).toMatch(
        /^REQUIRE_OPERATOR_2FA: REQUIRE_OPERATOR_2FA=true requires SITE_ADMIN=on/,
      )
    })

    it('boots the hosted configuration, and says the requirement is on', () => {
      const config = loadConfig(aHostedEnv())

      expect(config.mfa.requireOperatorSecondFactor).toBe(true)
      expect(config.siteAdmin).toBe(true)
      expect(config.mfa.encryptionKey?.length).toBe(32)
    })

    it.each([
      ['true', true],
      ['1', true],
      ['false', false],
      ['0', false],
    ])('reads REQUIRE_OPERATOR_2FA=%s as %s', (given, expected) => {
      const config = loadConfig(aHostedEnv({ REQUIRE_OPERATOR_2FA: given }))

      expect(config.mfa.requireOperatorSecondFactor).toBe(expected)
    })

    it.each(['yes', 'on', 'TRUE', 'enabled'])(
      'refuses REQUIRE_OPERATOR_2FA=%s rather than guess',
      (given) => {
        expect(refusalIssues(aHostedEnv({ REQUIRE_OPERATOR_2FA: given }))[0]).toMatch(
          /^REQUIRE_OPERATOR_2FA: /,
        )
      },
    )

    it('refuses a key that is the SESSION_SECRET: rotating one would change the other', () => {
      const issues = refusalIssues(
        aHostedEnv({ SESSION_SECRET: HEX_KEY, MFA_ENCRYPTION_KEY: HEX_KEY }),
      )

      expect(issues).toHaveLength(1)
      expect(issues[0]).toMatch(
        /^MFA_ENCRYPTION_KEY: MFA_ENCRYPTION_KEY must not be the same value as SESSION_SECRET/,
      )
      expect(issues[0]).not.toContain(HEX_KEY)
    })

    it('refuses a key that is the GUEST_TOKEN_SECRET, for the same reason', () => {
      const issues = refusalIssues(
        aHostedEnv({ GUEST_TOKEN_SECRET: HEX_KEY, MFA_ENCRYPTION_KEY: HEX_KEY }),
      )

      expect(issues).toHaveLength(1)
      expect(issues[0]).toMatch(/must not be the same value as GUEST_TOKEN_SECRET/)
    })

    it('applies the same rules to a maintenance command, so one box cannot be two configurations', () => {
      expect(() =>
        loadMaintenanceConfig({ REQUIRE_OPERATOR_2FA: 'true', SITE_ADMIN: 'on' }),
      ).toThrow(ConfigError)
    })

    it('rotating SESSION_SECRET leaves the key as it was', () => {
      const before = loadConfig(aHostedEnv())
      const after = loadConfig(aHostedEnv({ SESSION_SECRET: ANOTHER_REAL_SECRET + 'x' }))

      expect(after.mfa.encryptionKey).toEqual(before.mfa.encryptionKey)
    })
  })

  /**
   * R-16 (roadmap: self-hosters rupture on a changed default). Both of these were a
   * refusal in an earlier draft of this module; neither throws now, because the
   * configurations they describe already run on boxes in the wild, and turning either
   * into a boot refusal in a minor release is exactly the rupture R-16 names. They are
   * warnings so an operator reading the boot log learns about them without anything
   * breaking.
   */
  /**
   * What the boot refusal keeps doing under zod 4.
   *
   * Each of these was true under zod 3 by accident of how that library treated a refused value,
   * and none of them is something zod 4 does unless it is asked: the first stops "every problem
   * at once" from becoming "the first problem", the second keeps a typed word out of a printed
   * message, the third is the scheme check judging what the operator wrote and not a trimmed copy.
   */
  describe('what the boot refusal keeps doing under zod 4', () => {
    it.each([
      ['SOURCE_CODE_URL', 'http://example.org/source'],
      ['DONATION_URL', 'javascript:alert(1)'],
      ['BUDGET_URL', 'data:text/html,x'],
      ['LEGAL_TERMS_URL', '//evil.example/x'],
      ['SUPPORT_URL', 'http://example.org/help'],
      ['SMTP_URL', 'ftp://mail.example.com'],
      ['MAIL_FROM', 'a@example.org, b@example.com'],
      ['MFA_ENCRYPTION_KEY', 'too-short'],
    ])('lists a refused %s and a cross-field problem beside it, in one boot', (name, value) => {
      // EVENT_CREATION=clientMembers with SITE_ADMIN off is a problem only the object-level
      // refinement can see. A refusal raised from inside a transform stops that refinement
      // in zod 4 unless it says otherwise, so the operator would be told about one problem
      // per restart in a venue an hour before the guests arrive.
      const issues = refusalIssues({ ...DEV, [name]: value, EVENT_CREATION: 'clientMembers' })

      expect(
        issues.some((issue) => issue.startsWith(`${name}: `)),
        `${name} was not named`,
      ).toBe(true)
      expect(
        issues.some((issue) => issue.startsWith('EVENT_CREATION: ')),
        'the cross-field refinement did not run',
      ).toBe(true)
    })

    it.each([
      ['NODE_ENV', ['development', 'test', 'production']],
      ['LOG_LEVEL', ['fatal', 'error', 'warn', 'info', 'debug', 'trace']],
      ['SITE_ADMIN', ['off', 'on']],
      ['EVENT_CREATION', ['anyAccount', 'clientMembers']],
      ['EVENT_SLUG_SUFFIX', ['none', 'random']],
      ['SQLITE_SHUTDOWN_CHECKPOINT', ['truncate', 'passive', 'none']],
      ['ALLOW_CUSTOM_SLUGS', ['true', 'false', '1', '0']],
      ['REQUIRE_OPERATOR_2FA', ['true', 'false', '1', '0']],
      ['SESSION_COOKIE_SECURE', ['true', 'false', '1', '0']],
      ['E2E_HOOKS', ['true', 'false', '1', '0']],
    ] as const)(
      'refuses an unknown %s by naming every accepted word, and never the word typed',
      (name, accepted) => {
        // A pasted secret lands in the wrong variable often enough to be worth a test, and the
        // refusal is printed and kept by whatever collects a container's output.
        const typed = 'hunter2-a-secret-pasted-into-the-wrong-line'
        const issue =
          refusalIssues({ ...DEV, [name]: typed }).find((candidate) =>
            candidate.startsWith(`${name}: `),
          ) ?? ''

        expect(issue).not.toBe('')
        for (const word of accepted) expect(issue).toContain(`'${word}'`)
        expect(issue).not.toContain(typed)
      },
    )

    it.each([' https://photos.example.com', '	https://photos.example.com'])(
      'refuses a PUBLIC_URL written with leading whitespace (%j), not a trimmed copy of it',
      (value) => {
        // zod 4's own url check trims, then hands the trimmed text to the rules after it, so
        // the https? check would be judging a string the operator never typed.
        const issues = refusalIssues(aProductionEnv({ PUBLIC_URL: value }))

        expect(issues.some((issue) => issue.startsWith('PUBLIC_URL: '))).toBe(true)
      },
    )

    // zod 3 rounded these and booted; zod 4's `.int()` means a safe integer, and a quota or a
    // size is not a place for a number that cannot tell itself from its neighbour. Two spellings
    // of the rule are held, because the optional ceiling does not share `positiveInt`.
    it.each(
      [
        'MAX_UPLOAD_BYTES',
        'MAX_IMAGE_PIXELS',
        'DEFAULT_EVENT_QUOTA_BYTES',
        'MAX_EVENT_QUOTA_BYTES',
      ].flatMap((name) => ['9007199254740993', '1e21'].map((value) => [name, value] as const)),
    )(
      'refuses %s=%s, which no integer in a double can hold, rather than rounding it',
      (name, value) => {
        const issues = refusalIssues({ ...DEV, [name]: value })

        expect(issues.some((issue) => issue.startsWith(`${name}: `))).toBe(true)
      },
    )
  })

  /**
   * `PUBLIC_URL` is the address that goes into every join link, QR code and mail, so what
   * `loadConfig` hands on is what a guest's phone is sent to: refused when it cannot be
   * what an operator meant, and otherwise the parsed URL's own spelling, not the typed one.
   */
  describe('the public origin (PUBLIC_URL)', () => {
    const A_PASSWORD = 'HUNTER2-canary-pw'

    /** What the boot prints, in full: the one thing that must never repeat the value. */
    const refusalText = (source: Source): string => {
      try {
        loadConfig(source)
      } catch (error) {
        return error instanceof ConfigError ? error.message : String(error)
      }
      throw new Error('loadConfig accepted a configuration that the test expected it to refuse')
    }

    describe('what a reverse proxy relies on, kept as it was', () => {
      it.each([
        ['no path', 'https://photos.example.com', 'https://photos.example.com'],
        ['a bare trailing slash', 'https://photos.example.com/', 'https://photos.example.com'],
        ['several trailing slashes', 'https://photos.example.com///', 'https://photos.example.com'],
        ['a path prefix', 'https://example.com/eventslide', 'https://example.com/eventslide'],
        [
          'a path prefix and a slash',
          'https://example.com/eventslide/',
          'https://example.com/eventslide',
        ],
        [
          'a path prefix and slashes',
          'https://example.com/eventslide//',
          'https://example.com/eventslide',
        ],
        ['a deeper prefix', 'https://example.com/apps/photos/', 'https://example.com/apps/photos'],
        [
          'a prefix whose case matters',
          'https://example.com/EventSlide/',
          'https://example.com/EventSlide',
        ],
      ])(
        'accepts %s, so a join link is never //join/ and never leaves its prefix',
        (_name, typed, expected) => {
          expect(loadConfig(aProductionEnv({ PUBLIC_URL: typed })).publicUrl).toBe(expected)
          expect(loadConfig({ ...DEV, PUBLIC_URL: typed }).publicUrl).toBe(expected)
        },
      )
    })

    describe('the canonical form', () => {
      it.each([
        [
          'an uppercase scheme and host',
          'HTTPS://Photos.Example.com',
          'https://photos.example.com',
        ],
        ['the default https port', 'https://photos.example.com:443', 'https://photos.example.com'],
        [
          'the default port and a slash',
          'https://photos.example.com:443/',
          'https://photos.example.com',
        ],
        ['the default http port, on localhost', 'http://localhost:80', 'http://localhost'],
        [
          'a port that is not the default',
          'https://photos.example.com:8443',
          'https://photos.example.com:8443',
        ],
        [
          'a prefix, whose case is the proxy’s and stays as typed',
          'HTTPS://PHOTOS.example.com/EventSlide/',
          'https://photos.example.com/EventSlide',
        ],
        [
          'a space in a prefix, spelled as a browser would send it',
          'https://example.com/my event/',
          'https://example.com/my%20event',
        ],
        [
          'dot segments in a prefix, resolved as a browser would',
          'https://example.com/a/../b/',
          'https://example.com/b',
        ],
        [
          'an internationalised host, as a phone resolves it',
          'https://bücher.example',
          'https://xn--bcher-kva.example',
        ],
      ])('hands on %s as its parsed spelling, not as typed', (_name, typed, expected) => {
        const config = loadConfig(aProductionEnv({ PUBLIC_URL: typed }))

        expect(config.publicUrl).toBe(expected)
      })
    })

    describe('whitespace', () => {
      const REFUSED =
        /^PUBLIC_URL: PUBLIC_URL must not contain a tab or a line break, nor end with /

      it.each([
        ['a space', 'https://photos.example.com '],
        ['a tab', 'https://photos.example.com\t'],
        ['a newline', 'https://photos.example.com\n'],
        ['a carriage return', 'https://photos.example.com\r'],
        ['a space after a slash', 'https://photos.example.com/ '],
        ['a space after a path prefix', 'https://example.com/eventslide '],
        ['several spaces', 'https://photos.example.com   '],
        ['a control character', 'https://photos.example.com' + String.fromCharCode(0x1f)],
        [
          'a zero-width space after a prefix, which the parser keeps and a proxy would not route',
          'https://photos.example.com/eventslide' + String.fromCharCode(0x200b),
        ],
      ])('refuses %s at the end, naming the variable, in production', (_name, typed) => {
        // `URL.canParse` strips it and the scheme check only reads the front, so this
        // used to boot and the join link carried the character. #52 closed the leading
        // twin of this case.
        const issues = refusalIssues(aProductionEnv({ PUBLIC_URL: typed }))

        expect(issues).toEqual([expect.stringMatching(REFUSED)])
      })

      it.each([
        ['a tab inside the host', 'https://photos.exam' + String.fromCharCode(9) + 'ple.com'],
        [
          'a newline inside a prefix',
          'https://photos.example.com/ev' + String.fromCharCode(10) + 'ent',
        ],
        ['a tab inside the port', 'https://photos.example.com:4' + String.fromCharCode(9) + '43'],
        ['a tab before the slash', 'https://photos.example.com' + String.fromCharCode(9) + '/'],
      ])(
        'refuses %s, which the URL parser deletes and would leave an address nobody typed',
        (_name, typed) => {
          const issues = refusalIssues(aProductionEnv({ PUBLIC_URL: typed }))

          expect(issues).toEqual([expect.stringMatching(REFUSED)])
        },
      )

      it('refuses it outside production too, where a QR code is just as wrong', () => {
        const issues = refusalIssues({ ...DEV, PUBLIC_URL: 'https://photos.example.com ' })

        expect(issues).toEqual([expect.stringMatching(REFUSED)])
      })

      it('names the space and the plain http beside each other when both are wrong', () => {
        const issues = refusalIssues(aProductionEnv({ PUBLIC_URL: 'http://photos.example.com ' }))

        expect(issues).toHaveLength(2)
        expect(issues).toContainEqual(expect.stringMatching(REFUSED))
        expect(issues).toContainEqual(
          expect.stringContaining('PUBLIC_URL must use https in production'),
        )
      })
    })

    describe('credentials', () => {
      it.each([
        ['a user name and a password', 'https://camille:secret@photos.example.com'],
        ['a user name alone', 'https://camille@photos.example.com'],
        ['a password alone', 'https://:secret@photos.example.com'],
        ['credentials and a prefix', 'https://camille:secret@photos.example.com/eventslide/'],
        [
          'credentials on localhost, which production exempts from https',
          'http://camille:secret@localhost',
        ],
        ['credentials on localhost with a port', 'http://camille:secret@localhost:4300'],
        ['an uppercase scheme', 'HTTPS://camille:secret@photos.example.com'],
      ])('refuses %s, naming the variable, in production', (_name, typed) => {
        const issues = refusalIssues(aProductionEnv({ PUBLIC_URL: typed }))

        expect(issues).toEqual([
          expect.stringMatching(
            /^PUBLIC_URL: PUBLIC_URL must not contain a user name or a password/,
          ),
        ])
      })

      it('refuses them outside production too', () => {
        const issues = refusalIssues({ ...DEV, PUBLIC_URL: 'http://camille:secret@localhost:5173' })

        expect(issues).toEqual([
          expect.stringMatching(
            /^PUBLIC_URL: PUBLIC_URL must not contain a user name or a password/,
          ),
        ])
      })

      it('never repeats a refused PUBLIC_URL, because it may still carry the password it was refused with', () => {
        // The boot prints its problems to a terminal, and what prints there is kept.
        const refused = [
          `https://camille:${A_PASSWORD}@photos.example.com`,
          `https://camille:${A_PASSWORD}@photos.example.com/eventslide/`,
          `http://camille:${A_PASSWORD}@localhost:4300`,
          `http://camille:${A_PASSWORD}@photos.example.com`,
          `HTTPS://:${A_PASSWORD}@photos.example.com`,
          `https://camille:${A_PASSWORD}@photos.example.com `,
          `https://camille:${A_PASSWORD}@`,
        ]

        for (const value of refused) {
          for (const source of [
            aProductionEnv({ PUBLIC_URL: value }),
            { ...DEV, PUBLIC_URL: value },
          ]) {
            const message = refusalText(source)

            expect(message, value).toContain('PUBLIC_URL')
            expect(message).not.toContain(A_PASSWORD)
            expect(message).not.toContain('camille')
          }
        }
      })
    })

    describe('a query string or a fragment', () => {
      // Every link is built by appending a path to PUBLIC_URL (join link and QR, invitation,
      // password reset, shared gallery, wall response), so `https://photos.example.com/?ref=x`
      // used to give `https://photos.example.com/?ref=x/join/ABC123`: a QR code that opens the
      // wrong page, and no error anywhere. It is read from the text as typed, never from
      // `url.search` / `url.hash`, which are both `''` for a bare `?` and a bare `#`.
      const REFUSED = /^PUBLIC_URL: PUBLIC_URL must not contain a query string or a fragment/

      it.each([
        ['a query string', 'https://photos.example.com/?ref=x'],
        ['a query string straight after the host', 'https://photos.example.com?ref=x'],
        ['a bare question mark', 'https://photos.example.com?'],
        ['a bare question mark after a slash', 'https://photos.example.com/?'],
        ['a query string after a path prefix', 'https://example.com/eventslide/?ref=x'],
        ['a bare question mark after a path prefix', 'https://example.com/eventslide?'],
        ['a bare question mark after a path prefix and a slash', 'https://example.com/photos/?'],
        ['a fragment', 'https://photos.example.com/#frag'],
        ['a fragment straight after the host', 'https://photos.example.com#frag'],
        ['a bare hash', 'https://photos.example.com#'],
        ['a bare hash after a slash', 'https://photos.example.com/#'],
        ['a fragment after a path prefix', 'https://example.com/eventslide/#frag'],
        ['a bare hash after a path prefix', 'https://example.com/eventslide#'],
        ['a query string and a fragment', 'https://photos.example.com/?a=1#top'],
        ['a fragment that holds a question mark', 'https://photos.example.com/#/route?x=1'],
        ['a query string that holds a slash', 'https://photos.example.com/?next=/join/ABC123'],
        ['a fragment that is a route', 'https://photos.example.com/#/route'],
        ['an uppercase scheme', 'HTTPS://photos.example.com/?ref=x'],
        ['a port', 'https://photos.example.com:8443/?ref=x'],
        ['localhost, which production exempts from https', 'http://localhost:4300/?ref=x'],
      ])('refuses %s, naming the variable, in production and outside it', (_name, typed) => {
        expect(refusalIssues(aProductionEnv({ PUBLIC_URL: typed }))).toEqual([
          expect.stringMatching(REFUSED),
        ])
        expect(refusalIssues({ ...DEV, PUBLIC_URL: typed })).toEqual([
          expect.stringMatching(REFUSED),
        ])
      })

      it('tells the operator how to keep a ? or a # that belongs in a path prefix', () => {
        const [issue] = refusalIssues({ ...DEV, PUBLIC_URL: 'https://photos.example.com/?x' })

        expect(issue).toContain('%3F')
        expect(issue).toContain('%23')
      })

      it('refuses them in a maintenance command too, which parses the same address', () => {
        try {
          loadMaintenanceConfig({ PUBLIC_URL: 'https://photos.example.com/#frag' })
        } catch (error) {
          expect(error instanceof ConfigError ? error.issues : []).toEqual([
            expect.stringMatching(REFUSED),
          ])
          return
        }
        throw new Error('loadMaintenanceConfig accepted a PUBLIC_URL with a fragment')
      })

      describe('what is not one: a ? or a # percent-encoded in the path', () => {
        // `%3F` and `%23` are characters of a path segment, not the start of a query or a
        // fragment: the join link stays under its prefix, which is the one thing a proxy
        // routes on. They stay accepted, and the parser keeps them as typed.
        it.each([
          ['an encoded question mark', 'https://example.com/what%3Fever', '/what%3Fever'],
          ['a lower-case encoded question mark', 'https://example.com/what%3fever', '/what%3fever'],
          ['an encoded hash', 'https://example.com/room%2342/', '/room%2342'],
          ['a lower-case encoded hash', 'https://example.com/room%2342', '/room%2342'],
          ['both, in two segments', 'https://example.com/a%3Fb/c%23d/', '/a%3Fb/c%23d'],
          [
            'an encoded question mark ending the prefix',
            'https://example.com/eventslide%3F',
            '/eventslide%3F',
          ],
        ])('accepts %s, and a join link built on it stays in the path', (_name, typed, path) => {
          for (const source of [
            aProductionEnv({ PUBLIC_URL: typed }),
            { ...DEV, PUBLIC_URL: typed },
          ]) {
            const { publicUrl } = loadConfig(source)
            const joinLink = new URL(`${publicUrl}/join/ABC123`)

            expect(publicUrl).toBe(`https://example.com${path}`)
            expect(joinLink.pathname).toBe(`${path}/join/ABC123`)
            expect(joinLink.search).toBe('')
            expect(joinLink.hash).toBe('')
          }
        })

        it('still refuses the same address once the ? or the # is written out', () => {
          expect(
            refusalIssues(aProductionEnv({ PUBLIC_URL: 'https://example.com/what%3Fever?x' })),
          ).toEqual([expect.stringMatching(REFUSED)])
          expect(
            refusalIssues(aProductionEnv({ PUBLIC_URL: 'https://example.com/room%2342#x' })),
          ).toEqual([expect.stringMatching(REFUSED)])
        })
      })

      it('names it beside the other problems when the value has more than one', () => {
        // Every boot problem at once, as everywhere else in this file: the operator does not
        // learn about a second mistake only after fixing the first and restarting.
        const plainHttp = refusalIssues(
          aProductionEnv({ PUBLIC_URL: 'http://photos.example.com/?x=1' }),
        )
        expect(plainHttp).toHaveLength(2)
        expect(plainHttp).toContainEqual(expect.stringMatching(REFUSED))
        expect(plainHttp).toContainEqual(
          expect.stringContaining('PUBLIC_URL must use https in production'),
        )

        const trailingSpace = refusalIssues({
          ...DEV,
          PUBLIC_URL: 'https://photos.example.com/?x ',
        })
        expect(trailingSpace).toHaveLength(2)
        expect(trailingSpace).toContainEqual(expect.stringMatching(REFUSED))
        expect(trailingSpace).toContainEqual(
          expect.stringMatching(/^PUBLIC_URL: PUBLIC_URL must not contain a tab or a line break/),
        )

        const credentials = refusalIssues({
          ...DEV,
          PUBLIC_URL: 'https://camille:secret@photos.example.com/#frag',
        })
        expect(credentials).toHaveLength(2)
        expect(credentials).toContainEqual(expect.stringMatching(REFUSED))
        expect(credentials).toContainEqual(
          expect.stringMatching(
            /^PUBLIC_URL: PUBLIC_URL must not contain a user name or a password/,
          ),
        )
      })

      it('names it beside a problem in another variable, in one refusal', () => {
        const issues = refusalIssues(
          aProductionEnv({ PUBLIC_URL: 'https://photos.example.com/?x=1', E2E_HOOKS: '1' }),
        )

        expect(issues.map((issue) => issue.split(':')[0]).sort()).toEqual([
          'E2E_HOOKS',
          'PUBLIC_URL',
        ])
      })

      it('never repeats what was typed, because a query string is where a token gets pasted', () => {
        for (const value of [
          `https://photos.example.com/?key=${A_PASSWORD}`,
          `https://photos.example.com/#${A_PASSWORD}`,
          `https://photos.example.com/eventslide?${A_PASSWORD}`,
          `https://camille:${A_PASSWORD}@photos.example.com/?x`,
        ]) {
          for (const source of [
            aProductionEnv({ PUBLIC_URL: value }),
            { ...DEV, PUBLIC_URL: value },
          ]) {
            const message = refusalText(source)

            expect(message, value).toContain('PUBLIC_URL')
            expect(message).not.toContain(A_PASSWORD)
          }
        }
      })
    })
  })

  describe('config warnings', () => {
    it('warns when production has no configured PUBLIC_URL, which is silently unreachable', () => {
      const config = loadConfig({
        NODE_ENV: 'production',
        SESSION_SECRET: A_REAL_SECRET,
        GUEST_TOKEN_SECRET: ANOTHER_REAL_SECRET,
      })

      expect(config.warnings.some((warning) => warning.includes('PUBLIC_URL'))).toBe(true)
    })

    it('is silent about PUBLIC_URL once it is configured, localhost included', () => {
      // TRUST_PROXY_HOPS named explicitly so only PUBLIC_URL is under test here — its
      // own warning has a case below.
      expect(loadConfig(aProductionEnv({ TRUST_PROXY_HOPS: '1' })).warnings).toEqual([])
      expect(
        loadConfig(aProductionEnv({ PUBLIC_URL: 'http://localhost:4300', TRUST_PROXY_HOPS: '1' }))
          .warnings,
      ).toEqual([])
    })

    it('never warns about PUBLIC_URL outside production, where the default is the point', () => {
      expect(loadConfig({ ...DEV }).warnings).toEqual([])
    })

    it('warns about TRUST_PROXY_HOPS=0 behind a Secure cookie in production', () => {
      const config = loadConfig(aProductionEnv({ TRUST_PROXY_HOPS: '0' }))

      expect(
        config.warnings.some(
          (warning) => warning.includes('TRUST_PROXY_HOPS') && warning.includes('Secure'),
        ),
      ).toBe(true)
    })

    it('is silent once TRUST_PROXY_HOPS names an actual proxy count', () => {
      expect(loadConfig(aProductionEnv({ TRUST_PROXY_HOPS: '1' })).warnings).toEqual([])
    })

    it('is silent about TRUST_PROXY_HOPS=0 when the cookie is not Secure either', () => {
      // The combination is what is risky, not the hop count alone: a box with no TLS in
      // front of it, whatever reason it has for one, is not missing a trusted proxy.
      const config = loadConfig(
        aProductionEnv({ TRUST_PROXY_HOPS: '0', SESSION_COOKIE_SECURE: 'false' }),
      )

      expect(config.warnings.some((warning) => warning.includes('TRUST_PROXY_HOPS'))).toBe(false)
    })

    it('reports every warning at once, the same way a refusal names every problem at once', () => {
      const config = loadConfig({
        NODE_ENV: 'production',
        SESSION_SECRET: A_REAL_SECRET,
        GUEST_TOKEN_SECRET: ANOTHER_REAL_SECRET,
        TRUST_PROXY_HOPS: '0',
      })

      expect(config.warnings).toHaveLength(2)
    })
  })
})

/**
 * `npm run db:migrate`, `purge`, `backup`, `restore`, `db:seed:demo`.
 *
 * They open the database and exit, so the two secrets are not a precondition for them —
 * docs/SECURITY.md §11 promises those commands need no configuration beyond `--database`
 * and `--media`, and a restore at two in the morning must not fail for want of a value the
 * operator keeps in a compose file. Everything else about the posture is identical, which
 * is the part that has to be pinned: the first attempt at this handed those scripts
 * `NODE_ENV=development` instead, which inverted the whole point of the default on exactly
 * the box §11 sends the operator to.
 */
describe('loadMaintenanceConfig', () => {
  it('boots with no secrets at all, because nothing it runs signs anything', () => {
    const config = loadMaintenanceConfig({})

    expect(config.storage.databasePath).toBe('./data/eventslide.sqlite')
  })

  it('still calls an unnamed environment production, so a script cannot mistake a venue box for a laptop', () => {
    // `seedDemo` used to refuse on `isProduction`, and the refusal died the moment an npm
    // script could hand it `NODE_ENV=development`. This keeps the reading honest; the
    // guard that actually protects a real database is now a question about the database.
    expect(loadMaintenanceConfig({}).isProduction).toBe(true)
  })

  it('generates the secrets it was not given rather than reaching for a constant', () => {
    const first = loadMaintenanceConfig({})
    const second = loadMaintenanceConfig({})

    expect(first.secrets.session).not.toBe(second.secrets.session)
  })

  it('still refuses every other production rule, so only the secrets differ', () => {
    try {
      loadMaintenanceConfig({ PUBLIC_URL: 'http://photos.example.com', E2E_HOOKS: '1' })
    } catch (error) {
      const issues = error instanceof ConfigError ? error.issues : []
      expect(issues.map((issue) => issue.split(':')[0]).sort()).toEqual(['E2E_HOOKS', 'PUBLIC_URL'])
      return
    }
    throw new Error('loadMaintenanceConfig accepted a configuration it should have refused')
  })

  it('still refuses a placeholder secret, which is the one a copied .env.example carries', () => {
    try {
      loadMaintenanceConfig({ SESSION_SECRET: 'change-me-in-production-at-least-32-characters' })
    } catch (error) {
      const issues = error instanceof ConfigError ? error.issues : []
      expect(issues).toContain(
        'SESSION_SECRET: SESSION_SECRET is still the example value from .env.example',
      )
      return
    }
    throw new Error('loadMaintenanceConfig accepted a placeholder secret')
  })
})
