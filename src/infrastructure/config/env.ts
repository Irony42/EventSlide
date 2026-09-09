import { z } from 'zod'

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

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: positiveInt(4300, 65535),
    PUBLIC_URL: z.string().url().default('http://localhost:5173'),
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

    GUEST_SELF_DELETE_GRACE_SECONDS: positiveInt(900, 86_400),
    UPLOAD_RATE_LIMIT_PER_MINUTE: positiveInt(12, 600),
    JOIN_RATE_LIMIT_PER_MINUTE: positiveInt(20, 600),
    LOGIN_RATE_LIMIT_PER_MINUTE: positiveInt(10, 600),
    REACTION_RATE_LIMIT_PER_MINUTE: positiveInt(30, 600),

    BCRYPT_COST: positiveInt(12, 15),

    BOOTSTRAP_OWNER_EMAIL: z.string().optional(),
    BOOTSTRAP_OWNER_PASSWORD: z.string().optional(),

    /** Enables the display timing hooks the Playwright suite drives. Never in production. */
    E2E_HOOKS: boolish.optional(),
  })
  .superRefine((raw, ctx) => {
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
    throw new ConfigError(
      parsed.error.issues.map((issue) =>
        issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message,
      ),
    )
  }

  const raw = parsed.data
  const isProduction = raw.NODE_ENV === 'production'

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
