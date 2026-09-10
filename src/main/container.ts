import { resolve } from 'node:path'
import { access, constants, mkdir, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import type { Express } from 'express'
import type { AppConfig } from '../infrastructure/config/env'
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
import { createFsMediaStore } from '../infrastructure/media/fsMediaStore'
import { createSharpImageProcessor } from '../infrastructure/media/sharpImageProcessor'
import { archiverWriter } from '../infrastructure/media/archiverWriter'
import { createBcryptPasswordHasher } from '../infrastructure/crypto/bcryptPasswordHasher'
import { createHmacGuestTokenService } from '../infrastructure/crypto/hmacGuestTokenService'
import { randomIdGenerator } from '../infrastructure/crypto/randomIdGenerator'
import { sha256ContentHasher } from '../infrastructure/crypto/sha256ContentHasher'
import { createInMemoryEventBus } from '../infrastructure/realtime/inMemoryEventBus'
import { createPinoLogger } from '../infrastructure/logging/pinoLogger'
import { systemClock } from '../infrastructure/time/systemClock'
import type { Logger } from '../application/ports/logger'
import { buildServer } from '../interface/http/server'
import type { HttpConfig, HttpDeps } from '../interface/http/types'
import type { PresenterContext } from '../interface/http/presenters/presenters'
import { buildUseCases, type Adapters, type UseCases } from './usecases'

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
  readonly db: Db
  dispose(): Promise<void>
}

const VERSION = '2.0.0'

/** A minute is plenty for a reaction: the domain owns the arithmetic, this is the window. */
const REACTION_WINDOW_MS = 60_000
const REACTION_MAX_PER_WINDOW = 20

export const createContainer = async (config: AppConfig): Promise<Container> => {
  const logger = createPinoLogger({
    level: config.logLevel,
    // Pretty output is for a person watching a terminal; production ships JSON a log
    // shipper can index.
    pretty: !config.isProduction,
  })

  // ---------------------------------------------------------------- storage --

  const mediaRoot = resolve(config.storage.mediaRoot)
  await mkdir(mediaRoot, { recursive: true })

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
  const bus = createInMemoryEventBus({ logger })

  const adapters: Adapters = {
    clock: systemClock,
    ids: randomIdGenerator,
    logger,
    bus,
    events: new SqliteEventRepository(db),
    photos: new SqlitePhotoRepository(db),
    guests: new SqliteGuestRepository(db),
    reactions: new SqliteReactionRepository(db),
    users: new SqliteUserRepository(db),
    memberships: new SqliteMembershipRepository(db),
    media: createFsMediaStore({ root: mediaRoot }),
    imageProcessor: createSharpImageProcessor({ maxPixels: config.uploads.maxPixels }),
    contentHasher: sha256ContentHasher,
    archive: archiverWriter,
    passwordHasher: createBcryptPasswordHasher({ cost: config.crypto.bcryptCost }),
    guestTokens: createHmacGuestTokenService({ secret: config.secrets.guestToken }),
  }

  const usecases = buildUseCases(adapters, {
    defaultEventQuotaBytes: config.uploads.defaultEventQuotaBytes,
    maxImagePixels: config.uploads.maxPixels,
    reactionBudget: { windowMs: REACTION_WINDOW_MS, maxPerWindow: REACTION_MAX_PER_WINDOW },
  })

  // ------------------------------------------------------------- first run --

  await bootstrapFirstOwner(config, usecases, logger)

  // ------------------------------------------------------------------ http --

  const httpConfig: HttpConfig = {
    isProduction: config.isProduction,
    publicUrl: config.publicUrl,
    trustProxyHops: config.trustProxyHops,
    sessionSecret: config.secrets.session,
    secureCookie: config.session.secureCookie,
    e2eHooks: config.e2eHooks,
    uploads: { maxBytes: config.uploads.maxBytes, maxFiles: config.uploads.maxFiles },
    rateLimits: config.rateLimits,
  }

  const httpDeps: HttpDeps = {
    clock: adapters.clock,
    logger,
    bus: adapters.bus,
    events: adapters.events,
    guests: adapters.guests,
    memberships: adapters.memberships,
    guestTokens: adapters.guestTokens,
    config: httpConfig,
  }

  const presenter: PresenterContext = {
    publicUrl: config.publicUrl,
    uploadLimits: { maxBytes: config.uploads.maxBytes, maxFiles: config.uploads.maxFiles },
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
      version: VERSION,
      startedAt: adapters.clock.now(),
      now: () => adapters.clock.now(),
      databaseReady: async () => {
        // One trivial statement. Readiness must prove the handle answers, not exercise
        // the schema.
        db.prepare('SELECT 1').get()
        return true
      },
      mediaWritable: async () => probeWritable(mediaRoot),
    },
    ...(hasClient ? { clientDir } : {}),
  })

  return {
    app,
    logger,
    usecases,
    db,
    dispose: async () => {
      sessionStore.close()
      bus.close()
      // Last, and synchronous: it checkpoints the WAL so the `.sqlite` file is
      // self-contained. A host who copies it to a USB stick after the party should get
      // the whole album, not a file missing everything still in `-wal`.
      closeDatabase(db)
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
