import { dirname, resolve } from 'node:path'
import { access, constants, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import type { Express } from 'express'
import { resolveSourceUrl, type AppConfig } from '../infrastructure/config/env'
import { closeDatabase, openDatabase, type Db } from '../infrastructure/db/connection'
import { migrate } from '../infrastructure/db/migrator'
import { migrations } from '../infrastructure/db/migrations'
import { SqliteSessionStore } from '../infrastructure/db/sqliteSessionStore'
import { SqliteEventRepository } from '../infrastructure/db/sqliteEventRepository'
import { SqlitePhotoRepository } from '../infrastructure/db/sqlitePhotoRepository'
import { SqliteGuestRepository } from '../infrastructure/db/sqliteGuestRepository'
import { SqliteReactionRepository } from '../infrastructure/db/sqliteReactionRepository'
import { SqliteUserRepository } from '../infrastructure/db/sqliteUserRepository'
import { SqliteMembershipRepository } from '../infrastructure/db/sqliteMembershipRepository'
import { SqliteClipJobRepository } from '../infrastructure/db/sqliteClipJobRepository'
import { SqliteMissionRepository } from '../infrastructure/db/sqliteMissionRepository'
import { SqliteShareLinkRepository } from '../infrastructure/db/sqliteShareLinkRepository'
import { SqliteClientRepository } from '../infrastructure/db/sqliteClientRepository'
import { SqliteAccountTokenRepository } from '../infrastructure/db/sqliteAccountTokenRepository'
import { SqliteSecondFactorRepository } from '../infrastructure/db/sqliteSecondFactorRepository'
import { createAesGcmMfaVault } from '../infrastructure/crypto/aesGcmMfaVault'
import { nodeTotpEngine } from '../infrastructure/crypto/nodeTotpEngine'
import { SqliteAuditLog } from '../infrastructure/db/sqliteAuditLog'
import { createFsMediaStore } from '../infrastructure/media/fsMediaStore'
import { createSharpImageProcessor } from '../infrastructure/media/sharpImageProcessor'
import { probeFfmpegCapability } from '../infrastructure/media/ffmpegBinaries'
import {
  createFfmpegVideoTranscoder,
  type FfmpegVideoTranscoder,
} from '../infrastructure/media/ffmpegVideoTranscoder'
import { minimalChildEnv } from '../infrastructure/media/runProcess'
import { nullVideoTranscoder } from '../infrastructure/media/nullVideoTranscoder'
import { detectVideoContainer } from '../infrastructure/media/magicBytes'
import { archiverWriter } from '../infrastructure/media/archiverWriter'
import { createBcryptPasswordHasher } from '../infrastructure/crypto/bcryptPasswordHasher'
import { createHmacGuestTokenService } from '../infrastructure/crypto/hmacGuestTokenService'
import { sha256SecretTokens } from '../infrastructure/crypto/sha256SecretTokens'
import { createHmacGallerySigner } from '../infrastructure/crypto/hmacGallerySigner'
import { randomIdGenerator } from '../infrastructure/crypto/randomIdGenerator'
import { createSequentialIdGenerator } from '../infrastructure/crypto/sequentialIdGenerator'
import { sha256ContentHasher } from '../infrastructure/crypto/sha256ContentHasher'
import { createInMemoryEventBus } from '../infrastructure/realtime/inMemoryEventBus'
import { createPinoLogger } from '../infrastructure/logging/pinoLogger'
import { nullMailer } from '../infrastructure/mail/nullMailer'
import { createSmtpMailer } from '../infrastructure/mail/smtpMailer'
import { systemClock } from '../infrastructure/time/systemClock'
import { statfsDiskSpaceChecker } from '../infrastructure/system/statfsDiskSpaceChecker'
import { evaluateDiskSpace } from '../domain/shared/diskSpaceGuard'
import type { Logger } from '../application/ports/logger'
import type { Mailer } from '../application/ports/mailer'
import { buildServer } from '../interface/http/server'
import type { HttpConfig, HttpDeps } from '../interface/http/types'
import type { PresenterContext } from '../interface/http/presenters/presenters'
import { buildUseCases, type Adapters, type UseCases } from './usecases'
import { createClipWorker, type ClipWorker } from './clipWorker'
import { clipUploadTempDir } from '../interface/http/routes/clipRoutes'
import {
  createMediaSweeper,
  isTooDangerousToSweep,
  MEDIA_SWEEP_MIN_AGE_MS,
  type MediaSweeper,
} from './mediaSweeper'
import { createReservationReaper, type ReservationReaper } from './reservationReaper'
import { createRetentionSweeper, type RetentionSweeper } from './retentionSweeper'
import { createScheduleSweeper, type ScheduleSweeper } from './scheduleSweeper'
import { appVersion } from './version'

/**
 * The composition root. **The only file in the codebase that constructs an adapter.**
 *
 * Everything else receives its dependencies as ports, which is what the eslint
 * boundary rules enforce and what makes every layer testable with fakes. 1.0 had no
 * equivalent: `src/database.ts` exported a mutable `db` that every route imported
 * directly, so import order decided whether the handle was defined and no test could
 * substitute a database.
 */

export interface Container {
  readonly app: Express
  readonly logger: Logger
  readonly usecases: UseCases
  /**
   * Outgoing mail (G2-07 / P3-08): the SMTP adapter when `SMTP_URL` is set, `NullMailer`
   * otherwise — which is what a self-hosted box with no mail server gets, and the caller's
   * cue to show a link to copy. Exposed rather than folded into `usecases` because no use
   * case sends mail yet; invitations and password reset (G2-08, G2-09) will take it from
   * here as an adapter.
   */
  readonly mailer: Mailer
  readonly db: Db
  /**
   * The retention timer, built but never started here — `index.ts` starts it once the
   * port is open and the shutdown handlers are installed. `null` when the operator has
   * turned the automatic sweep off and a cron running `npm run purge` owns the schedule.
   */
  readonly retention: RetentionSweeper | null
  /**
   * The media reconciliation timer, built here and started by `index.ts` like the other
   * two. It collects stored objects nothing names, which is what makes it safe for the
   * clip upload never to delete media itself. `null` on the same dial as `retention`.
   */
  readonly mediaReconciliation: MediaSweeper | null
  /**
   * The timer that opens and closes events on their schedule. Built here and started by
   * `index.ts`, exactly like `retention` above. `null` when an operator has turned the
   * automatic sweep off, in which case the two fields stay settable and visible and
   * nothing ever acts on them.
   */
  readonly schedule: ScheduleSweeper | null
  /**
   * The transcode queue's drain loop, built here and started by `index.ts` like the two
   * sweeps — except that this one's first pass is immediate, because it is also crash
   * recovery. Never `null`: with no encoder on the box the worker still runs and every
   * job it takes is refused with `clip.transcoderUnavailable`, which is what turns a
   * queue of clips nobody can process into a queue that empties and tells the guests why.
   */
  readonly clipWorker: ClipWorker
  /**
   * The reservation reaper, built here and started by `index.ts` like the rest.
   *
   * Never `null`: a reservation nothing reaps charges its event for bytes that do not
   * exist, holds a global queue slot and locks its digest, so there is no configuration
   * under which not running it is the right answer.
   */
  readonly reservationReaper: ReservationReaper
  /**
   * The one way `/api/ready` learns a shutdown is under way (docs/ARCHITECTURE.md
   * "Graceful shutdown"). `main/index.ts` calls `markShuttingDown()` as the very first
   * step of its SIGTERM/SIGINT handler, before anything else changes, so an
   * orchestrator stops sending new traffic ahead of the connections it is about to
   * lose.
   */
  readonly readiness: { markShuttingDown(): void }
  dispose(): Promise<void>
}

/**
 * How often the worker looks for a clip nobody announced.
 *
 * A drain normally starts from the bus, within milliseconds of the upload. This is the
 * backstop for the announcement that was missed — a publish with no subscriber at that
 * instant, a job put back by a retry's backoff — so it is measured in seconds rather
 * than the minutes the sweeps use: a guest is watching.
 */
const CLIP_WORKER_INTERVAL_MS = 15_000

/**
 * The ceiling on one clip's output.
 *
 * Passed to the encoder as `-fs`, so a pathological source cannot fill a disk however
 * long it claims to be. Generous against what 720p H.264 actually produces for fifteen
 * seconds (two to four megabytes) because the bound is a backstop, not a target.
 */
const CLIP_MAX_OUTPUT_BYTES = 40_000_000

/**
 * How long a clip reservation may sit before the reaper treats it as wreckage.
 *
 * Doubles as that reaper interval, so the worst case is two windows rather than an
 * evening: it ran only inside crash recovery once, and a row stranded ten seconds before
 * a restart was then correctly spared and never asked about again.
 *
 * The window it covers is a single `media.put` — milliseconds for anything a phone
 * uploads. Five minutes is generous on purpose: the one case where a reservation is
 * legitimately still being filled is a `--force-recreate` overlapping two containers,
 * and deleting the old one's upload would cost that guest their clip for nothing.
 */
const CLIP_RESERVATION_TIMEOUT_MS = 5 * 60 * 1000

/** The longest edge of the still frame the grid, the album and the wall render. */
const CLIP_POSTER_MAX_EDGE = 640

/**
 * The most digests one reconciliation pass considers, across every event.
 *
 * A pass walks the disk and holds the database connection that is also serving uploads
 * and the projector. Fifty thousand is several times a full venue and still a bounded
 * amount of work; an installation larger than that gets through it over successive
 * passes, and the skipped count says so.
 *
 * **It must stay well above any single event's digest count, and that is a real
 * constraint rather than a comfortable margin.** The cursor advances only past an event
 * the pass *finished*, so an event whose digests alone meet this budget is never
 * finished — and everything behind it is then starved for ever, which is the exact
 * failure the cursor exists to prevent, one level down. At `DEFAULT_EVENT_QUOTA_BYTES`
 * (5 GB) an event cannot hold fifty thousand distinct digests without averaging 100 kB
 * each across photographs and clips, so the default is safe by a wide margin. An operator
 * who raises the quota substantially should raise this with it; the alternative — a
 * cursor *inside* an event — is real work and buys nothing at any size this product is
 * deployed at.
 */
const MEDIA_SWEEP_MAX_DIGESTS = 50_000

/** A minute is plenty for a reaction: the domain owns the arithmetic, this is the window. */
const REACTION_WINDOW_MS = 60_000
const REACTION_MAX_PER_WINDOW = 20

/**
 * An empty directory, whatever was there before.
 *
 * Only ever pointed at the two scratch directories, which hold work in progress and
 * never anything addressable — so "delete it and make it again" is the whole of the
 * sweep. Deliberately not a filter over file ages, because age is not the question: what
 * is in there was being written by a process that is no longer writing it.
 *
 * That premise is per-process, and it is worth being exact about the one case where it
 * is not quite true. A `docker compose up --force-recreate` can overlap containers, so a
 * new one may sweep while an old one is still finishing a request. The consequence is
 * bounded to that overlap — the losing request answers `clip.stageFailed`, or a transcode
 * answers `clip.transcodeFailed`, both transient, both retried — and the alternative is
 * leaking up to `MAX_CLIP_BYTES` per interrupted upload forever, because nothing else
 * collects these: the retention sweep deletes an event's media by content hash and
 * neither of these files has one.
 */
const recreateDirectory = async (path: string): Promise<void> => {
  await rm(path, { recursive: true, force: true })
  await mkdir(path, { recursive: true })
}

export const createContainer = async (config: AppConfig): Promise<Container> => {
  // Minted once per process, never read from the environment: it exists so a log
  // shipper aggregating several boxes can tell one instance's lines from another's, not
  // to be chosen or repeated by an operator.
  const instanceId = randomUUID()
  const instanceBindings = { service: 'eventslide', version: appVersion(), instance: instanceId }

  const logger = createPinoLogger({
    level: config.logLevel,
    // Pretty output is for a person watching a terminal; production ships JSON a log
    // shipper can index.
    pretty: !config.isProduction,
    bindings: instanceBindings,
  })

  // ---------------------------------------------------------------- storage --

  const mediaRoot = resolve(config.storage.mediaRoot)
  await mkdir(mediaRoot, { recursive: true })

  /**
   * The free-disk-space guard's two paths (G3-06 / P4-10). `openDatabase` below
   * creates the first with `mkdirSync`, same as `mediaRoot` just above — both exist by
   * the time a request can reach either guard.
   *
   * **G3-06's delta from P4-10**: without a separate `SCRATCH_ROOT` (P4-04),
   * `mediaRoot` is also where a clip stages while it uploads (`clipUploadTempDir`,
   * `.scratch` above), so checking it already covers that scratch directory too —
   * there is no third path to add once P4-04 lands.
   */
  const diskSpacePaths = [dirname(resolve(config.storage.databasePath)), mediaRoot]
  // multer writes a clip here before it is staged, and the encoder writes its scratch
  // files beside it. Both are under MEDIA_ROOT rather than os.tmpdir(), because the
  // container runs read-only with a tmpfs charged to the same memory cgroup.
  //
  // **Emptied, not merely created.** Both hold work in progress and nothing else: what
  // survives a restart is what a `SIGKILL`, an OOM kill or a power cut left — up to
  // `MAX_CLIP_BYTES` per interrupted upload, on the disk the byte quota exists to
  // protect, charged to no event and invisible to `MediaStore.usedBytes`. Nothing else
  // would ever collect them: the retention sweep deletes an event's media by content
  // hash, and neither of these files has one.
  //
  // Skipped — loudly — when `MEDIA_ROOT` resolves somewhere shared, where a `.uploads`
  // is far more likely to be somebody else's than ours. Starting without the sweep is a
  // deliberate leak; starting with it there would be a deletion.
  //
  // **`realpath` first, because `resolve` does not follow symlinks.** A media root that
  // is a link to `$HOME` would walk straight past a comparison of resolved strings. It
  // falls back to the resolved path when the directory cannot be read, which is the
  // conservative direction: an unreadable root sweeps nothing either way.
  const realMediaRoot = await realpath(mediaRoot).catch(() => mediaRoot)
  if (isTooDangerousToSweep(realMediaRoot)) {
    logger.warn('not sweeping the scratch directories: MEDIA_ROOT is not a directory of its own', {
      mediaRoot,
    })
    await mkdir(clipUploadTempDir(mediaRoot), { recursive: true })
    await mkdir(resolve(mediaRoot, '.scratch'), { recursive: true })
  } else {
    await recreateDirectory(clipUploadTempDir(mediaRoot))
    await recreateDirectory(resolve(mediaRoot, '.scratch'))
  }

  const db = openDatabase({ path: config.storage.databasePath })

  // Migrations run before the port opens, so no request can arrive against a
  // half-migrated database. A checksum mismatch or an unknown recorded migration
  // throws here, which is the intended hard failure.
  const applied = migrate(db, migrations)
  if (applied.length > 0) {
    logger.info('applied migrations', { ids: applied.join(', ') })
  }

  const sessionStore = new SqliteSessionStore({ db, logger })

  // ----------------------------------------------------------------- ports --

  // Held as the concrete type, not the port: shutdown needs `close()`, which is the
  // adapter's own affordance and deliberately absent from `EventBus` — a use case has
  // no business tearing the bus down.
  const bus = createInMemoryEventBus({
    logger,
    maxSubscribersPerEvent: config.realtime.maxSubscribersPerEvent,
  })

  // -------------------------------------------------------------------- mail --

  /**
   * Chosen once, from configuration, and never by asking the relay anything at boot.
   *
   * **No connection is opened here and none is checked.** An SMTP relay that is down when the
   * box starts must not stop a photo wall from serving a room, so a bad address surfaces on
   * the first send, as `mail.transient`, and not as a boot that refuses to finish.
   * `NullMailer` is the default and logs nothing: a box with no relay is not misconfigured,
   * it is working as designed. When there is one, the line below names the relay's host and
   * port — never the URL, which carries the password.
   */
  const mailer: Mailer =
    config.mail.smtp === null
      ? nullMailer
      : createSmtpMailer({ settings: config.mail.smtp, logger })
  if (config.mail.smtp !== null) {
    logger.info('outgoing mail goes through an SMTP relay', {
      host: config.mail.smtp.endpoint.host,
      port: config.mail.smtp.endpoint.port,
    })
  }

  // ------------------------------------------------------------------- video --

  /**
   * Asked once, at boot, and never again.
   *
   * **It does not fail the boot and it does not fail `/api/ready`.** A photo wall with no
   * video still serves the room, and taking a venue's wall out of service over a missing
   * codec would be a far worse outage than the one it reports — so the answer is a
   * readiness *detail* beside `mediaWritable`, one log line, and a Null Object in place
   * of the encoder. Photo ingest never learns that any of this happened.
   *
   * The check is the encoder list, never a version string: a distribution's patched build
   * reports its own version, and one compiled without the non-free encoders reports a
   * perfectly modern one right up until the first transcode fails.
   */
  // Built once, from configuration rather than from `process.env` directly (menace T9,
  // `docs/SECURITY.md` §4.1), and handed to every ffmpeg or ffprobe child this process
  // ever starts — the boot-time capability probe below and every transcode after it.
  const ffmpegChildEnv = minimalChildEnv(config.clips.childEnvSource)

  const capability = await probeFfmpegCapability({
    ffmpegPath: config.clips.ffmpegPath ?? undefined,
    ffprobePath: config.clips.ffprobePath ?? undefined,
    search: config.clips.executableSearch,
    env: ffmpegChildEnv,
  })

  const ffmpeg: FfmpegVideoTranscoder | null = capability.available
    ? createFfmpegVideoTranscoder({
        paths: capability.paths,
        // Under MEDIA_ROOT, never os.tmpdir(): the container is read-only with a small
        // tmpfs charged to the same memory cgroup as the process.
        scratchRoot: resolve(mediaRoot, '.scratch'),
        env: ffmpegChildEnv,
      })
    : null

  if (ffmpeg === null) {
    // Once, at `warn`: it is a degraded capability rather than a misconfiguration, and an
    // operator who wanted video needs to be able to find out why they have none.
    logger.warn('no usable video encoder; clip uploads will be refused', {
      reason: capability.available ? '' : capability.reason,
      detail: 'photo uploads are unaffected; install ffmpeg or set FFMPEG_PATH',
    })
  }

  const videoTranscoder = ffmpeg ?? nullVideoTranscoder(detectVideoContainer)

  const adapters: Adapters = {
    clock: systemClock,
    /**
     * Random in production, counted under `E2E_HOOKS` — the same gate the wall's
     * timing hooks use, and one the config module refuses to accept in production.
     *
     * A visual baseline cannot be stable while the pixels depend on a random id: the
     * polaroid tilts each print by a hash of its photo id, so fresh ids meant fresh
     * angles and a snapshot that failed on tens of thousands of pixels of nothing. The
     * join code printed on the wall comes from the same port and was doing the same to
     * every full-page shot.
     */
    ids: config.e2eHooks ? createSequentialIdGenerator() : randomIdGenerator,
    logger,
    bus,
    events: new SqliteEventRepository(db),
    photos: new SqlitePhotoRepository(db),
    clips: new SqliteClipJobRepository(db),
    guests: new SqliteGuestRepository(db),
    reactions: new SqliteReactionRepository(db),
    missions: new SqliteMissionRepository(db),
    users: new SqliteUserRepository(db),
    memberships: new SqliteMembershipRepository(db),
    media: createFsMediaStore({ root: mediaRoot }),
    imageProcessor: createSharpImageProcessor({ maxPixels: config.uploads.maxPixels }),
    videoTranscoder,
    contentHasher: sha256ContentHasher,
    archive: archiverWriter,
    passwordHasher: createBcryptPasswordHasher({ cost: config.crypto.bcryptCost }),
    guestTokens: createHmacGuestTokenService({ secret: config.secrets.guestToken }),
    shareLinks: new SqliteShareLinkRepository(db),
    clients: new SqliteClientRepository(db),
    audit: new SqliteAuditLog(db),
    accountTokens: new SqliteAccountTokenRepository(db),
    secretTokens: sha256SecretTokens,
    mailer,
    secondFactors: new SqliteSecondFactorRepository(db),
    totpEngine: nodeTotpEngine,
    // Chosen once, from configuration: no key, no vault, and the enrolment routes answer
    // `404 feature.unavailable`. A recovery code still opens an enrolled account on such a box,
    // because it never needed the key.
    mfaVault:
      config.mfa.encryptionKey === null
        ? null
        : createAesGcmMfaVault({ keyMaterial: config.mfa.encryptionKey }),
    // HKDF-derived from the session secret under its own label — see the adapter for why
    // that parent, and why not a new variable a running installation would lack.
    gallerySigner: createHmacGallerySigner({ rootSecret: config.secrets.session }),
  }

  const usecases = buildUseCases(adapters, {
    publicUrl: config.publicUrl,
    defaultEventQuotaBytes: config.uploads.defaultEventQuotaBytes,
    maxEventQuotaBytes: config.uploads.maxEventQuotaBytes,
    maxImagePixels: config.uploads.maxPixels,
    events: config.events,
    retention: { capNoticeDays: config.retention.capNoticeDays },
    reactionBudget: { windowMs: REACTION_WINDOW_MS, maxPerWindow: REACTION_MAX_PER_WINDOW },
    mediaSweepMinimumAgeMs: MEDIA_SWEEP_MIN_AGE_MS,
    mediaSweepMaxDigestsPerPass: MEDIA_SWEEP_MAX_DIGESTS,
    auditRetentionDays: config.audit.retentionDays,
    operatorName: config.operator.name,
    mfaIssuer: config.operator.name ?? 'EventSlide',
    clips: {
      maxQueuedClips: config.clips.maxQueuedClips,
      maxQueuedClipsPerEvent: config.clips.maxQueuedClipsPerEvent,
      reservationTimeoutMs: CLIP_RESERVATION_TIMEOUT_MS,
      maxHeight: config.clips.maxHeight,
      maxDurationMs: config.clips.maxDurationMs,
      maxOutputBytes: CLIP_MAX_OUTPUT_BYTES,
      posterMaxEdge: CLIP_POSTER_MAX_EDGE,
      maxPixels: config.clips.maxPixels,
    },
  })

  // ------------------------------------------------------------- retention --

  /**
   * The single-box default: `docker compose up` and nothing else honours a host's
   * "delete after 30 days" without any further configuration.
   *
   * An operator who would rather a cron or a systemd timer owned the schedule sets
   * `RETENTION_SWEEP_INTERVAL_MINUTES=off` and runs `npm run purge` — which is the same
   * use case, so the two are never out of step.
   */
  const retention =
    config.retention.sweepIntervalMs === null
      ? null
      : createRetentionSweeper({
          purge: usecases.purgeExpiredEvents,
          pruneAuditLog: usecases.pruneAuditLog,
          logger,
          clock: adapters.clock,
          intervalMs: config.retention.sweepIntervalMs,
        })

  if (retention === null) {
    // Info, not a warning: it is a configured choice, and it is the default under
    // NODE_ENV=test. An operator reading a boot log still has to be able to see that
    // nothing in this process will ever act on a retention setting.
    logger.info('automatic retention sweep is off', {
      detail:
        'retention settings are honoured only when the purge command is run: ' +
        '`npm run purge`, or `node dist/ops/scripts/purge.js` in the image. ' +
        'The audit log is pruned only by this sweep, so with it off nothing prunes the audit log',
    })
  }

  /**
   * Media reconciliation, on the retention interval and for the same reason retention
   * has one: a leak that is only collected at the next boot is a disk that fills during
   * the evening rather than after it.
   *
   * A second sweeper rather than a second job inside the first, because the two answer
   * different questions and fail differently — this one collects objects nothing names,
   * that one deletes whole events a host asked to expire — and a shared outcome type
   * would make both harder to read. They share the operator's one dial.
   */
  //
  // **And not at all under a root it is not safe to delete under.** The boot sweep only
  // ever targets two named directories; this one deletes objects it decides are orphaned,
  // anywhere under the root — so it is the higher-risk deleter of the two, and gets the
  // same guard.
  const mediaReconciliation =
    config.retention.sweepIntervalMs === null || isTooDangerousToSweep(realMediaRoot)
      ? null
      : createMediaSweeper({
          sweep: usecases.sweepOrphanedMedia,
          logger,
          clock: adapters.clock,
          intervalMs: config.retention.sweepIntervalMs,
          // Half an interval behind the purge, so the routine case is not the two of them
          // walking and deleting the same tree at once.
          firstDelayMs: Math.max(1, Math.floor(config.retention.sweepIntervalMs / 2)),
        })

  if (mediaReconciliation === null) {
    logger.info('automatic media reconciliation is off', {
      detail:
        config.retention.sweepIntervalMs === null
          ? 'orphaned media is collected only when the purge command is run, which also ' +
            'sweeps: `npm run purge`, or `node dist/ops/scripts/purge.js` in the image'
          : 'MEDIA_ROOT is not a directory of its own, so nothing here will delete under it',
    })
  }

  /**
   * Reservations, on their own short cadence.
   *
   * Not on the retention dial and not optional: a stranded reservation charges its event
   * for bytes that do not exist, holds one of `MAX_QUEUED_CLIPS` slots and locks its
   * digest against the guest own retry, so an installation that switched this off would
   * simply be broken. The interval is the timeout itself, which makes the worst case two
   * windows rather than an evening.
   */
  const reservationReaper = createReservationReaper({
    reap: usecases.reapStaleReservations,
    logger,
    clock: adapters.clock,
    intervalMs: CLIP_RESERVATION_TIMEOUT_MS,
  })

  // -------------------------------------------------------------- scheduling --

  /**
   * The same arrangement for "opens at 18:00, closes at 02:00": on by default, because
   * a scheduled opening that nothing opens is worse than no field at all.
   */
  const schedule =
    config.schedule.sweepIntervalMs === null
      ? null
      : createScheduleSweeper({
          apply: usecases.applyEventSchedules,
          logger,
          clock: adapters.clock,
          intervalMs: config.schedule.sweepIntervalMs,
        })

  if (schedule === null) {
    // Info, not a warning: it is a configured choice, and it is the default under
    // NODE_ENV=test. An operator reading a boot log still has to be able to see that
    // nothing in this process will ever act on a scheduled opening or closing.
    logger.info('automatic scheduled open and close is off', {
      detail: 'an event opens and closes only when a host presses the button',
    })
  }

  // ------------------------------------------------------------ transcoding --

  /**
   * Always built, even with no encoder on the box.
   *
   * A worker that did not run would leave every queued clip `queued` forever — charged
   * to the event's quota, invisible to the guest who sent it, and waiting for a
   * capability that will not appear before the next boot. Running it means each job is
   * claimed, refused with `clip.transcoderUnavailable`, and the guest is told; the queue
   * empties instead of silently filling.
   */
  const clipWorker = createClipWorker({
    transcodeNext: usecases.transcodeNextClip,
    recover: usecases.recoverClipJobs,
    bus,
    logger,
    clock: adapters.clock,
    intervalMs: CLIP_WORKER_INTERVAL_MS,
  })

  // ------------------------------------------------------------- first run --

  await bootstrapFirstOwner(config, usecases, logger)

  // ------------------------------------------------------------------ http --

  // The one piece of mutable state a shutdown and a readiness probe share. A plain
  // object rather than a module-level flag, because `createContainer` can run more than
  // once in a process (every HTTP test that builds a harness does), and a module-level
  // flag would leak a shutdown from one container into another's readiness.
  const shutdownState = { shuttingDown: false }
  const readiness = {
    markShuttingDown: (): void => {
      shutdownState.shuttingDown = true
    },
  }

  const httpConfig: HttpConfig = {
    isProduction: config.isProduction,
    publicUrl: config.publicUrl,
    trustProxyHops: config.trustProxyHops,
    sessionSecret: config.secrets.session,
    secureCookie: config.session.secureCookie,
    e2eHooks: config.e2eHooks,
    siteAdmin: config.siteAdmin,
    secondFactor: {
      available: config.mfa.encryptionKey !== null,
      requiredForOperators: config.mfa.requireOperatorSecondFactor,
    },
    accessLog: {
      enabled: true,
      level: config.logLevel,
      pretty: !config.isProduction,
      ...instanceBindings,
    },
    storage: { minFreeDiskBytes: config.storage.minFreeDiskBytes, diskSpacePaths },
    uploads: {
      maxBytes: config.uploads.maxBytes,
      maxFiles: config.uploads.maxFiles,
      maxConcurrentRequests: config.uploads.maxConcurrentRequests,
    },
    clips: {
      maxBytes: config.clips.maxBytes,
      maxSeconds: Math.floor(config.clips.maxDurationMs / 1000),
      supported: ffmpeg !== null,
      uploadTempDir: clipUploadTempDir(mediaRoot),
    },
    rateLimits: config.rateLimits,
    realtime: {
      maxStreamsPerClient: config.realtime.maxStreamsPerClient,
      maxStreamsTotal: config.realtime.maxStreamsTotal,
    },
  }

  const httpDeps: HttpDeps = {
    clock: adapters.clock,
    logger,
    bus: adapters.bus,
    events: adapters.events,
    guests: adapters.guests,
    memberships: adapters.memberships,
    // Narrowed by `HttpDeps` to `siteRoleFor` and `authStateFor`: the whole adapter is
    // passed, and the HTTP layer can still only ask who operates the box and what
    // authorization reads about the account behind a session. Never a password hash, a
    // rename or a delete.
    users: adapters.users,
    // Narrowed by `HttpDeps` to `find`: whether an account has an authenticator, and nothing
    // of what it holds.
    secondFactors: adapters.secondFactors,
    guestTokens: adapters.guestTokens,
    // Narrowed by `HttpDeps` to the one fact the HTTP layer publishes.
    mailer,
    diskSpaceChecker: statfsDiskSpaceChecker,
    config: httpConfig,
  }

  const presenter: PresenterContext = {
    publicUrl: config.publicUrl,
    uploadLimits: { maxBytes: config.uploads.maxBytes, maxFiles: config.uploads.maxFiles },
    clipLimits: {
      maxBytes: config.clips.maxBytes,
      // Floor, never round: the guest surface refuses on this number, and
      // `clipFile.ts` is explicit that a client copy of a server rule may be stricter
      // and useless but never looser and misleading. A 15 500 ms cap rounded up to 16 s
      // is a client that waves through a clip the domain refuses.
      maxSeconds: Math.floor(config.clips.maxDurationMs / 1000),
      supported: ffmpeg !== null,
    },
  }

  // The built web app, when there is one. Absent during `npm run dev:api`, where Vite
  // serves the frontend and proxies /api here.
  const clientDir = resolve(process.cwd(), 'dist/client')
  const hasClient = existsSync(clientDir)
  if (!hasClient && config.isProduction) {
    logger.warn('no built web app found; serving the API only', { clientDir })
  }

  const app = buildServer({
    deps: httpDeps,
    usecases,
    sessionStore,
    presenter,
    health: {
      version: appVersion(),
      startedAt: adapters.clock.now(),
      now: () => adapters.clock.now(),
      databaseReady: async () => {
        // One trivial statement. Readiness must prove the handle answers, not exercise
        // the schema.
        db.prepare('SELECT 1').get()
        return true
      },
      mediaWritable: async () => probeWritable(mediaRoot),
      // The boot answer, handed back unchanged. Never a fresh probe: starting a
      // subprocess on a readiness path is how a probe becomes the thing that takes a
      // box down.
      videoTranscoding: () => (ffmpeg === null ? 'unavailable' : 'ok'),
      isShuttingDown: () => shutdownState.shuttingDown,
      // **Reported, never acted on** (G3-06 / P4-10) — the same posture as
      // `videoTranscoding` just above, and for the matching reason: an upload refused
      // for lack of disk space is a refusal of that request, not a state of the
      // service, so a tight margin must never flip `/api/ready` to 503 and take a whole
      // venue's wall out of service over headroom one guest's upload already answers
      // for on its own.
      diskSpace: async () => {
        const freeBytesByPath = await Promise.all(
          diskSpacePaths.map((path) => statfsDiskSpaceChecker.freeBytes(path)),
        )
        return evaluateDiskSpace(freeBytesByPath, config.storage.minFreeDiskBytes)
      },
    },
    // The source AGPL section 13 obliges this box to offer, for the version that is running.
    // Resolved here, once, because the HTTP layer may not import the config module or the
    // manifest reader — and from the same `appVersion()` as `health` above, so the two
    // endpoints cannot name different builds.
    about: {
      version: appVersion(),
      sourceUrl: resolveSourceUrl(appVersion(), config.source),
      // Every one `null` on a box that set nothing, which `/api/about` then leaves out
      // altogether: a self-hosted instance says nothing about money (roadmap G4-02), and
      // names nobody and links to nothing (roadmap G2-17).
      operator:
        config.operator.name === null
          ? null
          : { name: config.operator.name, contactEmail: config.operator.contactEmail },
      links: {
        donate: config.support.donationUrl,
        budget: config.support.budgetUrl,
        terms: config.operator.termsUrl,
        privacy: config.operator.privacyUrl,
        legalNotice: config.operator.legalNoticeUrl,
        support: config.operator.supportUrl,
        report: config.operator.reportUrl,
      },
    },
    ...(hasClient ? { clientDir } : {}),
  })

  return {
    app,
    logger,
    usecases,
    mailer,
    db,
    retention,
    mediaReconciliation,
    reservationReaper,
    schedule,
    clipWorker,
    readiness,
    dispose: async () => {
      // First: a sweep that started after the database was closed would log a failure
      // for every expired event and delete none of them. An already-running one is
      // abandoned rather than awaited — see the reasoning in `retentionSweeper.stop`.
      retention?.stop()
      mediaReconciliation?.stop()
      reservationReaper.stop()
      schedule?.stop()
      clipWorker.stop()
      // **Then the encoder itself.** `stop()` above abandons the drain, which leaves the
      // ffmpeg process it started running: a container stop orphans a child rather than
      // stopping it, so a new container would start the same job while the old encoder
      // holds a core for the rest of the evening.
      ffmpeg?.close()
      sessionStore.close()
      bus.close()
      // Last, and synchronous: it checkpoints the WAL so the `.sqlite` file is
      // self-contained. A host who copies it to a USB stick after the party should get
      // the whole album, not a file missing everything still in `-wal`.
      closeDatabase(db, config.storage.sqliteShutdownCheckpoint)
    },
  }
}

/**
 * Actually writes and removes a file.
 *
 * `access(W_OK)` is not enough: a read-only bind mount, a full disk and an
 * `fs.readonly` container all report the directory as writable and then fail on the
 * first upload. A container whose media root has gone read-only should be taken out of
 * service, which is what this answer drives.
 */
const probeWritable = async (root: string): Promise<boolean> => {
  const probe = resolve(root, `.readiness-${randomUUID()}`)
  try {
    await access(root, constants.W_OK)
    await writeFile(probe, '')
    return true
  } catch {
    return false
  } finally {
    await rm(probe, { force: true }).catch(() => {
      // A leaked probe file is swept by the next successful check; failing readiness
      // over the cleanup would be worse than the leak.
    })
  }
}

/**
 * Creates the first owner on an empty database, from configuration.
 *
 * This replaces 1.0's hardcoded `admin` / `password` account, whose bcrypt hash was a
 * literal in `src/database.ts` and which `initDatabase()` re-inserted on every boot —
 * so an operator who changed the password got it back at the next restart.
 *
 * A failure is logged and not fatal: an operator who mistypes the bootstrap password
 * should get a clear message and a running server they can fix, not a boot loop.
 */
const bootstrapFirstOwner = async (
  config: AppConfig,
  usecases: UseCases,
  logger: Logger,
): Promise<void> => {
  const { ownerEmail, ownerPassword } = config.bootstrap
  if (ownerEmail === null || ownerPassword === null) return

  const result = await usecases.bootstrapOwner({
    email: ownerEmail,
    password: ownerPassword,
    // No name from configuration: the account is the operator's own, and they can set
    // one from the app. Inventing "Admin" here would be a label nobody chose.
    displayName: null,
  })
  if (!result.ok) {
    logger.error('could not create the first owner account', { code: result.error.code })
    return
  }
  if (result.value.created) {
    logger.info('created the first owner account', { email: ownerEmail })
  }
}
