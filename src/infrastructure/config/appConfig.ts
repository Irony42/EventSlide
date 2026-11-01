import type { OperatorResetLinks } from '../../domain/clients/operatorGuard'
import type { TermsOfUse } from '../../domain/legal/termsOfUse'
import type { SmtpSettings } from '../mail/smtpEndpoint'
import type { RawConfig } from './schema'

/**
 * The shape of the configuration the rest of the application receives, and the only place its
 * fields are documented. `load.ts` fills it from the parsed schema.
 */

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
    /** The default parent of a backup archive. Read by the backup command only. */
    readonly backupDir: string
    /** See {@link RawConfig} field `MIN_FREE_DISK_BYTES`. */
    readonly minFreeDiskBytes: number
    /** What `closeDatabase` runs at shutdown. See {@link RawConfig} for the reasoning. */
    readonly sqliteShutdownCheckpoint: 'truncate' | 'passive' | 'none'
  }

  readonly uploads: {
    readonly maxBytes: number
    readonly maxFiles: number
    readonly maxPixels: number
    readonly defaultEventQuotaBytes: number
    /**
     * The box-wide ceiling from `MAX_EVENT_QUOTA_BYTES`. `null` is "no ceiling", which is
     * what every self-hosted box that never set the variable gets — see the schema.
     */
    readonly maxEventQuotaBytes: number | null
    /** See {@link RawConfig} field `MAX_CONCURRENT_UPLOAD_REQUESTS`. */
    readonly maxConcurrentRequests: number
    /** How many of those one event may hold; resolved from `MAX_CONCURRENT_UPLOAD_REQUESTS_PER_EVENT`. */
    readonly maxConcurrentRequestsPerEvent: number
    /** The deadline for a whole upload body to arrive, from `UPLOAD_BODY_TIMEOUT_SECONDS`. */
    readonly bodyTimeoutMs: number
  }

  /** The highlight reel (spec 08): `REEL_*` and `MAX_QUEUED_REELS`. */
  readonly reel: {
    readonly enabled: boolean
    readonly maxPhotos: number
    readonly secondsPerPhoto: number
    readonly maxOutputBytes: number
    readonly maxQueued: number
  }

  /** The photo book (PDF of the published album); every figure from a `BOOK_*` variable. */
  readonly books: {
    readonly enabled: boolean
    readonly maxPhotos: number
    readonly maxBytes: number
    readonly ttlDays: number
    readonly maxTotalBytes: number
    /** How long a book waits behind video transcodes, in milliseconds. */
    readonly maxWaitMs: number
    readonly maxPerEventPerDay: number
  }

  readonly clips: {
    readonly maxBytes: number
    readonly maxDurationMs: number
    readonly maxQueuedClips: number
    /** The same backpressure, scoped to one event. See `MAX_QUEUED_CLIPS_PER_EVENT`. */
    readonly maxQueuedClipsPerEvent: number
    readonly maxHeight: number
    readonly maxPixels: number
    readonly ffmpegPath: string | null
    readonly ffprobePath: string | null
    /** `PATH` and `PATHEXT` as values; see the schema for why they are carried at all. */
    readonly executableSearch: {
      readonly path: string
      readonly extensions: string
    }
    /**
     * The raw material for `minimalChildEnv` — `PATH` plus the four Windows-only
     * variables, as values. `src/main/container.ts` is where the whitelist itself gets
     * built; see the schema entries for why this module only carries the inputs.
     */
    readonly childEnvSource: {
      readonly path: string
      readonly pathExt: string
      readonly systemRoot: string
      readonly winDir: string
      readonly temp: string
      readonly tmp: string
    }
  }

  /**
   * The server-sent-events channel's own backpressure, separate from `rateLimits`
   * because what it bounds is held, not spent: a connection lives for hours rather
   * than milliseconds, so the right unit is "open at once", not "per minute".
   */
  readonly realtime: {
    /** `streamConnectionLimiter`'s per-client concurrency ceiling. */
    readonly maxStreamsPerClient: number
    /** `streamConnectionLimiter`'s process-wide concurrency ceiling. */
    readonly maxStreamsTotal: number
    /** `createInMemoryEventBus`'s per-event subscriber ceiling. */
    readonly maxSubscribersPerEvent: number
  }

  readonly retention: {
    /**
     * How often `src/main` sweeps events whose retention deadline has passed.
     * `null` means never: `npm run purge` is then the only thing that honours the
     * setting, which is the supported arrangement when a cron or systemd timer owns
     * the schedule.
     */
    readonly sweepIntervalMs: number | null
    /**
     * Days an event closed long ago is spared after its client's retention ceiling is
     * lowered (`RETENTION_CAP_NOTICE_DAYS`). Read by the purge, and by nothing on a box with
     * no clients.
     */
    readonly capNoticeDays: number
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
    /** `UPLOAD_RATE_LIMIT_PER_MINUTE`: photos and clips together, per **guest** and event. */
    readonly uploadPerMinute: number
    /** `UPLOAD_RATE_LIMIT_PER_IP_PER_MINUTE`: the flood ceiling per client address and event. */
    readonly uploadPerIpPerMinute: number
    readonly joinPerMinute: number
    readonly loginPerMinute: number
    /** `REACTION_RATE_LIMIT_PER_MINUTE`: per **guest** and event. */
    readonly reactionPerMinute: number
    /** `REACTION_RATE_LIMIT_PER_IP_PER_MINUTE`: the flood ceiling per client address and event. */
    readonly reactionPerIpPerMinute: number
    /** `GUEST_WRITE_RATE_LIMIT_PER_MINUTE`: caption, delete, withdraw a reaction, rename, acknowledge the notice. Per client and event. */
    readonly guestWritePerMinute: number
    readonly galleryPerMinute: number
    readonly galleryMediaPerMinute: number
    /** Failed password attempts per client, per fifteen minutes. */
    readonly galleryUnlockPerClient: number
    /** Failed password attempts per link, from every client together, per fifteen minutes. */
    readonly galleryUnlockPerLink: number
    /** `EVENT_CREATION_RATE_LIMIT_PER_HOUR` — per account, not per client. See `eventSlugSuffix` (`featureFields.ts`) and its siblings for the rest of P4-09. */
    readonly eventCreationPerHour: number
  }

  readonly crypto: {
    readonly bcryptCost: number
  }

  readonly bootstrap: {
    readonly ownerEmail: string | null
    readonly ownerPassword: string | null
  }

  readonly e2eHooks: boolean

  /**
   * `SITE_ADMIN=on`: this box is run for other people, and the operator's own namespace,
   * `/api/site`, is mounted (docs/ROADMAP.md §10.9). `false` on every install that never
   * said so, which is what keeps a solo box exactly as it was.
   *
   * It decides how much surface exists and nothing else. Authorization on that surface is
   * `requireOperator`'s, in both modes; migrations run in both modes.
   */
  readonly siteAdmin: boolean

  /**
   * `OPERATOR_RESET_LINKS` (G2-12 / P3-14, D-16). `mailOnly` unless the box opted into
   * `copyLinkWithOwnerApproval`, which the schema refuses without `SITE_ADMIN=on`.
   */
  readonly operatorResetLinks: OperatorResetLinks

  /**
   * The inputs of the AGPL section 13 source link (roadmap G1-04 / P1-05), both optional.
   * What the link finally is depends on the running version too, which this module does
   * not read, so `resolveSourceUrl` (`load.ts`) composes the three.
   */
  readonly source: {
    /** `SOURCE_CODE_URL`, canonical https, or `null` when the operator set none. */
    readonly url: string | null
    /** `SOURCE_REF`, a git tag, branch or commit, or `null` when the image has none baked in. */
    readonly ref: string | null
  }

  /**
   * The optional links of an instance that asks for support (roadmap G4-02), both
   * `null` unless the operator set them — so a self-hosted box says nothing about money.
   * Canonical https, validated like `SOURCE_CODE_URL`. A link that is set is shown to
   * hosts and on `/about`; there is deliberately no field here that could make it a
   * condition of anything, because a donation buys no counterpart.
   */
  readonly support: {
    /** `DONATION_URL`. See {@link donationUrl}. */
    readonly donationUrl: string | null
    /** `BUDGET_URL`. See {@link budgetUrl}. */
    readonly budgetUrl: string | null
  }

  /**
   * Who runs this box and the links they owe a visitor (roadmap G2-17 / P3-18), every field
   * `null` unless the operator set it — so a self-hosted box names nobody, links to nothing,
   * and its guests are shown exactly the notice they always were. Links are canonical https
   * addresses or paths on this site; see `optionalSiteLink` (`linkFields.ts`).
   */
  readonly operator: {
    /** `OPERATOR_NAME`. See `operatorName` (`linkFields.ts`). */
    readonly name: string | null
    /** `OPERATOR_CONTACT_EMAIL`. Never set without a `name`. */
    readonly contactEmail: string | null
    /** `LEGAL_TERMS_URL`. */
    readonly termsUrl: string | null
    /** `LEGAL_PRIVACY_URL`. */
    readonly privacyUrl: string | null
    /** `LEGAL_NOTICE_URL`. */
    readonly legalNoticeUrl: string | null
    /** `SUPPORT_URL`: help for a host. Not the donation link, which is {@link support}. */
    readonly supportUrl: string | null
    /** `REPORT_URL`: where a piece of content is reported (DSA art. 16). */
    readonly reportUrl: string | null
  }

  /**
   * The terms an invitation's acceptance asks the person to agree to (G2-20): `LEGAL_TERMS_URL`
   * **and** `LEGAL_TERMS_VERSION`, both or `null`. `null` is every box that set neither, and the
   * box that set only the address (the footer link of G2-17), and it asks nobody for anything.
   * The one place that decides "both": a use case and a presenter read this and never the pair.
   */
  readonly termsOfUse: TermsOfUse | null

  /**
   * P4-09 / D-14, grouped the way `createEvent` and `rotateJoinCode` consume them. A
   * self-hosted box that sets none of the three keeps 2.0's only behaviour exactly; the
   * hosted instance sets `slugSuffix: 'random'` and `allowCustomSlugs: false` from its
   * first beta boot, and may widen `joinCodeLength` independently of either.
   */
  readonly events: {
    /** `EVENT_SLUG_SUFFIX`. See `eventSlugSuffix` (`featureFields.ts`). */
    readonly slugSuffix: 'none' | 'random'
    /** `ALLOW_CUSTOM_SLUGS`. See {@link allowCustomSlugs}. */
    readonly allowCustomSlugs: boolean
    /** `JOIN_CODE_LENGTH`. See {@link joinCodeLength}. */
    readonly joinCodeLength: number
    /**
     * `EVENT_CREATION`. See `eventCreation` (`featureFields.ts`). `clientMembers` is possible only when
     * {@link AppConfig.siteAdmin} is true: the schema refuses the pair at boot.
     */
    readonly creation: 'anyAccount' | 'clientMembers'
  }

  /**
   * Outgoing mail (roadmap §10.3, G2-07 / P3-08). `smtp` is `null` on every box that never
   * set `SMTP_URL`, which is what makes the composition root wire `NullMailer` and what keeps
   * a solo install exactly as it was: no relay, no outbound connection, no mail.
   *
   * Carries the password, in `smtp.endpoint.credentials`, like `secrets` above carries the
   * signing keys. **Nothing logs this object, and nothing may**: the logger's redaction list
   * is shallow and would not catch a password four levels down, so the only protection is
   * that no caller hands this to a log line (the container's boot line names the host and the
   * port and nothing else, and a test pins it). A new field here is a new place a secret can
   * leak from, so none is added without a reason.
   */
  readonly mail: {
    readonly smtp: SmtpSettings | null
  }

  /**
   * Problems worth telling an operator about that are not worth refusing the boot
   * over — see `computeWarnings` (`load.ts`). The production-only ones are absent outside
   * production (a deprecated setting is warned about everywhere), and the list is usually
   * empty; `src/main/index.ts` logs each one once, after the container
   * exists. These start as warnings and stay warnings in a minor release: turning one
   * into a boot refusal is a breaking change for an existing self-hosted install, and
   * belongs in a major version with its own CHANGELOG entry, not a silent tightening.
   */
  readonly warnings: readonly string[]

  /**
   * The operator's second factor (roadmap §10.1, G2-13 / P3-15).
   *
   * Carries a key, like `secrets` above: **nothing logs this object, and nothing may**. The
   * key is the decoded bytes of `MFA_ENCRYPTION_KEY`, `null` on every box that never set it,
   * and `null` is what makes the second-factor routes answer `404 feature.unavailable` and
   * the composition root wire no vault at all.
   */
  readonly mfa: {
    readonly encryptionKey: Uint8Array | null
    /** `REQUIRE_OPERATOR_2FA`. True only with a key and `SITE_ADMIN=on`: the schema refuses the rest. */
    readonly requireOperatorSecondFactor: boolean
  }

  readonly audit: {
    /**
     * `AUDIT_RETENTION_DAYS`: how long a row of the audit log is kept, 365 at least. Read by
     * `pruneAuditLog` through the retention sweep; see `auditRetentionDays` (`featureFields.ts`).
     */
    readonly retentionDays: number
    /** `AUDIT_RETENTION_DAYS` was left unset (or blank): the default applies. For the boot warning. */
    readonly retentionFromDefault: boolean
  }

  /**
   * The ceilings a client is created with (G2-18), from the `NEW_CLIENT_*` variables and shaped
   * as the `ClientCeilingsInput` that `createClient` takes, so the composition root hands it
   * over unchanged. `null` is "no ceiling" and `true` is "clips allowed", which is what every
   * client of a box that set none of them has: the schema refuses a variable of this family
   * with `SITE_ADMIN=off`, so a solo box can only ever carry the unlimited value.
   */
  readonly newClientCeilings: {
    readonly maxEvents: number | null
    readonly maxEventsPerPeriod: number | null
    readonly maxTotalBytes: number | null
    readonly maxEventQuotaBytes: number | null
    readonly maxRetentionDays: number | null
    readonly maxLiveDays: number | null
    readonly clipsAllowed: boolean
  }
}
