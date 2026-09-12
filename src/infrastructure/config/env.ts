import { z } from 'zod'
import { Password } from '../../domain/users/password'

/**
 * The only module in the codebase that reads `process.env`. Lint enforces that
 * everywhere else, and the reason is that 1.0 read the environment inline at module
 * load in `src/index.ts`, so a missing variable produced a runtime surprise at the
 * first request rather than a refusal to boot.
 *
 * Everything is parsed and validated once. Failure is fatal and the message names
 * every problem at once, because discovering misconfiguration one variable per restart
 * is miserable when you are setting up in a venue an hour before the guests arrive.
 */

/** `.env` files give strings; this coerces and bounds them. */
const positiveInt = (fallback: number, max?: number) => {
  const base = z.coerce.number().int().positive()
  return (max === undefined ? base : base.max(max)).default(fallback)
}

const boolish = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1')

/**
 * Values shipped in `.env.example`. Booting production with one of these is worse than
 * booting with nothing, because it looks configured.
 */
const PLACEHOLDER_SECRETS = new Set([
  'change-me-in-production-at-least-32-characters',
  'change-me-too-at-least-32-characters-long',
  'dev-session-secret',
  'secret',
])

const secret = (name: string) =>
  z
    .string()
    .min(32, `${name} must be at least 32 characters`)
    .refine((value) => !PLACEHOLDER_SECRETS.has(value), {
      message: `${name} is still the example value from .env.example`,
    })

/**
 * How often the in-process retention sweep runs, in minutes — or the word `off`.
 *
 * **`0` is deliberately not the way to disable it.** Every other numeric setting here
 * goes through `z.coerce.number()`, and `Number('')` is `0`: a compose file with a
 * dangling `RETENTION_SWEEP_INTERVAL_MINUTES=`, a templated value that rendered empty,
 * a truncated secret manager entry would all silently switch off a deletion the host
 * promised their guests — the one failure mode nobody would notice, because its symptom
 * is that nothing happens. So the empty string and `0` are refusals that name the
 * variable at boot, and turning retention off takes a word somebody had to mean.
 *
 * Bounded at a day at the top, like the other numeric settings: a sweep that runs less
 * often than the coarsest retention period anyone sets in days is indistinguishable
 * from one that is off, and should be written as `off`.
 */
const RETENTION_SWEEP_OFF = 'off'
const RETENTION_SWEEP_MAX_MINUTES = 1_440

const retentionSweepInterval = z
  .string()
  .trim()
  .refine(
    (value) =>
      value === RETENTION_SWEEP_OFF ||
      (/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= RETENTION_SWEEP_MAX_MINUTES),
    {
      message: `RETENTION_SWEEP_INTERVAL_MINUTES must be a whole number of minutes from 1 to ${RETENTION_SWEEP_MAX_MINUTES}, or the word '${RETENTION_SWEEP_OFF}' to stop honouring retention automatically`,
    },
  )
  // `null` is "never", and it is only ever reached through that word.
  .transform((value): number | null => (value === RETENTION_SWEEP_OFF ? null : Number(value)))

/** Hourly. Retention is measured in days, so this is about bounding lag, not precision. */
const DEFAULT_RETENTION_SWEEP_MINUTES = 60

/**
 * The public origin. `z.string().url()` alone accepts any parseable URL, including
 * `javascript:alert(1)` and `data:text/html,…`: the value is concatenated into the
 * event DTO's `joinUrl`, which the admin console renders as a link and as a QR code,
 * so a non-navigable scheme would put a script URI behind the join button. A guest's
 * phone has to be able to open it, which leaves exactly two schemes; production
 * narrows that further to https, or http on localhost behind a TLS proxy.
 */
const publicUrl = z
  .string()
  .url()
  .refine((value) => /^https?:\/\//i.test(value), {
    message: 'PUBLIC_URL must be an http or https origin',
  })

/**
 * `""` is absent, not a value.
 *
 * `compose.yaml` passes the first-owner variables as `${BOOTSTRAP_OWNER_EMAIL:-}` and
 * `${BOOTSTRAP_OWNER_PASSWORD:-}`, which Docker renders as an **empty string** whenever
 * the operator did not set them — so the ordinary case, `docker compose up` with no
 * first owner wanted, arrives here as `""` and not as `undefined`. Read as a value it
 * made `bootstrapFirstOwner` call the use case with an empty password and log
 * `could not create the first owner account` on every boot of a default deployment;
 * read as a policy failure, now that there is a policy, it would refuse that boot.
 */
const blankAsAbsent = (value: unknown): unknown => (value === '' ? undefined : value)

/**
 * The domain's password policy, applied at boot so the failure is a named ConfigError.
 *
 * This is exactly the reasoning written on `BCRYPT_COST` below, for the same shape of
 * defect. `bootstrapOwner` already runs `Password.create`, but it runs it while
 * `src/main/container.ts` is assembling the application, where the only outcome is one
 * log line saying the first owner could not be created — and the operator finds out by
 * meeting a login form that rejects them. Refusing here makes a weak bootstrap password
 * one of the problems the boot refusal lists, beside every other bad variable.
 *
 * The minimum is **not** restated: `Password.minLength` owns it, and a second `12` in
 * this file would be a number free to drift away from the rule it is quoting. The whole
 * policy is applied rather than the length alone, so `changemenow1` is refused here for
 * the same reason it is refused from the account form.
 *
 * No `PasswordContext`: the same-as-email and same-as-name checks need the other
 * variables, and a cross-field refusal belongs in the object refinement, not in a field
 * that cannot see them.
 */
const bootstrapOwnerPassword = z.string().superRefine((value, ctx) => {
  const parsed = Password.create(value)
  if (parsed.ok) return
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message: `BOOTSTRAP_OWNER_PASSWORD must satisfy the same policy as any other account password: at least ${Password.minLength} characters, and not a guessable one (${parsed.error.code})`,
  })
})

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: positiveInt(4300, 65535),
    PUBLIC_URL: publicUrl.default('http://localhost:5173'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    // Optional here, required for production by the refinement below, so a developer
    // can `npm run dev` with no .env at all.
    SESSION_SECRET: secret('SESSION_SECRET').optional(),
    GUEST_TOKEN_SECRET: secret('GUEST_TOKEN_SECRET').optional(),

    SESSION_COOKIE_SECURE: boolish.optional(),
    /** Reverse proxies in front of the app. Wrong values break per-IP rate limiting. */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),

    DATABASE_PATH: z.string().min(1).default('./data/eventslide.sqlite'),
    MEDIA_ROOT: z.string().min(1).default('./media'),

    MAX_UPLOAD_BYTES: positiveInt(25_000_000),
    MAX_FILES_PER_UPLOAD: positiveInt(20, 100),
    /** Checked against the header before decoding — the decompression-bomb control. */
    MAX_IMAGE_PIXELS: positiveInt(50_000_000),
    DEFAULT_EVENT_QUOTA_BYTES: positiveInt(5_000_000_000),

    /**
     * Left optional so the default can depend on NODE_ENV, below: a background sweep
     * firing inside the end-to-end suite would delete a fixture's event mid-journey.
     */
    RETENTION_SWEEP_INTERVAL_MINUTES: retentionSweepInterval.optional(),

    GUEST_SELF_DELETE_GRACE_SECONDS: positiveInt(900, 86_400),
    UPLOAD_RATE_LIMIT_PER_MINUTE: positiveInt(12, 600),
    JOIN_RATE_LIMIT_PER_MINUTE: positiveInt(20, 600),
    LOGIN_RATE_LIMIT_PER_MINUTE: positiveInt(10, 600),
    REACTION_RATE_LIMIT_PER_MINUTE: positiveInt(30, 600),

    /**
     * Bounded at both ends. `createBcryptPasswordHasher` refuses anything outside
     * 10-15 with a bare `Error`, so without the floor a cost of 9 passed validation
     * here and then failed while the container was assembling adapters — an exception
     * that names neither the variable nor the file that owns it. Refusing it here is
     * what makes the aggregated ConfigError the single place a misconfigured boot is
     * explained.
     */
    BCRYPT_COST: z.coerce
      .number()
      .int()
      .min(10, 'BCRYPT_COST must be at least 10')
      .max(15, 'BCRYPT_COST must be at most 15')
      .default(12),

    /**
     * The first owner of an instance, created once against an empty database and then
     * ignored. Both halves are needed or neither is; see the refinement below.
     */
    BOOTSTRAP_OWNER_EMAIL: z.preprocess(blankAsAbsent, z.string().optional()),
    BOOTSTRAP_OWNER_PASSWORD: z.preprocess(blankAsAbsent, bootstrapOwnerPassword.optional()),

    /** Enables the display timing hooks the Playwright suite drives. Never in production. */
    E2E_HOOKS: boolish.optional(),
  })
  .superRefine((raw, ctx) => {
    // The first owner is a pair, and half of one creates nothing. Before `""` meant
    // absent, the missing half reached `bootstrapOwner` as an empty string and was
    // refused into a log line; silently doing nothing instead would be no better, so
    // the half that is missing is named at boot beside every other bad variable.
    const email = raw.BOOTSTRAP_OWNER_EMAIL
    const password = raw.BOOTSTRAP_OWNER_PASSWORD
    if ((email === undefined) !== (password === undefined)) {
      const missing = email === undefined ? 'BOOTSTRAP_OWNER_EMAIL' : 'BOOTSTRAP_OWNER_PASSWORD'
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [missing],
        message: `${missing} is required alongside the other half of the first-owner bootstrap: an email with no password, or a password with no email, creates no account at all`,
      })
    }

    if (raw.NODE_ENV !== 'production') return

    for (const name of ['SESSION_SECRET', 'GUEST_TOKEN_SECRET'] as const) {
      if (raw[name] === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [name],
          message: `${name} is required in production`,
        })
      }
    }
    if (raw.E2E_HOOKS === true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['E2E_HOOKS'],
        message: 'E2E_HOOKS must not be enabled in production',
      })
    }
    if (raw.PUBLIC_URL.startsWith('http://') && !raw.PUBLIC_URL.startsWith('http://localhost')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PUBLIC_URL'],
        message:
          'PUBLIC_URL must use https in production: guests submit photos over this origin, and a Secure session cookie will not be sent over http',
      })
    }
  })

export type RawConfig = z.infer<typeof schema>

/**
 * The shape the rest of the application receives. Grouped by concern rather than
 * mirroring the flat variable names, so a use case takes `config.uploads` instead of
 * eleven separate arguments.
 */
export interface AppConfig {
  readonly env: 'development' | 'test' | 'production'
  readonly isProduction: boolean
  readonly port: number
  readonly publicUrl: string
  readonly logLevel: RawConfig['LOG_LEVEL']
  readonly trustProxyHops: number

  readonly secrets: {
    readonly session: string
    readonly guestToken: string
  }

  readonly session: {
    readonly secureCookie: boolean
  }

  readonly storage: {
    readonly databasePath: string
    readonly mediaRoot: string
  }

  readonly uploads: {
    readonly maxBytes: number
    readonly maxFiles: number
    readonly maxPixels: number
    readonly defaultEventQuotaBytes: number
  }

  readonly guests: {
    readonly selfDeleteGraceMs: number
  }

  readonly retention: {
    /**
     * How often `src/main` sweeps events whose retention deadline has passed.
     * `null` means never: `npm run purge` is then the only thing that honours the
     * setting, which is the supported arrangement when a cron or systemd timer owns
     * the schedule.
     */
    readonly sweepIntervalMs: number | null
  }

  readonly rateLimits: {
    readonly uploadPerMinute: number
    readonly joinPerMinute: number
    readonly loginPerMinute: number
    readonly reactionPerMinute: number
  }

  readonly crypto: {
    readonly bcryptCost: number
  }

  readonly bootstrap: {
    readonly ownerEmail: string | null
    readonly ownerPassword: string | null
  }

  readonly e2eHooks: boolean
}

export class ConfigError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Invalid configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`)
    this.name = 'ConfigError'
  }
}

/**
 * Parse and validate. Throws {@link ConfigError} listing every problem.
 *
 * `source` is a parameter so tests pass a plain object and never touch the real
 * environment.
 */
export const loadConfig = (source: Record<string, string | undefined> = process.env): AppConfig => {
  const parsed = schema.safeParse(source)
  if (!parsed.success) {
    // Every issue this schema can raise names a variable: an object-shape failure
    // carries its key, and each `addIssue` above sets `path` explicitly. There is no
    // path-less case to format around, so there is no branch here either.
    throw new ConfigError(
      parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    )
  }

  const raw = parsed.data
  const isProduction = raw.NODE_ENV === 'production'

  /**
   * Off under `NODE_ENV=test`, on everywhere else.
   *
   * The end-to-end suite boots this exact binary (`tests/e2e/fixtures/startTestApp.ts`)
   * with `NODE_ENV=test` and no retention variable, so the safe value has to be the one
   * nobody sets: a sweep firing between two steps of a journey would delete the event
   * the journey is asserting on, and it would do it on a timer nothing in the test can
   * see. Development and production get an hourly sweep with no configuration at all,
   * which is what makes `docker compose up` honour a host's retention setting.
   */
  // Not `??`: the configured value is `null` for `off`, which is nullish and would fall
  // straight back to the default it was written to override.
  const sweepMinutes =
    raw.RETENTION_SWEEP_INTERVAL_MINUTES === undefined
      ? raw.NODE_ENV === 'test'
        ? null
        : DEFAULT_RETENTION_SWEEP_MINUTES
      : raw.RETENTION_SWEEP_INTERVAL_MINUTES

  return {
    env: raw.NODE_ENV,
    isProduction,
    port: raw.PORT,
    // Trailing slashes would produce `//join/ABC123` in a QR code.
    publicUrl: raw.PUBLIC_URL.replace(/\/+$/, ''),
    logLevel: raw.LOG_LEVEL,
    trustProxyHops: raw.TRUST_PROXY_HOPS,

    secrets: {
      // Non-production only: the superRefine above makes these present in production.
      session: raw.SESSION_SECRET ?? 'development-only-session-secret-not-for-production',
      guestToken: raw.GUEST_TOKEN_SECRET ?? 'development-only-guest-token-secret-not-for-prod',
    },

    session: {
      // Follows NODE_ENV unless set explicitly. Getting this wrong behind plain HTTP
      // makes login silently impossible, which is why it is worth an explicit default.
      secureCookie: raw.SESSION_COOKIE_SECURE ?? isProduction,
    },

    storage: {
      databasePath: raw.DATABASE_PATH,
      mediaRoot: raw.MEDIA_ROOT,
    },

    uploads: {
      maxBytes: raw.MAX_UPLOAD_BYTES,
      maxFiles: raw.MAX_FILES_PER_UPLOAD,
      maxPixels: raw.MAX_IMAGE_PIXELS,
      defaultEventQuotaBytes: raw.DEFAULT_EVENT_QUOTA_BYTES,
    },

    guests: {
      selfDeleteGraceMs: raw.GUEST_SELF_DELETE_GRACE_SECONDS * 1000,
    },

    retention: {
      sweepIntervalMs: sweepMinutes === null ? null : sweepMinutes * 60_000,
    },

    rateLimits: {
      uploadPerMinute: raw.UPLOAD_RATE_LIMIT_PER_MINUTE,
      joinPerMinute: raw.JOIN_RATE_LIMIT_PER_MINUTE,
      loginPerMinute: raw.LOGIN_RATE_LIMIT_PER_MINUTE,
      reactionPerMinute: raw.REACTION_RATE_LIMIT_PER_MINUTE,
    },

    crypto: {
      bcryptCost: raw.BCRYPT_COST,
    },

    bootstrap: {
      ownerEmail: raw.BOOTSTRAP_OWNER_EMAIL ?? null,
      ownerPassword: raw.BOOTSTRAP_OWNER_PASSWORD ?? null,
    },

    e2eHooks: raw.E2E_HOOKS ?? false,
  }
}
