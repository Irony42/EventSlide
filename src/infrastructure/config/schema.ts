import { z } from 'zod'
import {
  MAX_LIVE_DAYS as CLIENT_MAX_LIVE_DAYS,
  MAX_RETENTION_DAYS as CLIENT_MAX_RETENTION_DAYS,
  MIN_LIVE_DAYS as CLIENT_MIN_LIVE_DAYS,
  MIN_RETENTION_DAYS as CLIENT_MIN_RETENTION_DAYS,
} from '../../domain/clients/clientCeilings'
import { DEFAULT_OPERATOR_RESET_LINKS } from '../../domain/clients/operatorGuard'
import {
  blankAsAbsent,
  boolish,
  boolishWithDefault,
  choice,
  positiveInt,
  retentionSweepInterval,
  scheduleSweepInterval,
  secret,
} from './schemaPrimitives'
import {
  budgetUrl,
  donationUrl,
  isPlainHttpBeyondLocalhost,
  legalNoticeUrl,
  legalPrivacyUrl,
  legalTermsUrl,
  legalTermsVersion,
  operatorContactEmail,
  operatorName,
  publicUrl,
  reportUrl,
  sourceCodeUrl,
  sourceRef,
  supportUrl,
} from './linkFields'
import {
  allowCustomSlugs,
  auditRetentionDays,
  bootstrapOwnerPassword,
  eventCreation,
  eventSlugSuffix,
  joinCodeLength,
  mailFrom,
  mfaEncryptionKey,
  newClientCeiling,
  newClientClipsAllowed,
  operatorResetLinks,
  requireOperator2fa,
  siteAdmin,
  smtpUrl,
} from './featureFields'

/**
 * The schema: one list of every variable the server reads, built twice (a server's, and a
 * maintenance command's) and refined across fields.
 */

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
       * `sweepInterval` (`schemaPrimitives.ts`): a compose file with a dangling `NODE_ENV=`, or a template
       * that rendered empty, must not be the one input that relaxes the posture. It lands
       * on the strict default like any other absence.
       */
      NODE_ENV: z.preprocess(
        blankAsAbsent,
        choice(['development', 'test', 'production']).default('production'),
      ),
      PORT: positiveInt(4300, 65535),
      PUBLIC_URL: publicUrl.default('http://localhost:5173'),
      LOG_LEVEL: choice(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

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
      /**
       * Where `backup` writes an archive when it is not given `--to`. Nothing the server
       * does reads it.
       *
       * A variable rather than a constant because the constant was wrong on the install
       * the README leads with: `./backups` resolves against the working directory, which
       * in the image is `/app` — owned by root, on a filesystem `compose.yaml` mounts
       * read-only — so the bare command could not write anywhere. The image sets
       * `/data/backups` instead, which is on the data volume and therefore on **the same
       * disk as what it protects** — a place to write an archive, not a place to keep
       * one. The README's Backups section gives the copy that takes it off the box.
       */
      BACKUP_DIR: z.string().min(1).default('./backups'),

      /**
       * The floor `statfs` must find on the directory holding `DATABASE_PATH` and on
       * `MEDIA_ROOT` before another upload is admitted (G3-06 / P4-10). Below it:
       * **413** `storage.boxFull`.
       *
       * **Without a separate `SCRATCH_ROOT` (P4-04)**, `MEDIA_ROOT` is where a clip
       * also stages while it uploads, so checking it already covers that scratch
       * directory too — there is no third path to add once P4-04 lands, only a
       * narrower reason the second one matters.
       *
       * The default is a floor for a single small box, not a sizing recommendation —
       * an operator with real traffic sets this from a load test, the way
       * `docs/capacity.md` is meant to.
       */
      MIN_FREE_DISK_BYTES: positiveInt(1_000_000_000),

      MAX_UPLOAD_BYTES: positiveInt(25_000_000),
      MAX_FILES_PER_UPLOAD: positiveInt(20, 100),
      /** Checked against the header before decoding — the decompression-bomb control. */
      MAX_IMAGE_PIXELS: positiveInt(50_000_000),
      DEFAULT_EVENT_QUOTA_BYTES: positiveInt(5_000_000_000),
      /**
       * The box-wide ceiling on a single event's `quotaBytes` (roadmap §10.5 / G3-02).
       *
       * **Absent, not a fallback number.** Every other numeric setting in this file has a
       * default because silence has to mean *something*, and for this one the something a
       * self-hosted box has always had is no ceiling at all beyond the domain's own "a
       * positive integer" — so absence is `undefined` here, not a number, and `undefined`
       * is what makes `createEvent` skip the comparison entirely rather than compare
       * against a number nobody chose. An instance run for other people sets this
       * explicitly; a solo box that never heard of it sees no change.
       *
       * Blank is absent for the reason written on `sweepInterval` (`schemaPrimitives.ts`): a compose file
       * with a dangling `MAX_EVENT_QUOTA_BYTES=` must not be read as a ceiling of zero,
       * which would refuse every event a host tries to create.
       */
      MAX_EVENT_QUOTA_BYTES: z.preprocess(
        blankAsAbsent,
        z.coerce.number().int().positive().optional(),
      ),

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
      /**
       * The same backpressure, scoped to **one** event, and checked inside the same
       * `stage` transaction as the box-wide count above.
       *
       * `MAX_QUEUED_CLIPS` alone has a known cost, written on `src/domain/clips/clipQueue.ts`:
       * one event can fill every slot and make another event's guests wait behind its
       * backlog, which is the one trade that is wrong for a box running more than one
       * event at a time (roadmap R-10, "noisy neighbours"). This does not replace the
       * box-wide cap — a single event still cannot out-queue what one worker can chew
       * through — it adds a second, per-event ceiling so a wedding running over
       * capacity cannot also starve a gala on the same machine.
       *
       * Defaulted to the same number as `MAX_QUEUED_CLIPS`: on a box that only ever
       * runs one event at a time — the deployment this product ships for — the two
       * caps are reached together and nothing observable changes. Lowering this one is
       * what a multi-event cell asks for.
       */
      MAX_QUEUED_CLIPS_PER_EVENT: positiveInt(20, 500),
      /**
       * The host's highlight reel, an MP4 montage of their favourites (spec 08). Off, no montage can
       * be asked for; the favourites and their ZIP stay. The operator's switch if the box suffers:
       * an environment variable, so changing it is a restart, not a button.
       */
      REEL_ENABLED: boolishWithDefault('true'),
      /** The most photographs one montage may hold. Past it the host is told to remove some. */
      REEL_MAX_PHOTOS: positiveInt(60, 120),
      /** How long each photograph is shown, in seconds. */
      REEL_SECONDS_PER_PHOTO: z.coerce.number().int().min(2).max(8).default(4),
      /** The largest file a montage may become. Admission leaves this much room, in the quota. */
      REEL_MAX_OUTPUT_BYTES: positiveInt(150_000_000),
      /**
       * Montages that may be waiting or rendering across the box. One per event is guaranteed by the
       * schema; this is the box-wide cap, judged in the admission transaction like the clips'.
       */
      MAX_QUEUED_REELS: positiveInt(2, 50),
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
       * How many upload requests — photos and clips together — may be in flight at
       * once, process-wide (G3-06 / P4-10). Past it: `429 upload.busy` with
       * `Retry-After`. A slot is held from admission to response, which spans both the
       * buffering (`guestRoutes.ts`'s 150 MB per-request ceiling) and the `sharp` decode
       * after it (~200 MB) — so four in flight at the default is ~1.4 GB, not 600 MB of
       * buffers alone, and that full figure is what an operator's memory limit actually
       * has to cover. See `compose.yaml`'s own budget comment for the rest of it.
       */
      MAX_CONCURRENT_UPLOAD_REQUESTS: positiveInt(4, 1_000),
      /**
       * How many of those slots one event may hold at once (review S2). The global figure
       * bounds memory; this one bounds how much of it a single event can take from the
       * others, so one event's slow phones, or one guest dripping a body, cannot answer
       * `429 upload.busy` to every other event on the box.
       *
       * Absent is "one less than the global ceiling", resolved in `load.ts`: a box with one
       * event (the self-hosted case) keeps almost all of its throughput, and no event can
       * ever hold the last slot. An operator running many clients sets it lower. Blank is
       * absent, for the reason written on `MAX_EVENT_QUOTA_BYTES`. Above the global ceiling
       * is refused below: it could never be reached.
       */
      MAX_CONCURRENT_UPLOAD_REQUESTS_PER_EVENT: z.preprocess(
        blankAsAbsent,
        z.coerce.number().int().positive().max(1_000).optional(),
      ),
      /**
       * How long a photo or clip upload may take to arrive in full, in seconds (review S2).
       * `requestTimeout` is `0` (the streams and the ZIP export need it), so without this a
       * body sent a byte at a time held an upload slot for as long as the socket stayed open.
       * Ten minutes is a 5 MB photo at about 70 kbit/s, or an 80 MB clip at about 1.1 Mbit/s;
       * a phone slower than that is better served by a retry than by a slot held all evening.
       */
      UPLOAD_BODY_TIMEOUT_SECONDS: positiveInt(600, 86_400),

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
       * The Windows-only quarter of the whitelist a spawned ffmpeg or ffprobe child is
       * given (menace T9, `docs/SECURITY.md` §4.1) — read here for the same reason as
       * `PATH` and `PATHEXT` just above: the environment is read only in `env.ts`,
       * so the policy of which names survive into the child's own
       * environment is decided in `minimalChildEnv` (`infrastructure/media/runProcess.ts`)
       * from values carried as plain configuration, never read there directly. Blank by
       * default off Windows, where `minimalChildEnv` ignores all four regardless.
       */
      SYSTEMROOT: z.string().default(''),
      WINDIR: z.string().default(''),
      TEMP: z.string().default(''),
      TMP: z.string().default(''),

      /**
       * Left optional so the default can depend on NODE_ENV, below: a background sweep
       * firing inside the end-to-end suite would delete a fixture's event mid-journey.
       */
      RETENTION_SWEEP_INTERVAL_MINUTES: retentionSweepInterval.optional(),

      /**
       * The warning a client is owed when an operator lowers its retention ceiling, in days
       * (roadmap §10.5 / P3-06; `RETENTION_CAP_NOTICE_DAYS` in the paid plan).
       *
       * Lowering `max_retention_days` stamps `clients.retention_cap_since`, and the purge of
       * an event under that ceiling may not happen before `retention_cap_since` plus this
       * many days — whatever the new ceiling says. Without it, an operator who tightens a
       * client from 90 days to 14 deletes the albums closed 60 days ago the same night, with
       * no window to export them in. Thirty days by default, a month being what a host
       * reasonably needs to notice an e-mail and download a ZIP. Capped at a year, past which
       * a "notice" is a different promise.
       *
       * Inert on a box with no clients: only an event that belongs to one has a ceiling.
       */
      RETENTION_CAP_NOTICE_DAYS: positiveInt(30, 365),

      /**
       * Optional for the same reason as the line above: under `NODE_ENV=test` the default
       * has to be off. A sweep firing mid-journey would open — or close — the event a
       * Playwright spec is asserting on, on a timer nothing in the test can see.
       */
      SCHEDULE_SWEEP_INTERVAL_MINUTES: scheduleSweepInterval.optional(),

      /**
       * **Deprecated, and read by nothing.** The grace a guest has to take a photo back is a
       * setting of each event (`EventSettings.guestSelfDeleteGraceSeconds`, chosen by its host), and
       * this key never reached it: it was validated, mapped into the config and left there. It is
       * still validated, so a box that sets it boots as it did, and `computeWarnings` says it does
       * nothing; it is removed in 4.0.0 (CHANGELOG, `### Deprecated`).
       */
      GUEST_SELF_DELETE_GRACE_SECONDS: positiveInt(900, 86_400),
      /**
       * Uploads (photos and clips together) per **guest** and event, since 3.2. Through 3.1 this
       * was per client address and event, which gave a whole venue behind one access point twelve
       * sends a minute. The address is now bounded by the much larger
       * `UPLOAD_RATE_LIMIT_PER_IP_PER_MINUTE` below.
       */
      UPLOAD_RATE_LIMIT_PER_MINUTE: positiveInt(12, 600),
      /**
       * The flood ceiling on uploads per client address **and** event, ahead of any token check.
       * Absent, 300 or `UPLOAD_RATE_LIMIT_PER_MINUTE` if that is larger (`load.ts`), so a box that
       * raised the old per-address figure to survive a wedding is never tightened by an upgrade.
       */
      UPLOAD_RATE_LIMIT_PER_IP_PER_MINUTE: z.preprocess(
        blankAsAbsent,
        z.coerce.number().int().positive().max(6000).optional(),
      ),
      /**
       * Join lookups and joins, one bucket per client address. 200 a minute: a venue behind one
       * address sends two requests per guest (`GET /join/:code`, `POST /join`) and 150 guests
       * arrive within minutes. Guessing a six-character code at this rate takes about ten years to
       * sweep the whole space (32^6 = 1.07e9 codes), see `JoinCode`.
       */
      JOIN_RATE_LIMIT_PER_MINUTE: positiveInt(200, 600),
      LOGIN_RATE_LIMIT_PER_MINUTE: positiveInt(10, 600),
      /** Reactions per **guest** and event, since 3.2 (per client address and event before). */
      REACTION_RATE_LIMIT_PER_MINUTE: positiveInt(30, 600),
      /**
       * The flood ceiling on reactions per client address and event. Absent, 600 or
       * `REACTION_RATE_LIMIT_PER_MINUTE` if that is larger, for the reason given on
       * `UPLOAD_RATE_LIMIT_PER_IP_PER_MINUTE`.
       */
      REACTION_RATE_LIMIT_PER_IP_PER_MINUTE: z.preprocess(
        blankAsAbsent,
        z.coerce.number().int().positive().max(6000).optional(),
      ),
      /**
       * Every other write a guest token can make: a caption, taking a photo back, withdrawing a
       * reaction, acknowledging the privacy notice, renaming oneself (HTTP-H-01). Per client address **and** event, one
       * bucket for all five, built once in `server.ts`.
       *
       * A backstop sized for a room, not a tuned figure. A whole venue shares one access point,
       * and what it legitimately sends is bounded by the budgets above: twelve uploads and twenty
       * joins a minute at one address, so a few dozen captions, take-backs and acknowledgements.
       * 300 is five a second, well clear of that and low enough to stop a loop. Lower it on a box
       * whose events are small.
       */
      GUEST_WRITE_RATE_LIMIT_PER_MINUTE: positiveInt(300, 6000),
      /**
       * Per **account** and per **hour**, not per minute (P4-09 / D-14):
       * `eventCreationLimiter` keys on who is signed in rather than on an address, so an
       * office or a venue's guest Wi-Fi shared by several hosts is not throttled as if
       * it were one determined attacker. The ceiling is generous headroom above the
       * default of twenty — high enough that a test environment creating many events in
       * a loop is never the one tripping it.
       */
      EVENT_CREATION_RATE_LIMIT_PER_HOUR: positiveInt(20, 1_000),
      /**
       * The shared gallery (roadmap §4.1), the one surface a stranger reaches with only a
       * URL. Pages and bytes are separate budgets because a grid of sixty thumbnails is
       * sixty requests the moment it renders; password attempts are per quarter hour and
       * count failures only, per client and per link.
       *
       * The byte budget is sized for an address, not a person. A family on one box at
       * home, or a table of colleagues on an office's Wi-Fi, is one IP: ten people each
       * scrolling five pages of sixty thumbnails is 3 000 requests before anybody opens a
       * photograph, and a budget of 600 throttled the fourth of them. The page budget
       * carries each device's password unlock as well as its pages, for the same reason.
       */
      GALLERY_RATE_LIMIT_PER_MINUTE: positiveInt(120, 1_200),
      GALLERY_MEDIA_RATE_LIMIT_PER_MINUTE: positiveInt(3_000, 30_000),
      GALLERY_UNLOCK_ATTEMPTS_PER_CLIENT: positiveInt(10, 600),
      GALLERY_UNLOCK_ATTEMPTS_PER_LINK: positiveInt(50, 6_000),

      /**
       * How many event streams one client key may hold **open at the same time**, and
       * how many the process serves at once across every client and event.
       *
       * Concurrency, not a rate — see `streamConnectionLimiter`, which carried these as
       * constants until now. The defaults are unchanged (12, 500): a single-event box
       * never reaches either, and what becomes configurable is the backstop a busier,
       * multi-event cell needs to raise or lower.
       */
      MAX_STREAMS_PER_CLIENT: positiveInt(12, 10_000),
      MAX_STREAMS_TOTAL: positiveInt(500, 100_000),
      /**
       * The event bus's own cap, independent of the two above: how many SSE
       * subscriptions `createInMemoryEventBus` holds for a single event before it
       * refuses a fresh one with `503`. Guards the same box against the same shape of
       * leak or abuse, one level down from the HTTP connection limiter.
       */
      MAX_SUBSCRIBERS_PER_EVENT: positiveInt(200, 10_000),

      /**
       * What `closeDatabase` runs at shutdown: `truncate` (the default, unchanged),
       * `passive`, or `none`.
       *
       * Carried for Litestream, which replicates the WAL and is sensitive to how a
       * clean shutdown leaves it — `passive` checkpoints without ever blocking on a
       * reader, where `truncate` can be partial when one is attached. **Unused on a
       * self-hosted instance**, which has no Litestream adapter: `truncate` keeps
       * closing exactly as it always has, and this variable exists so the paid plan's
       * cell can override it without a second code path.
       *
       * Blank is absent, for the reason written on {@link siteAdmin}: a dangling
       * `SQLITE_SHUTDOWN_CHECKPOINT=` lands on the unconditional behaviour every boot
       * before this had, not on a guess at which mode was meant.
       */
      SQLITE_SHUTDOWN_CHECKPOINT: z.preprocess(
        blankAsAbsent,
        choice(['truncate', 'passive', 'none']).default('truncate'),
      ),

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

      /** See {@link siteAdmin}. `off` unless the box says otherwise. */
      SITE_ADMIN: siteAdmin,

      /** See {@link sourceCodeUrl}. Absent means the tag of the running version upstream. */
      SOURCE_CODE_URL: sourceCodeUrl,
      /** See {@link sourceRef}. Set by the Dockerfile's build argument, never by hand. */
      SOURCE_REF: sourceRef,

      /** See {@link eventCreation}. `anyAccount` unless the box says otherwise. */
      EVENT_CREATION: eventCreation,

      /** See {@link operatorResetLinks}. `mailOnly` unless the box says otherwise. */
      OPERATOR_RESET_LINKS: operatorResetLinks,

      /** See {@link donationUrl}. Absent means no donation link anywhere. */
      DONATION_URL: donationUrl,
      /** See {@link budgetUrl}. Absent means no public-budget link anywhere. */
      BUDGET_URL: budgetUrl,

      /** See {@link operatorName}. Absent means the box names no operator. */
      OPERATOR_NAME: operatorName,
      /** See {@link operatorContactEmail}. Needs OPERATOR_NAME beside it. */
      OPERATOR_CONTACT_EMAIL: operatorContactEmail,
      /** See {@link legalTermsUrl}. Absent means no terms link anywhere. */
      LEGAL_TERMS_URL: legalTermsUrl,
      /** See {@link legalTermsVersion}. With `LEGAL_TERMS_URL`, an invitation asks for the terms. */
      LEGAL_TERMS_VERSION: legalTermsVersion,
      /** See {@link legalPrivacyUrl}. Absent means no privacy-policy link anywhere. */
      LEGAL_PRIVACY_URL: legalPrivacyUrl,
      /** See {@link legalNoticeUrl}. Absent means no legal-notice link anywhere. */
      LEGAL_NOTICE_URL: legalNoticeUrl,
      /** See {@link supportUrl}. Absent means no help link anywhere. */
      SUPPORT_URL: supportUrl,
      /** See {@link reportUrl}. Absent means no "report content" link anywhere. */
      REPORT_URL: reportUrl,

      /** See {@link eventSlugSuffix}. `none` unless the box says otherwise. */
      EVENT_SLUG_SUFFIX: eventSlugSuffix,
      /** See {@link allowCustomSlugs}. `true` unless the box says otherwise. */
      ALLOW_CUSTOM_SLUGS: allowCustomSlugs,
      /** See {@link joinCodeLength}. Six unless the box says otherwise. */
      JOIN_CODE_LENGTH: joinCodeLength,

      /** See {@link auditRetentionDays}. Three years unless the box says otherwise. */
      AUDIT_RETENTION_DAYS: auditRetentionDays,

      /**
       * The ceilings a client is created with (G2-18), one variable per ceiling. All
       * optional, and all refused with `SITE_ADMIN=off`: see the refinement below, and
       * {@link newClientCeiling} for what absent and blank mean.
       */
      NEW_CLIENT_MAX_EVENTS: newClientCeiling('NEW_CLIENT_MAX_EVENTS'),
      NEW_CLIENT_MAX_EVENTS_PER_PERIOD: newClientCeiling('NEW_CLIENT_MAX_EVENTS_PER_PERIOD'),
      NEW_CLIENT_MAX_TOTAL_BYTES: newClientCeiling('NEW_CLIENT_MAX_TOTAL_BYTES'),
      NEW_CLIENT_MAX_EVENT_QUOTA_BYTES: newClientCeiling('NEW_CLIENT_MAX_EVENT_QUOTA_BYTES'),
      NEW_CLIENT_MAX_RETENTION_DAYS: newClientCeiling(
        'NEW_CLIENT_MAX_RETENTION_DAYS',
        CLIENT_MIN_RETENTION_DAYS,
        CLIENT_MAX_RETENTION_DAYS,
      ),
      NEW_CLIENT_MAX_LIVE_DAYS: newClientCeiling(
        'NEW_CLIENT_MAX_LIVE_DAYS',
        CLIENT_MIN_LIVE_DAYS,
        CLIENT_MAX_LIVE_DAYS,
      ),
      NEW_CLIENT_CLIPS_ALLOWED: newClientClipsAllowed,

      /** See {@link smtpUrl}. Absent means no mail: the composition root wires `NullMailer`. */
      SMTP_URL: smtpUrl,
      /** See {@link mailFrom}. Required whenever `SMTP_URL` is set. */
      MAIL_FROM: mailFrom,

      /**
       * See {@link mfaEncryptionKey}. Absent means no operator can enrol a second factor on
       * this box: the routes answer `404 feature.unavailable`, exactly as the reset routes
       * do on a box with no relay.
       */
      MFA_ENCRYPTION_KEY: mfaEncryptionKey,
      /**
       * Whether an operator must have passed a second factor in this session before
       * `/api/site/*` answers (G2-13 / P3-15). `false` unless the box says otherwise, so a
       * solo install keeps its sign-in exactly as it was; the hosted instance sets `true`.
       * Needs a key to decrypt the factor with and an operator namespace to guard — see the
       * refinements below.
       */
      REQUIRE_OPERATOR_2FA: requireOperator2fa,
    })
    .superRefine((raw, ctx) => {
      if (
        raw.MAX_CONCURRENT_UPLOAD_REQUESTS_PER_EVENT !== undefined &&
        raw.MAX_CONCURRENT_UPLOAD_REQUESTS_PER_EVENT > raw.MAX_CONCURRENT_UPLOAD_REQUESTS
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['MAX_CONCURRENT_UPLOAD_REQUESTS_PER_EVENT'],
          message: `MAX_CONCURRENT_UPLOAD_REQUESTS_PER_EVENT (${raw.MAX_CONCURRENT_UPLOAD_REQUESTS_PER_EVENT}) must not exceed MAX_CONCURRENT_UPLOAD_REQUESTS (${raw.MAX_CONCURRENT_UPLOAD_REQUESTS}): the box-wide ceiling binds first, so the per-event one could never be reached`,
        })
      }

      // The first owner is a pair, and half of one creates nothing. Before `""` meant
      // absent, the missing half reached `bootstrapOwner` as an empty string and was
      // refused into a log line; silently doing nothing instead would be no better, so
      // the half that is missing is named at boot beside every other bad variable.
      const email = raw.BOOTSTRAP_OWNER_EMAIL
      const password = raw.BOOTSTRAP_OWNER_PASSWORD
      if ((email === undefined) !== (password === undefined)) {
        const missing = email === undefined ? 'BOOTSTRAP_OWNER_EMAIL' : 'BOOTSTRAP_OWNER_PASSWORD'
        ctx.addIssue({
          code: 'custom',
          path: [missing],
          message: `${missing} is required alongside the other half of the first-owner bootstrap: an email with no password, or a password with no email, creates no account at all`,
        })
      }

      // Not production-gated either: a relay with no sender is wrong everywhere. A relay
      // refuses a message with no `MAIL FROM`, so without this the box boots, the operator
      // believes mail works, and the first invitation fails with `mail.rejected` on the one
      // day somebody needed it. The reverse — a sender and no relay — is only a warning, below.
      if (raw.SMTP_URL !== undefined && raw.MAIL_FROM === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['MAIL_FROM'],
          message:
            'MAIL_FROM is required when SMTP_URL is set: a relay will not accept a message with no sender, so every invitation would be refused',
        })
      }

      // Not production-gated: a ceiling under the default is wrong in every environment,
      // because every event created with no opinion asks for `DEFAULT_EVENT_QUOTA_BYTES`
      // (`createEvent.ts`) and would already violate a lower one. Refusing here is what
      // keeps "the box boots" and "the default event it was about to create is legal"
      // the same claim, rather than one a host discovers by having their first event
      // refused.
      if (
        raw.MAX_EVENT_QUOTA_BYTES !== undefined &&
        raw.MAX_EVENT_QUOTA_BYTES < raw.DEFAULT_EVENT_QUOTA_BYTES
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['MAX_EVENT_QUOTA_BYTES'],
          message: `MAX_EVENT_QUOTA_BYTES (${raw.MAX_EVENT_QUOTA_BYTES}) must be at least DEFAULT_EVENT_QUOTA_BYTES (${raw.DEFAULT_EVENT_QUOTA_BYTES}), or every event created with no opinion would already be above the ceiling`,
        })
      }

      // G2-18, and §10.9 once more: the ceilings a new client starts with mean something only
      // on a box that creates clients, and nobody can on a box with `SITE_ADMIN=off`. Refused
      // **variable by variable**, so the operator is told every one to remove at once, and
      // found by the `NEW_CLIENT_` prefix of the parsed keys rather than from a list: a key
      // added to the schema and forgotten in a list would be silently accepted with the mode
      // off, which is precisely the configuration this refusal exists to stop.
      if (raw.SITE_ADMIN !== 'on') {
        for (const [name, value] of Object.entries(raw)) {
          if (name.startsWith('NEW_CLIENT_') && value !== undefined) {
            ctx.addIssue({
              code: 'custom',
              path: [name],
              message: `${name} requires SITE_ADMIN=on: the ceilings a new client starts with only mean something on a box that creates clients, and with SITE_ADMIN=off there is no way to create one (docs/ROADMAP.md §10.9)`,
            })
          }
        }
      }

      // A default above the box-wide ceiling would promise every new client a quota that
      // `createEvent` refuses (`event.quotaAboveCeiling`, G3-02): the client's own number is
      // not what bounds it, `MAX_EVENT_QUOTA_BYTES` is, and the page that shows the operator
      // the default would show one nobody can reach. Not production-gated, for the reason the
      // ceiling check above is not.
      if (
        raw.NEW_CLIENT_MAX_EVENT_QUOTA_BYTES !== undefined &&
        raw.MAX_EVENT_QUOTA_BYTES !== undefined &&
        raw.NEW_CLIENT_MAX_EVENT_QUOTA_BYTES > raw.MAX_EVENT_QUOTA_BYTES
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['NEW_CLIENT_MAX_EVENT_QUOTA_BYTES'],
          message: `NEW_CLIENT_MAX_EVENT_QUOTA_BYTES (${raw.NEW_CLIENT_MAX_EVENT_QUOTA_BYTES}) must not exceed MAX_EVENT_QUOTA_BYTES (${raw.MAX_EVENT_QUOTA_BYTES}): the box-wide ceiling binds every event whatever a client's own says, so the default would promise a quota that is refused`,
        })
      }

      // Roadmap §10.9, "configuration that only means something with an operator is refused
      // when the mode is off". Restricting creation to client members is a policy that only
      // an operator can satisfy — nobody can create a client, or add a member to one, on a box
      // with no operator surface — so on such a box it would lock every account but the
      // operator's out of creating anything, and the operator who set it would believe it was
      // a feature. Not production-gated, for the reason the ceiling check above is not.
      if (raw.EVENT_CREATION === 'clientMembers' && raw.SITE_ADMIN !== 'on') {
        ctx.addIssue({
          code: 'custom',
          path: ['EVENT_CREATION'],
          message:
            'EVENT_CREATION=clientMembers requires SITE_ADMIN=on: restricting event creation to client members only means something on a box that has an operator and clients, and with SITE_ADMIN=off there is no way to create either (docs/ROADMAP.md §10.9)',
        })
      }

      // The opt-in that hands an operator a link is a setting that only means something with an
      // operator, and one that weakens an invariant: refused where there is no operator surface,
      // so nobody believes a box is configured one way while it is configured the other.
      // Not production-gated, for the reason the ceiling check above is not.
      if (raw.OPERATOR_RESET_LINKS !== DEFAULT_OPERATOR_RESET_LINKS && raw.SITE_ADMIN !== 'on') {
        ctx.addIssue({
          code: 'custom',
          path: ['OPERATOR_RESET_LINKS'],
          message: `OPERATOR_RESET_LINKS=${raw.OPERATOR_RESET_LINKS} requires SITE_ADMIN=on: it decides what an operator may be shown, and a box with SITE_ADMIN=off has no operator surface (docs/ROADMAP.md §10.9)`,
        })
      }

      // An address with no name behind it is not an identity, and `/api/about`'s `operator`
      // has no shape for one: accepting it would publish nothing and look configured.
      if (raw.OPERATOR_CONTACT_EMAIL !== undefined && raw.OPERATOR_NAME === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['OPERATOR_CONTACT_EMAIL'],
          message:
            'OPERATOR_CONTACT_EMAIL requires OPERATOR_NAME: a contact address is published beside the name of the operator it belongs to, and with no name it would be published nowhere',
        })
      }

      // G2-20: a version of terms nobody can read is a promise, not a rule. The acceptance is
      // switched on by the pair, so a version with no address to read the terms at would leave an
      // operator believing every invitation asks for their terms while none does. The other half
      // of the pair, an address with no version, is the footer link G2-17 made and stays valid.
      if (raw.LEGAL_TERMS_VERSION !== undefined && raw.LEGAL_TERMS_URL === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['LEGAL_TERMS_VERSION'],
          message:
            'LEGAL_TERMS_VERSION requires LEGAL_TERMS_URL: accepting an invitation asks for the terms only when there is a page to read them at, and with a version alone it would ask for nothing and look configured',
        })
      }

      // Fail closed: a box that says its operators need a second factor and cannot decrypt
      // one would either lock every operator out or, worse, be assumed to be guarded when
      // nothing guards it. Not production-gated, for the reason the ceiling check above is not.
      if (raw.REQUIRE_OPERATOR_2FA && raw.MFA_ENCRYPTION_KEY === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['MFA_ENCRYPTION_KEY'],
          message:
            'MFA_ENCRYPTION_KEY is required when REQUIRE_OPERATOR_2FA is true: without a key no operator can enrol a factor, and every operator would be refused by the gate forever',
        })
      }

      // Roadmap §10.9 again: a requirement that only means something with an operator is
      // refused where there is none, so nobody believes a box is guarded by a gate that is
      // not mounted.
      if (raw.REQUIRE_OPERATOR_2FA && raw.SITE_ADMIN !== 'on') {
        ctx.addIssue({
          code: 'custom',
          path: ['REQUIRE_OPERATOR_2FA'],
          message:
            'REQUIRE_OPERATOR_2FA=true requires SITE_ADMIN=on: the requirement guards the operator namespace /api/site, which a box with SITE_ADMIN=off does not mount (docs/ROADMAP.md §10.9)',
        })
      }

      // The point of a dedicated key (C-10): a key that is also a signing secret is one the
      // next rotation of that secret would change, and one a leak of that secret would expose.
      //
      // `text` is read through a variable because zod runs this refinement even when the field
      // itself was refused, handing it the string as typed: there is no `.text` on that, and
      // comparing two absent values would report a clash nobody typed.
      const keyText: string | undefined = raw.MFA_ENCRYPTION_KEY?.text
      for (const other of ['SESSION_SECRET', 'GUEST_TOKEN_SECRET'] as const) {
        if (keyText !== undefined && keyText === raw[other]) {
          ctx.addIssue({
            code: 'custom',
            path: ['MFA_ENCRYPTION_KEY'],
            message: `MFA_ENCRYPTION_KEY must not be the same value as ${other}: rotating or leaking one would change or expose the other`,
          })
        }
      }

      if (raw.NODE_ENV !== 'production') return

      if (secretsRequiredInProduction) {
        for (const name of ['SESSION_SECRET', 'GUEST_TOKEN_SECRET'] as const) {
          if (raw[name] === undefined) {
            ctx.addIssue({
              code: 'custom',
              path: [name],
              message: `${name} is required in production`,
            })
          }
        }
      }
      if (raw.E2E_HOOKS === true) {
        ctx.addIssue({
          code: 'custom',
          path: ['E2E_HOOKS'],
          message: 'E2E_HOOKS must not be enabled in production',
        })
      }
      if (isPlainHttpBeyondLocalhost(raw.PUBLIC_URL)) {
        ctx.addIssue({
          code: 'custom',
          path: ['PUBLIC_URL'],
          message:
            'PUBLIC_URL must use https in production: guests submit photos over this origin, and a Secure session cookie will not be sent over http',
        })
      }
    })

/** What a server parses with: both secrets are a precondition in production. */
export const serverSchema = buildSchema({ secretsRequiredInProduction: true })

/** What a maintenance command parses with. See {@link buildSchema}. */
export const maintenanceSchema = buildSchema({ secretsRequiredInProduction: false })

export type RawConfig = z.infer<typeof serverSchema>
