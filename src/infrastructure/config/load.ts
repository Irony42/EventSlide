import {
  DEFAULT_RETENTION_SWEEP_MINUTES,
  DEFAULT_SCHEDULE_SWEEP_MINUTES,
  ephemeralSecret,
} from './schemaPrimitives'
import { UPSTREAM_REPOSITORY, canonicalPublicUrl } from './linkFields'
import type { serverSchema } from './schema'
import type { AppConfig } from './appConfig'

/**
 * The flood ceilings per client address and event when the operator names none: 300 uploads and
 * 600 reactions a minute. Each is raised to the per-guest figure if that is larger, because the
 * per-guest figure used to be the per-address one and an upgrade must not tighten a box that
 * raised it.
 */
const DEFAULT_UPLOAD_PER_IP_PER_MINUTE = 300
const DEFAULT_REACTION_PER_IP_PER_MINUTE = 600

/**
 * From a parsed schema to `AppConfig`: the field-by-field mapping, the boot warnings, the
 * refusal that lists every problem at once, and the source link the AGPL offer points at.
 */

/**
 * The address of the source of the build that is running — what AGPL section 13 obliges
 * a network service to offer to the people using it.
 *
 * In order: the operator's own `SOURCE_CODE_URL`; the ref the image was built from
 * (`SOURCE_REF`); and otherwise the upstream tag named after the running `version`. There
 * is no way to switch the offer off, deliberately, and no input that can make it empty.
 *
 * `version` is a parameter because this module does not read the manifest — it lives in
 * `src/main/version.ts` and an adapter may not import the composition root.
 */
export const resolveSourceUrl = (version: string, source: AppConfig['source']): string => {
  if (source.url !== null) return source.url
  if (source.ref !== null) return `${UPSTREAM_REPOSITORY}/tree/${source.ref}`
  return `${UPSTREAM_REPOSITORY}/tree/v${version}`
}

export class ConfigError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Invalid configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`)
    this.name = 'ConfigError'
  }
}

export type Source = Record<string, string | undefined>

interface WarningInputs {
  readonly isProduction: boolean
  /** The unparsed source, because a default and an explicit value parse identically. */
  readonly source: Source
  readonly secureCookie: boolean
  readonly trustProxyHops: number
  /** `MAIL_FROM` is set and `SMTP_URL` is not: a sender with nothing to send through. */
  readonly mailFromWithoutRelay: boolean
}

/**
 * Boot-time problems that are real but not worth a refusal — see `AppConfig.warnings`
 * and R-16 (roadmap: "self-hosters go silent on a changed default"). Apart from a deprecated
 * setting, which is wrong in every environment, the cases here are
 * a production boot that looks configured and is not, and both were a boot refusal in an
 * earlier draft; **`loadConfig` never throws for either**, because the configurations
 * they describe already run in the wild and a new refusal in a minor release would be
 * the rupture R-16 exists to name.
 */
const computeWarnings = ({
  isProduction,
  source,
  secureCookie,
  trustProxyHops,
  mailFromWithoutRelay,
}: WarningInputs): readonly string[] => {
  const warnings: string[] = []

  // A deprecated setting is wrong in every environment, so this precedes the production-only
  // checks. Read from the unparsed source: a default and an explicit value parse alike.
  const rawGuestGrace = source['GUEST_SELF_DELETE_GRACE_SECONDS']
  if (rawGuestGrace !== undefined) {
    warnings.push(
      'GUEST_SELF_DELETE_GRACE_SECONDS is deprecated and does nothing: how long a guest may take ' +
        'a photo back is a setting of each event, which its host chooses. Remove it from the ' +
        'environment; it will be removed in 4.0.0.',
    )
  }

  if (!isProduction) return warnings

  // Parsed, `raw.PUBLIC_URL` already carries its default and cannot say whether an
  // operator set it — only the unparsed source can. `PUBLIC_URL` has no `blankAsAbsent`
  // preprocessing, so a dangling `PUBLIC_URL=` never gets here: it fails the `URL.canParse`
  // refinement and the boot is refused before this runs. Only an absent variable reaches this
  // check; the blank branch is a belt-and-braces guard, not a state a boot can observe today.
  const rawPublicUrl = source['PUBLIC_URL']
  const publicUrlConfigured = rawPublicUrl !== undefined && rawPublicUrl.trim() !== ''
  if (!publicUrlConfigured) {
    warnings.push(
      'PUBLIC_URL is not set: production is falling back to http://localhost:5173, which is ' +
        'not an address a guest’s phone can reach. Set PUBLIC_URL to the address guests will ' +
        'actually use.',
    )
  }

  if (secureCookie && trustProxyHops === 0) {
    warnings.push(
      'TRUST_PROXY_HOPS is 0 with a Secure session cookie in production. If a reverse proxy ' +
        'sits in front of this box, as docs/SECURITY.md §11 expects, this is the same ' +
        'misconfiguration that silently breaks per-IP rate limiting, and a host can find a ' +
        'session stops working with no visible cause. Set TRUST_PROXY_HOPS to the number of ' +
        'reverse proxies in front of this box, or leave it at 0 only when nothing does.',
    )
  }

  if (mailFromWithoutRelay) {
    warnings.push(
      'MAIL_FROM is set but SMTP_URL is not: no mail will be sent, and an invitation or a ' +
        'password reset will be shown as a link to copy instead. Set SMTP_URL to send by ' +
        'e-mail, or remove MAIL_FROM.',
    )
  }

  return warnings
}

/**
 * The `NEW_CLIENT_` names in `source` that this version does not read, sorted.
 *
 * A misspelt ceiling (`NEW_CLIENT_MAX_EVENT=3`) is not a setting, and zod drops a key its schema
 * does not declare without a word: the box would boot with no ceiling at all for every new
 * client, which is the one outcome the family exists to prevent, and nothing would say so. The
 * prefix is this feature's own, so a name under it that is not a key of the schema is a typo, not
 * somebody else's variable. Checked against the schema's keys, so a variable added later is known
 * the moment it is declared. A value is never read here, only the name: this list is printed.
 */
const unknownNewClientNames = (schema: typeof serverSchema, source: Source): readonly string[] =>
  Object.keys(source)
    .filter((name) => name.startsWith('NEW_CLIENT_') && !Object.hasOwn(schema.shape, name))
    .sort()

export const load = (schema: typeof serverSchema, source: Source): AppConfig => {
  const parsed = schema.safeParse(source)
  // Every issue this schema can raise names a variable: an object-shape failure carries its key,
  // and each `addIssue` above sets `path` explicitly. There is no path-less case to format
  // around, so there is no branch here either. A name this version does not know is listed
  // beside them, so one restart shows every problem.
  const known = Object.keys(schema.shape).filter((name) => name.startsWith('NEW_CLIENT_'))
  const unknown = unknownNewClientNames(schema, source).map(
    (name) =>
      `${name}: not a setting of this version; the ceilings a new client starts with are ${known.join(', ')}`,
  )
  const problems = [
    ...(parsed.success
      ? []
      : parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)),
    ...unknown,
  ]
  if (!parsed.success || problems.length > 0) throw new ConfigError(problems)

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
    publicUrl: canonicalPublicUrl(raw.PUBLIC_URL),
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
      backupDir: raw.BACKUP_DIR,
      minFreeDiskBytes: raw.MIN_FREE_DISK_BYTES,
      sqliteShutdownCheckpoint: raw.SQLITE_SHUTDOWN_CHECKPOINT,
    },

    uploads: {
      maxBytes: raw.MAX_UPLOAD_BYTES,
      maxFiles: raw.MAX_FILES_PER_UPLOAD,
      maxPixels: raw.MAX_IMAGE_PIXELS,
      defaultEventQuotaBytes: raw.DEFAULT_EVENT_QUOTA_BYTES,
      maxEventQuotaBytes: raw.MAX_EVENT_QUOTA_BYTES ?? null,
      maxConcurrentRequests: raw.MAX_CONCURRENT_UPLOAD_REQUESTS,
    },

    clips: {
      maxBytes: raw.MAX_CLIP_BYTES,
      maxDurationMs: raw.MAX_CLIP_SECONDS * 1000,
      maxQueuedClips: raw.MAX_QUEUED_CLIPS,
      maxQueuedClipsPerEvent: raw.MAX_QUEUED_CLIPS_PER_EVENT,
      maxHeight: raw.CLIP_MAX_HEIGHT,
      maxPixels: raw.MAX_CLIP_PIXELS,
      ffmpegPath: raw.FFMPEG_PATH ?? null,
      ffprobePath: raw.FFPROBE_PATH ?? null,
      executableSearch: { path: raw.PATH, extensions: raw.PATHEXT },
      childEnvSource: {
        path: raw.PATH,
        pathExt: raw.PATHEXT,
        systemRoot: raw.SYSTEMROOT,
        winDir: raw.WINDIR,
        temp: raw.TEMP,
        tmp: raw.TMP,
      },
    },

    realtime: {
      maxStreamsPerClient: raw.MAX_STREAMS_PER_CLIENT,
      maxStreamsTotal: raw.MAX_STREAMS_TOTAL,
      maxSubscribersPerEvent: raw.MAX_SUBSCRIBERS_PER_EVENT,
    },

    retention: {
      sweepIntervalMs: sweepMinutes === null ? null : sweepMinutes * 60_000,
      capNoticeDays: raw.RETENTION_CAP_NOTICE_DAYS,
    },

    schedule: {
      sweepIntervalMs: scheduleSweepMinutes === null ? null : scheduleSweepMinutes * 60_000,
    },

    rateLimits: {
      uploadPerMinute: raw.UPLOAD_RATE_LIMIT_PER_MINUTE,
      uploadPerIpPerMinute:
        raw.UPLOAD_RATE_LIMIT_PER_IP_PER_MINUTE ??
        Math.max(DEFAULT_UPLOAD_PER_IP_PER_MINUTE, raw.UPLOAD_RATE_LIMIT_PER_MINUTE),
      joinPerMinute: raw.JOIN_RATE_LIMIT_PER_MINUTE,
      loginPerMinute: raw.LOGIN_RATE_LIMIT_PER_MINUTE,
      reactionPerMinute: raw.REACTION_RATE_LIMIT_PER_MINUTE,
      // Inert today: the schema caps REACTION_RATE_LIMIT_PER_MINUTE at 600, the default ceiling. Kept
      // so that the two lines stay alike if either figure moves.
      reactionPerIpPerMinute:
        raw.REACTION_RATE_LIMIT_PER_IP_PER_MINUTE ??
        Math.max(DEFAULT_REACTION_PER_IP_PER_MINUTE, raw.REACTION_RATE_LIMIT_PER_MINUTE),
      guestWritePerMinute: raw.GUEST_WRITE_RATE_LIMIT_PER_MINUTE,
      galleryPerMinute: raw.GALLERY_RATE_LIMIT_PER_MINUTE,
      galleryMediaPerMinute: raw.GALLERY_MEDIA_RATE_LIMIT_PER_MINUTE,
      galleryUnlockPerClient: raw.GALLERY_UNLOCK_ATTEMPTS_PER_CLIENT,
      galleryUnlockPerLink: raw.GALLERY_UNLOCK_ATTEMPTS_PER_LINK,
      eventCreationPerHour: raw.EVENT_CREATION_RATE_LIMIT_PER_HOUR,
    },

    crypto: {
      bcryptCost: raw.BCRYPT_COST,
    },

    bootstrap: {
      ownerEmail: raw.BOOTSTRAP_OWNER_EMAIL ?? null,
      ownerPassword: raw.BOOTSTRAP_OWNER_PASSWORD ?? null,
    },

    e2eHooks: raw.E2E_HOOKS ?? false,

    siteAdmin: raw.SITE_ADMIN === 'on',

    operatorResetLinks: raw.OPERATOR_RESET_LINKS,

    source: {
      url: raw.SOURCE_CODE_URL ?? null,
      ref: raw.SOURCE_REF ?? null,
    },

    support: {
      donationUrl: raw.DONATION_URL ?? null,
      budgetUrl: raw.BUDGET_URL ?? null,
    },

    operator: {
      name: raw.OPERATOR_NAME ?? null,
      contactEmail: raw.OPERATOR_CONTACT_EMAIL ?? null,
      termsUrl: raw.LEGAL_TERMS_URL ?? null,
      privacyUrl: raw.LEGAL_PRIVACY_URL ?? null,
      legalNoticeUrl: raw.LEGAL_NOTICE_URL ?? null,
      supportUrl: raw.SUPPORT_URL ?? null,
      reportUrl: raw.REPORT_URL ?? null,
    },

    termsOfUse:
      raw.LEGAL_TERMS_URL !== undefined && raw.LEGAL_TERMS_VERSION !== undefined
        ? { url: raw.LEGAL_TERMS_URL, version: raw.LEGAL_TERMS_VERSION }
        : null,

    events: {
      slugSuffix: raw.EVENT_SLUG_SUFFIX,
      allowCustomSlugs: raw.ALLOW_CUSTOM_SLUGS,
      joinCodeLength: raw.JOIN_CODE_LENGTH,
      creation: raw.EVENT_CREATION,
    },

    mail: {
      // Both halves or none: the refinement above refuses a relay with no sender, and a
      // sender with no relay has nothing to send through, so it is dropped — and warned about.
      smtp:
        raw.SMTP_URL !== undefined && raw.MAIL_FROM !== undefined
          ? { endpoint: raw.SMTP_URL, from: raw.MAIL_FROM }
          : null,
    },

    warnings: computeWarnings({
      isProduction,
      source,
      secureCookie: raw.SESSION_COOKIE_SECURE ?? isProduction,
      trustProxyHops: raw.TRUST_PROXY_HOPS,
      mailFromWithoutRelay: raw.MAIL_FROM !== undefined && raw.SMTP_URL === undefined,
    }),

    audit: {
      retentionDays: raw.AUDIT_RETENTION_DAYS,
    },

    newClientCeilings: {
      maxEvents: raw.NEW_CLIENT_MAX_EVENTS ?? null,
      maxEventsPerPeriod: raw.NEW_CLIENT_MAX_EVENTS_PER_PERIOD ?? null,
      maxTotalBytes: raw.NEW_CLIENT_MAX_TOTAL_BYTES ?? null,
      maxEventQuotaBytes: raw.NEW_CLIENT_MAX_EVENT_QUOTA_BYTES ?? null,
      maxRetentionDays: raw.NEW_CLIENT_MAX_RETENTION_DAYS ?? null,
      maxLiveDays: raw.NEW_CLIENT_MAX_LIVE_DAYS ?? null,
      clipsAllowed: raw.NEW_CLIENT_CLIPS_ALLOWED ?? true,
    },

    mfa: {
      encryptionKey: raw.MFA_ENCRYPTION_KEY?.bytes ?? null,
      requireOperatorSecondFactor: raw.REQUIRE_OPERATOR_2FA,
    },
  }
}
