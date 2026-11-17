import { Router } from 'express'
import { DomainError } from '../../../domain/shared/errors'
import { requireRole } from '../middleware/authz'
import { EXPORT_REQUESTS_PER_ACCOUNT_PER_HOUR, exportRequestLimiter } from '../middleware/rateLimit'
import type { StreamLimiter } from '../middleware/rateLimit'
import { hostScopeOf, withModerator } from '../middleware/scope'
import type { AlbumExportDto } from '../presenters/dto'
import { toAlbumExportDto } from '../presenters/presenters'
import { errorBody, sendError, sendJson, sendResult } from '../presenters/send'
import { serveRanged } from '../presenters/serveRanged'
import { requestExportBody } from '../schemas/requestSchemas'
import type { RouteDeps } from '../useCases'

/**
 * The verified archive of the album, prepared on the box for the host to download and check
 * (spec 22).
 *
 * Every route is a moderator of this event, like the album ZIP. Nothing here decides anything: the
 * use cases own the guards (a suspended client, a taken-down event, the switch, the daily
 * ceiling, the disk), and `exportAllowed` is the one rule the streamed ZIP answers by too; this file
 * parses, calls one use case and presents.
 *
 * **One answer for "there is nothing to download"**: `404 export.notFound`, whether the archive was
 * never made, is not sealed, went stale because something left the album, expired, or lost its
 * file. The filename comes from the event's validated slug.
 *
 * **The download goes through the same concurrency bound as `album.zip` and `best-of.zip`**
 * (`hostExportLimiter`, built once by `server.ts`): serving six gigabytes is no cheaper because
 * the file is ready. It is `Cache-Control: no-store`, carries the digest of the whole ZIP as its
 * strong `ETag`, and a `Range` request resumes a download.
 *
 * **`served_at` is stamped only by a `200` that carried every byte to the socket** (rule 5): a `206`,
 * a `304`, a refusal and a response the client abandoned half way are not a send. The server sees
 * the last byte leave; it cannot know the host's disk received it, which is why the page says
 * "sent" and never "received".
 */

export type ExportRouteDeps = Pick<RouteDeps, 'deps' | 'usecases'> & {
  /**
   * The bound `album.zip` and `best-of.zip` share: `server.ts` builds one and hands it to every
   * router that streams a host's archive. Required, with no default: a router that built its own
   * would silently be a second allowance.
   */
  readonly hostExportLimiter: StreamLimiter
}

export const exportRoutes = ({
  deps,
  usecases,
  hostExportLimiter: exportLimiter,
}: ExportRouteDeps): Router => {
  const router = Router()
  const requestLimiter = exportRequestLimiter(EXPORT_REQUESTS_PER_ACCOUNT_PER_HOUR)

  router.post(
    '/events/:eventSlug/export',
    requireRole('moderator', deps),
    requestLimiter,
    withModerator(async ({ eventId }, req, res) => {
      requestExportBody.parse(req.body)
      const result = await usecases.requestAlbumExport({
        eventId,
        actorId: hostScopeOf(req).user.userId,
      })
      if (!result.ok && result.error.code === 'export.unavailable') {
        res.status(503).json(errorBody(result.error))
        return
      }
      res.setHeader('Cache-Control', 'no-store')
      sendResult(res, result, (response, archive) =>
        sendJson<AlbumExportDto>(response, toAlbumExportDto(archive), 202),
      )
    }),
  )

  router.get(
    '/events/:eventSlug/export',
    requireRole('moderator', deps),
    withModerator(async ({ eventId }, _req, res) => {
      const result = await usecases.getAlbumExport({ eventId })
      res.setHeader('Cache-Control', 'no-store')
      if (!result.ok) {
        sendError(res, result.error)
        return
      }
      if (result.value === null) {
        sendError(res, DomainError.notFound('export.notFound'))
        return
      }
      sendJson<AlbumExportDto>(res, toAlbumExportDto(result.value))
    }),
  )

  router.get(
    '/events/:eventSlug/export.zip',
    requireRole('moderator', deps),
    // A `HEAD` is the browser link asking whether this `GET` would start (see `answerHead`):
    // answered here, with no slot taken and no use case run.
    exportLimiter.answerHead,
    // After the role, which puts the account on the request; the slot goes back when the response
    // closes, a refusal by the use case below included.
    exportLimiter,
    withModerator(async ({ eventId, slug }, req, res) => {
      // Nothing is written until the use case has answered: a refusal is a JSON error, never a
      // download named `-album.zip`.
      const result = await usecases.downloadAlbumExport({ eventId })
      if (!result.ok) {
        sendError(res, result.error)
        return
      }
      const file = result.value

      res.setHeader('X-Content-Type-Options', 'nosniff')

      const outcome = await serveRanged(req, res, file, {
        contentType: 'application/zip',
        cacheControl: 'no-store',
        refusalCacheControl: 'no-store',
        contentDisposition: `attachment; filename="${slug}-album.zip"`,
        // A strong validator: the digest of the whole ZIP, which is also what the host can check.
        etag: `"${file.sha256}"`,
        failureMessage: 'album archive download failed mid-stream',
      })
      // Only the whole file on a `200` counts (rule 5). Awaited, so the page that refetches on the
      // signal it publishes reads the new state, and never allowed to fail a download that ended.
      if (outcome === 'whole') {
        try {
          await file.markServed()
        } catch (error) {
          req.context.logger.warn('could not note that an archive was sent in full', {
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    }),
  )

  return router
}
