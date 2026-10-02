import { Router } from 'express'
import type { DiskSpaceStatus } from '../../../domain/shared/diskSpaceGuard'
import { asyncHandler } from '../middleware/asyncHandler'

/**
 * Liveness and readiness, and the difference between them matters here.
 *
 * `/api/health` must not touch the database. A liveness probe that fails while SQLite
 * is briefly busy causes the container restart it was meant to prevent — and a restart
 * mid-event drops every in-flight upload.
 *
 * `/api/ready` is the one that checks dependencies, because a container whose media
 * root has gone read-only should be taken out of service rather than kept accepting
 * uploads it cannot store.
 */

export interface HealthChecks {
  readonly version: string
  /** Started at boot, so uptime is real rather than derived from a request. */
  readonly startedAt: Date
  readonly now: () => Date
  /** Cheap: one `SELECT 1`. Throws or resolves false when the database is unusable. */
  readonly databaseReady: () => Promise<boolean>
  /** Writes and removes a probe file, so a read-only volume is detected. */
  readonly mediaWritable: () => Promise<boolean>
  /**
   * Whether this box has an encoder that can produce a clip a browser will play.
   *
   * **Reported, never acted on.** It is deliberately not part of the ready/not-ready
   * decision: a photo wall with no video still serves the room, and taking a venue's wall
   * out of service over a missing codec would be a far worse outage than the one it
   * reports. An operator reading `/api/ready` sees it beside `media`; an orchestrator
   * reading the status code does not, which is the point.
   *
   * Decided once at boot rather than probed per request — starting a subprocess on a
   * liveness path is how a readiness probe becomes the thing that takes a box down.
   */
  readonly videoTranscoding: () => 'ok' | 'unavailable'
  /**
   * Flips once a shutdown signal has been received (docs/ARCHITECTURE.md "Graceful
   * shutdown"). Checked **first** and unconditionally: an orchestrator must stop
   * sending new traffic the moment this box starts draining, whether or not the
   * database and the media root still answer — they are not the question once this is
   * true.
   */
  readonly isShuttingDown: () => boolean
  /**
   * The free-disk-space guard's own margin (G3-06 / P4-10).
   *
   * **Reported, never acted on** — the same posture as {@link videoTranscoding} and for
   * the matching reason: the guard already refuses the one request that would have
   * minded, so a tight margin must never flip this route's status and take a whole
   * venue's wall out of service over headroom no request currently needs.
   */
  readonly diskSpace: () => Promise<DiskSpaceStatus>
}

export const healthRoutes = (checks: HealthChecks): Router => {
  const router = Router()

  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      version: checks.version,
      uptimeSeconds: Math.floor((checks.now().getTime() - checks.startedAt.getTime()) / 1000),
    })
  })

  router.get(
    '/ready',
    asyncHandler(async (_req, res) => {
      // Checked before either dependency, and without awaiting anything: a load
      // balancer draining this instance must be told so in one tick, not after a
      // database round trip that a shutting-down process may be slow to answer at all.
      if (checks.isShuttingDown()) {
        res.status(503).json({
          error: {
            code: 'service.notReady',
            message: 'The server is shutting down',
            details: {
              database: 'unavailable',
              media: 'unavailable',
              video: checks.videoTranscoding(),
            },
          },
        })
        return
      }

      const [database, media] = await Promise.all([
        checks.databaseReady().catch(() => false),
        checks.mediaWritable().catch(() => false),
      ])

      // Neither is in the conjunction below, on purpose: see `videoTranscoding` and
      // `diskSpace`.
      const video = checks.videoTranscoding()
      const disk = await checks
        .diskSpace()
        .catch((): DiskSpaceStatus => ({ sufficient: false, freeBytes: null }))

      if (database && media) {
        res.json({ status: 'ready', checks: { database: 'ok', media: 'ok', video, disk } })
        return
      }

      // 503 rather than 500: this is a correct answer about an incorrect state, and an
      // orchestrator distinguishes the two.
      res.status(503).json({
        error: {
          code: 'service.notReady',
          message: 'A dependency is unavailable',
          details: {
            database: database ? 'ok' : 'unavailable',
            media: media ? 'ok' : 'unavailable',
            video,
            disk,
          },
        },
      })
    }),
  )

  return router
}
