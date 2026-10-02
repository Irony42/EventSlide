import type { Container } from './container'
import { drainStreams as drainOpenStreams } from '../interface/http/routes/streamRoutes'

/**
 * Graceful shutdown, split out of `index.ts` so its ordering can be called directly
 * from a test with fakes.
 *
 * `index.ts` has a top-level side effect — it calls `bootstrap()` the moment the module
 * loads — so nothing can `import` it without starting the real server. The ordering this
 * module implements is the actual acceptance criterion behind P4-06's "graceful
 * shutdown": flip readiness, drain SSE, *then* let the server stop accepting
 * connections (docs/ARCHITECTURE.md "Graceful shutdown"). A rule stated only in that
 * comment, with no test that fails when the order breaks, is exactly the defect
 * `.claude/skills/eventslide-mutation/` calls out — so the steps are a small function
 * taking its collaborators as arguments instead of reading `process` and a module-level
 * `Server`/`Container` directly.
 *
 * 1.0 registered `process.on('exit')` with an async `db.close()`, which never
 * completed — so the WAL was never checkpointed and a host copying the `.sqlite` file
 * after the party got one missing everything still in `-wal`.
 */

const defaultGrace = 15_000

/** The one piece of `http.Server` this module touches, so a test can fake it. */
export interface ShutdownServer {
  close(callback: (error?: Error) => void): void
}

export interface ShutdownDeps {
  readonly server: ShutdownServer
  readonly container: Pick<Container, 'logger' | 'readiness' | 'dispose'>
  /** Milliseconds before the backstop forces an exit. Defaults to 15s. */
  readonly grace?: number
  /** Defaults to `process.exit`. Overridden in tests so nothing actually exits. */
  readonly exit?: (code: number) => void
  /** Defaults to the real SSE hub. Overridden in tests so no real connection is needed. */
  readonly drainStreams?: () => void
}

/**
 * Builds the SIGTERM/SIGINT handler. Returns a plain function instead of registering it,
 * so the ordering it implements — readiness, then drain, then `server.close()` — is
 * something a test can call directly and observe, rather than something only a real
 * signal and a real exit code could confirm.
 */
export const createShutdownHandler = (deps: ShutdownDeps): ((signal: string) => void) => {
  const grace = deps.grace ?? defaultGrace
  const exit = deps.exit ?? ((code: number): void => process.exit(code))
  const drainStreams = deps.drainStreams ?? drainOpenStreams
  let shuttingDown = false

  return (signal: string): void => {
    if (shuttingDown) {
      // A second Ctrl-C means the operator has stopped waiting.
      deps.container.logger.warn('second signal received, exiting immediately', { signal })
      exit(1)
      return
    }
    shuttingDown = true
    deps.container.logger.info('shutting down', { signal })

    // First of all, so an orchestrator stops sending new traffic before anything else
    // here changes — docs/ARCHITECTURE.md "Graceful shutdown".
    deps.container.readiness.markShuttingDown()

    // Every open SSE connection is told to reconnect, then ended. Without this,
    // `server.close()`'s callback below never fires: an SSE response is by design never
    // finished on its own (CLAUDE.md §9 trap 3), so a projector holding an eight-hour
    // stream would keep a "graceful" shutdown hanging for the full grace period, every
    // time, instead of only when the backstop below is actually needed.
    drainStreams()

    // Stop accepting new connections, then let in-flight requests finish. An upload
    // that has already been re-encoded but not yet written would otherwise be lost.
    deps.server.close(() => {
      void (async () => {
        try {
          await deps.container.dispose()
          deps.container.logger.info('shutdown complete')
          exit(0)
        } catch (error) {
          deps.container.logger.error('shutdown failed', {
            error: error instanceof Error ? error.message : String(error),
          })
          exit(1)
        }
      })()
    })

    // The backstop: an SSE stream is open for hours by design and will not close on
    // its own, so waiting for every connection would mean never exiting.
    setTimeout(() => {
      deps.container.logger.warn('shutdown grace elapsed, forcing exit')
      void deps.container.dispose().finally(() => exit(0))
    }, grace).unref()
  }
}

/** Wires the handler built above to the process's actual signals. */
export const installShutdown = (server: ShutdownServer, container: Container): void => {
  const shutdown = createShutdownHandler({ server, container })

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
