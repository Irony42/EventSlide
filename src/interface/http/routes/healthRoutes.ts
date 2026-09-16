import { Router } from 'express'
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
      const [database, media] = await Promise.all([
        checks.databaseReady().catch(() => false),
        checks.mediaWritable().catch(() => false),
      ])

      // Not in the conjunction below, on purpose: see `videoTranscoding`.
      const video = checks.videoTranscoding()

      if (database && media) {
        res.json({ status: 'ready', checks: { database: 'ok', media: 'ok', video } })
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
          },
        },
      })
    }),
  )

  return router
}
