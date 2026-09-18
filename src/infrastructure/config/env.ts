import { randomBytes } from 'node:crypto'
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
 * What a boot that was given no secret signs with.
 *
 * There used to be two constants here — `development-only-session-secret-not-for-production`
 * and its guest-token twin — and they were the whole of the defect. A constant in a public
 * repository is a key every reader of the repository already holds, so an instance that
 * reached them could have its host session and its guest tokens forged by anybody; and the
 * only thing standing between a venue box and that state was an environment variable the
 * operator had to remember to set. Refusing in production was already correct and is
 * unchanged; what was wrong is that *not saying* meant development.
 *
 * Both halves of the fix live here. `NODE_ENV` now defaults to `production`, so silence is
 * the strict posture and the boot refuses; and the non-production fallback is 48 random
 * bytes rather than a constant, so there is no longer a repo-public secret for any
 * configuration to reach. The question "can a box boot with a secret this repository
 * publishes" now has no code path to answer yes with, rather than a discouraged one.
 *
 * What it costs is honest and small: an ephemeral secret dies with the process, so a
 * development restart logs every host out and invalidates every outstanding guest token.
 * `npm run dev` is a `tsx watch`, so that is a real inconvenience — and it is the one the
 * boot log names, with the two variables that end it. A developer who wants sessions to
 * survive a reload sets them; a venue box has to.
 */
const EPHEMERAL_SECRET_BYTES = 48
const ephemeralSecret = (): string => randomBytes(EPHEMERAL_SECRET_BYTES).toString('base64url')

/**
 * How often one of the in-process sweeps runs, in minutes — or the word `off`.
 *
 * **`0` is deliberately not the way to disable one.** Every other numeric setting here
 * goes through `z.coerce.number()`, and `Number('')` is `0`: a compose file with a
 * dangling `RETENTION_SWEEP_INTERVAL_MINUTES=`, a templated value that rendered empty,
 * a truncated secret manager entry would all silently switch off a deletion the host
 * promised their guests — the one failure mode nobody would notice, because its symptom
 * is that nothing happens. So the empty string and `0` are refusals that name the
 * variable at boot, and turning a sweep off takes a word somebody had to mean.
 *
 * Bounded at a day at the top, like the other numeric settings: a sweep that runs less
 * often than the thing it acts on is indistinguishable from one that is off, and should
 * be written as `off`.
 *
 * Shared by both sweeps rather than written twice. The rule here is subtle enough —
 * `Number('')` is the whole reason for it — that two copies would be two chances to
 * lose it.
 */
const SWEEP_OFF = 'off'
const SWEEP_MAX_MINUTES = 1_440

const sweepInterval = (name: string, consequence: string) =>
  z
    .string()
    .trim()
    .refine(
      (value) =>
        value === SWEEP_OFF ||
        (/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= SWEEP_MAX_MINUTES),
      {
        message: `${name} must be a whole number of minutes from 1 to ${SWEEP_MAX_MINUTES}, or the word '${SWEEP_OFF}' ${consequence}`,
      },
    )
    // `null` is "never", and it is only ever reached through that word.
    .transform((value): number | null => (value === SWEEP_OFF ? null : Number(value)))

const retentionSweepInterval = sweepInterval(
  'RETENTION_SWEEP_INTERVAL_MINUTES',
  'to stop honouring retention automatically',
)

/**
 * The scheduling sweep. Five minutes, because this one's lag is visible in the room:
 * an event scheduled for 18:00 opens somewhere in 18:00–18:05, and a guest scanning the
 * QR code in that window is told the party has not started. Retention can afford an
 * hour; a door cannot.
 *
 * Shorter would buy very little — the work is one indexed query against a handful of
 * rows — but the instants a host types are minutes, not seconds, and a sweep that fires
 * twelve times an hour is already inside the granularity of the thing it acts on.
 */
const scheduleSweepInterval = sweepInterval(
  'SCHEDULE_SWEEP_INTERVAL_MINUTES',
  'to stop opening and closing events automatically',
)

/** Hourly. Retention is measured in days, so this is about bounding lag, not precision. */
const DEFAULT_RETENTION_SWEEP_MINUTES = 60

/** See {@link scheduleSweepInterval}: the worst case a guest can be told "not yet". */
const DEFAULT_SCHEDULE_SWEEP_MINUTES = 5

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

/**
 * One schema, built twice, differing in exactly one refinement.
 *
 * The maintenance commands — `db:migrate`, `purge`, `backup`, `restore`, `db:seed:demo` —
 * open the database and the media root and exit. They sign no cookie, mint no token and
 * answer no request, so the two secrets are not a precondition for them; and requiring
 * them would break the promise docs/SECURITY.md §11 makes about those commands, that they
 * need no configuration beyond `--database` and `--media`. A restore at two in the morning
 * must not fail because the operator's shell does not carry a value their compose file
 * holds.
 *
 * It is deliberately **not** done by handing those scripts a `NODE_ENV=development`, which
 * is where this landed first and was wrong twice over: it inverts "silence is the strict
 * posture" on exactly the box §11 sends the operator to, and it makes `seedDemo`'s own
 * refusal to touch a production database unreachable, since the guard's only input would
 * be a variable the npm script itself writes. Everything else — the `NODE_ENV` default,
 * the placeholder blocklist, the 32-character floor, the https `PUBLIC_URL` rule, the
 * `E2E_HOOKS` refusal — is the same in both.
 */
interface SchemaOptions {
  readonly secretsRequiredInProduction: boolean
}

const buildSchema = ({ secretsRequiredInProduction }: SchemaOptions) =>
  z
    .object({
      /**
       * **Absent means production.** This is the security default of the whole file.
       *
       * It used to default to `development`, and five controls hang off it at once: both
       * signing secrets fell back to constants published in this repository, the session
       * cookie lost `Secure`, HSTS and `upgrade-insecure-requests` were not sent, and the
       * CSP admitted `'unsafe-inline'` in `script-src`. So a self-hosted operator who ran
       * the built server without setting one variable got a box whose session cookie
       * anybody could forge — and nothing said so. `docker compose up` was never the
       * problem (`compose.yaml` and the `Dockerfile` both set `NODE_ENV=production`); the
       * problem was every other way of starting it, including the systemd unit
       * docs/SECURITY.md §11 recommends.
       *
       * Inverting it makes the failure mode a refusal instead of a silent downgrade: a
       * process that was told nothing now asks for real secrets and stops without them.
       * Development declares itself — `scripts/dev.env`, loaded by the npm scripts that run
       * from a source checkout, is where it does.
       *
       * The blank is deliberately absent rather than a value, for the reason written on
       * {@link sweepInterval}: a compose file with a dangling `NODE_ENV=`, or a template
       * that rendered empty, must not be the one input that relaxes the posture. It lands
       * on the strict default like any other absence.
       */
      NODE_ENV: z.preprocess(
        blankAsAbsent,
        z.enum(['development', 'test', 'production']).default('production'),
      ),
      PORT: positiveInt(4300, 65535),
      PUBLIC_URL: publicUrl.default('http://localhost:5173'),
      LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

      // Optional here, required for production by the refinement below, so a developer
      // can `npm run dev` with no .env at all.
      //
      // Blank is absent, for the reason written on `NODE_ENV` and on the sweep intervals:
      // a compose file with a dangling `SESSION_SECRET=` deserves to be told the variable
      // is required rather than that it is thirty-two characters short — and
      // `scripts/verify-image.sh` asserts on the first of those two messages, so without
      // this the image check reads as one assertion and makes another.
      SESSION_SECRET: z.preprocess(blankAsAbsent, secret('SESSION_SECRET').optional()),
      GUEST_TOKEN_SECRET: z.preprocess(blankAsAbsent, secret('GUEST_TOKEN_SECRET').optional()),

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
       * Clips have their own byte limit, deliberately separate from `MAX_UPLOAD_BYTES`.
       *
       * Raising the photo limit would raise the per-request heap ceiling that
       * `guestRoutes.ts` derives from it, and `compose.yaml`'s memory limit was reasoned
       * against that number. A clip does not need the same budget anyway: it goes to disk
       * rather than to the heap, one file per request, and fifteen seconds off a phone is
       * 20 to 60 MB.
       */
      MAX_CLIP_BYTES: positiveInt(80_000_000),
      /**
       * The duration cap, enforced twice — refused at the probe and passed to the encoder
       * as a hard bound, because a truncated container's header is a claim by the file.
       * Bounded at two minutes so that no configuration turns the wall into a cinema.
       */
      MAX_CLIP_SECONDS: positiveInt(15, 120),
      /**
       * How many clips may be waiting or transcoding across the whole box before an upload
       * is answered `429 clip.queueFull`. Process-wide, because one worker drains the queue
       * for every event and the wait a guest experiences is the global one.
       */
      MAX_QUEUED_CLIPS: positiveInt(20, 500),
      /** The projected height of a clip. 720p reads well at 3 m and encodes quickly. */
      CLIP_MAX_HEIGHT: positiveInt(720, 2_160),
      /**
       * The decompression-bomb control for video, judged from the header before a frame is
       * decoded — the exact counterpart of MAX_IMAGE_PIXELS.
       *
       * CLIP_MAX_HEIGHT is not one: it scales the *output*, and the filter that does it
       * runs after the decoder has already allocated the frame. The default admits 8K UHD
       * (7680x4320, 33 MP) and refuses the 16000x16000 container that is 380 MB a frame.
       */
      MAX_CLIP_PIXELS: positiveInt(33_177_600),

      /**
       * Where the encoder is, when it is not simply on `PATH`.
       *
       * A configured path that does not exist is a refusal rather than a fallback: an
       * operator who set this wanted that build, and quietly using another one is how a
       * deployment ends up encoding with something nobody chose.
       */
      FFMPEG_PATH: z.preprocess(blankAsAbsent, z.string().optional()),
      FFPROBE_PATH: z.preprocess(blankAsAbsent, z.string().optional()),

      /**
       * `PATH` and `PATHEXT`, read here because this is the only module allowed to read
       * the environment at all — and then handed to the binary resolver as a value.
       *
       * The resolver needs them because `spawn` is never given `shell: true` (that is
       * CVE-2024-27980 on Windows), and without a shell Node does not apply `PATHEXT`, so
       * a bare `ffmpeg` fails on a machine where `ffmpeg.exe` is sitting on the path.
       * Carrying them as configuration also lets a test hand the resolver an empty search
       * path and exercise the "no encoder anywhere" branch without depending on the
       * machine running the suite.
       */
      PATH: z.string().default(''),
      PATHEXT: z.string().default(''),

      /**
       * Left optional so the default can depend on NODE_ENV, below: a background sweep
       * firing inside the end-to-end suite would delete a fixture's event mid-journey.
       */
      RETENTION_SWEEP_INTERVAL_MINUTES: retentionSweepInterval.optional(),

      /**
       * Optional for the same reason as the line above: under `NODE_ENV=test` the default
       * has to be off. A sweep firing mid-journey would open — or close — the event a
       * Playwright spec is asserting on, on a timer nothing in the test can see.
       */
      SCHEDULE_SWEEP_INTERVAL_MINUTES: scheduleSweepInterval.optional(),

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

      if (secretsRequiredInProduction) {
        for (const name of ['SESSION_SECRET', 'GUEST_TOKEN_SECRET'] as const) {
          if (raw[name] === undefined) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [name],
              message: `${name} is required in production`,
            })
          }
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

/** What a server parses with: both secrets are a precondition in production. */
const serverSchema = buildSchema({ secretsRequiredInProduction: true })

/** What a maintenance command parses with. See {@link buildSchema}. */
const maintenanceSchema = buildSchema({ secretsRequiredInProduction: false })

export type RawConfig = z.infer<typeof serverSchema>

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
    /**
     * Which of the two were generated for this boot instead of configured, by name.
     *
     * Names rather than a flag, because the two are independent and the consequence is
     * not: a developer who set `SESSION_SECRET` and not `GUEST_TOKEN_SECRET` keeps their
     * sign-in across a reload and loses every guest token, and a single boolean made the
     * log line say both were going. Empty is the configured case.
     *
     * Only ever non-empty outside a server's production boot — the refinement refuses one
     * that is missing either — and it exists so the boot log can say which arrangement is
     * in force. §14.7 of docs/SECURITY.md recorded that nothing did, and a developer who
     * cannot tell why they were signed out by a hot reload is the mild case; the expensive
     * one is not knowing that a restart invalidates every guest token.
     *
     * Deliberately not reported by `/api/ready`: that endpoint answers an unauthenticated
     * caller, and how a box signs its cookies is not something it should volunteer.
     */
    readonly generated: readonly ('SESSION_SECRET' | 'GUEST_TOKEN_SECRET')[]
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

  readonly clips: {
    readonly maxBytes: number
    readonly maxDurationMs: number
    readonly maxQueuedClips: number
    readonly maxHeight: number
    readonly maxPixels: number
    readonly ffmpegPath: string | null
    readonly ffprobePath: string | null
    /** `PATH` and `PATHEXT` as values; see the schema for why they are carried at all. */
    readonly executableSearch: {
      readonly path: string
      readonly extensions: string
    }
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

  readonly schedule: {
    /**
     * How often `src/main` opens the events that were due to open and closes the ones
     * that were due to close. `null` means never: the two fields stay settable and
     * visible, and nothing ever acts on them — which is the right answer under
     * `NODE_ENV=test`, and a deliberate choice anywhere else.
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

type Source = Record<string, string | undefined>

const load = (schema: typeof serverSchema, source: Source): AppConfig => {
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

  /** Same shape, same reasoning, for the sweep that opens and closes events. */
  const scheduleSweepMinutes =
    raw.SCHEDULE_SWEEP_INTERVAL_MINUTES === undefined
      ? raw.NODE_ENV === 'test'
        ? null
        : DEFAULT_SCHEDULE_SWEEP_MINUTES
      : raw.SCHEDULE_SWEEP_INTERVAL_MINUTES

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
      // Generated rather than constant, and generated per secret rather than once, so a
      // guest cookie can never be replayed as a session — see {@link ephemeralSecret}.
      session: raw.SESSION_SECRET ?? ephemeralSecret(),
      guestToken: raw.GUEST_TOKEN_SECRET ?? ephemeralSecret(),
      generated: (['SESSION_SECRET', 'GUEST_TOKEN_SECRET'] as const).filter(
        (name) => raw[name] === undefined,
      ),
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

    clips: {
      maxBytes: raw.MAX_CLIP_BYTES,
      maxDurationMs: raw.MAX_CLIP_SECONDS * 1000,
      maxQueuedClips: raw.MAX_QUEUED_CLIPS,
      maxHeight: raw.CLIP_MAX_HEIGHT,
      maxPixels: raw.MAX_CLIP_PIXELS,
      ffmpegPath: raw.FFMPEG_PATH ?? null,
      ffprobePath: raw.FFPROBE_PATH ?? null,
      executableSearch: { path: raw.PATH, extensions: raw.PATHEXT },
    },

    guests: {
      selfDeleteGraceMs: raw.GUEST_SELF_DELETE_GRACE_SECONDS * 1000,
    },

    retention: {
      sweepIntervalMs: sweepMinutes === null ? null : sweepMinutes * 60_000,
    },

    schedule: {
      sweepIntervalMs: scheduleSweepMinutes === null ? null : scheduleSweepMinutes * 60_000,
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

/**
 * Parse and validate, for a process that is going to serve requests. Throws
 * {@link ConfigError} listing every problem.
 *
 * `source` is a parameter so tests pass a plain object and never touch the real
 * environment.
 */
export const loadConfig = (source: Source = process.env): AppConfig => load(serverSchema, source)

/**
 * The same, for a command that opens the database and exits — `db:migrate`, `purge`,
 * `backup`, `restore`, `db:seed:demo`.
 *
 * One difference and it is written on {@link buildSchema}: the two secrets are not a
 * precondition, because nothing here signs anything. Every other refusal is identical,
 * `NODE_ENV` still defaults to `production`, and `isProduction` therefore still means what
 * it means everywhere else — which is what `seedDemo` needs it to mean.
 *
 * It is not a way to start a server without secrets. Absent ones are generated per boot,
 * so a server built on this config would mint sessions nothing else can verify and lose
 * every one of them on restart. `src/main/index.ts` calls `loadConfig`.
 */
export const loadMaintenanceConfig = (source: Source = process.env): AppConfig =>
  load(maintenanceSchema, source)
