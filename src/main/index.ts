import { createServer, type Server } from 'node:http'
import { loadConfig, ConfigError } from '../infrastructure/config/env'
import { createContainer, type Container } from './container'

/**
 * The bootstrap. The only file that listens on a port.
 *
 * Order matters and is deliberate:
 *  1. Parse configuration. A misconfigured deployment must fail here, loudly, before
 *     anything is open — 1.0 read the environment inline at module load, so a missing
 *     secret surfaced at the first request instead of at startup.
 *  2. Open the database and migrate. A schema change is applied before the port opens,
 *     so no request can arrive against a half-migrated database.
 *  3. Bootstrap the first owner if the database is empty. This is what replaces 1.0's
 *     hardcoded admin/password account, which `initDatabase()` recreated on every boot.
 *  4. Build the HTTP app, then listen.
 *  5. Install the shutdown handlers.
 *  6. Start the two sweeps: retention, the only thing in the process that acts on an
 *     event's `retentionDays` on its own, and scheduling, the only thing that acts on a
 *     scheduled opening or closing.
 */

const shutdownGrace = 15_000

const bootstrap = async (): Promise<void> => {
  let config
  try {
    config = loadConfig()
  } catch (error) {
    if (error instanceof ConfigError) {
      // Every problem at once. Discovering misconfiguration one variable per restart is
      // miserable when you are setting up in a venue an hour before the guests arrive.
      console.error(error.message)
      process.exit(78) // EX_CONFIG
    }
    throw error
  }

  const container = await createContainer(config)
  const { logger } = container

  const server = createServer(container.app)

  // Node's default is 5s, which is shorter than a guest uploading four photos over
  // congested venue Wi-Fi. Too low and the upload is cut off mid-request.
  server.keepAliveTimeout = 65_000
  server.headersTimeout = 70_000
  // No request timeout: the SSE stream is deliberately open for hours, and the ZIP
  // export of a four-thousand-photo album legitimately takes minutes.
  server.requestTimeout = 0

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(config.port, () => {
      server.removeListener('error', reject)
      resolve()
    })
  })

  logger.info('EventSlide is listening', {
    port: config.port,
    publicUrl: config.publicUrl,
    env: config.env,
  })
  if (!config.isProduction) {
    // The one place a banner on stdout is the right thing to do: a developer needs the
    // URL, and a guest's phone needs it to be the LAN address rather than localhost.
    console.log(`\n  EventSlide  ->  ${config.publicUrl}\n`)
  }

  installShutdown(server, container)

  // Last, and deliberately after the shutdown handlers: the timer is unref'd and is
  // stopped by `dispose()`, so by starting it here a signal arriving in the same tick
  // already has somewhere to land. The first sweep is one interval away, never now —
  // a restart mid-event must not begin deleting albums while the party is uploading.
  container.retention?.start()
  // Same reasoning, and the first sweep is likewise one interval away: a restart at
  // 18:02 must not decide the state of the evening before the shutdown handlers exist.
  container.schedule?.start()
  // The exception to "one interval away", and deliberately so: this one's first pass is
  // **immediate**, because it is also crash recovery. A clip left mid-transcode by a
  // restart is invisible to everything until this puts it back, and a guest who is
  // standing in the room has already waited once.
  container.clipWorker.start()
}

/**
 * Graceful shutdown.
 *
 * 1.0 registered `process.on('exit')` with an async `db.close()`, which never
 * completed — so the WAL was never checkpointed and a host copying the `.sqlite` file
 * after the party got one missing everything still in `-wal`.
 */
const installShutdown = (server: Server, container: Container): void => {
  let shuttingDown = false

  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      // A second Ctrl-C means the operator has stopped waiting.
      container.logger.warn('second signal received, exiting immediately', { signal })
      process.exit(1)
    }
    shuttingDown = true
    container.logger.info('shutting down', { signal })

    // Stop accepting new connections, then let in-flight requests finish. An upload
    // that has already been re-encoded but not yet written would otherwise be lost.
    server.close(() => {
      void (async () => {
        try {
          await container.dispose()
          container.logger.info('shutdown complete')
          process.exit(0)
        } catch (error) {
          container.logger.error('shutdown failed', {
            error: error instanceof Error ? error.message : String(error),
          })
          process.exit(1)
        }
      })()
    })

    // The backstop: an SSE stream is open for hours by design and will not close on
    // its own, so waiting for every connection would mean never exiting.
    setTimeout(() => {
      container.logger.warn('shutdown grace elapsed, forcing exit')
      void container.dispose().finally(() => process.exit(0))
    }, shutdownGrace).unref()
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  // A bug, not an expected failure. Log it with everything available and exit: staying
  // up in an unknown state is worse than restarting, and the container restarts.
  process.on('uncaughtException', (error) => {
    container.logger.error('uncaught exception', { error: error.message, stack: error.stack })
    process.exit(1)
  })
  process.on('unhandledRejection', (reason) => {
    container.logger.error('unhandled rejection', {
      error: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    })
    process.exit(1)
  })
}

void bootstrap().catch((error: unknown) => {
  // Before the logger exists there is nowhere else to put this.
  console.error('EventSlide failed to start:', error)
  process.exit(1)
})
