import { Router, type RequestHandler } from 'express'
import { asPhotoId } from '../../../domain/shared/ids'
import { requireRole } from '../middleware/authz'
import { hostExportLimiter } from '../middleware/rateLimit'
import { withModerator } from '../middleware/scope'
import type { HighlightsDto, PreselectHighlightsResponseDto } from '../presenters/dto'
import { serveRanged, streamOrAbandon } from '../presenters/serveRanged'
import { toReelDto } from '../presenters/presenters'
import { sendError, sendJson, sendResult, sendResultNoContent } from '../presenters/send'
import { photoParams, preselectHighlightsBody } from '../schemas/requestSchemas'
import type { HttpUseCases, RouteDeps } from '../useCases'
import type { ReelDto } from '../presenters/dto'

/**
 * The host's favourites and the best-of ZIP (spec 08, PR A).
 *
 * Every route is a moderator of this event. Nothing here decides anything: the use cases
 * own the guards (suspended client, taken-down event, archived event), the star's rule and
 * the ZIP's filter; this file parses, calls one use case and presents.
 *
 * Reads are never stored: the count and the archive describe a selection that keeps moving.
 */

export type HighlightRouteDeps = Pick<RouteDeps, 'deps'> & {
  readonly usecases: Pick<
    HttpUseCases,
    | 'setPhotoHighlight'
    | 'preselectHighlights'
    | 'getHighlights'
    | 'requestReel'
    | 'getReelMedia'
    | 'exportHighlights'
  >
  /** Shared with `album.zip` (see `MediaRouteDeps`): one allowance for both host exports. */
  readonly hostExportLimiter?: RequestHandler
}

export const highlightRoutes = ({
  deps,
  usecases,
  hostExportLimiter: exportLimiter = hostExportLimiter(),
}: HighlightRouteDeps): Router => {
  const router = Router()

  const setStar = (highlighted: boolean) =>
    withModerator(async ({ eventId }, req, res) => {
      const params = photoParams.parse(req.params)
      const result = await usecases.setPhotoHighlight({
        eventId,
        photoId: asPhotoId(params.photoId),
        highlighted,
      })
      sendResultNoContent(res, result)
    })

  router.put(
    '/events/:eventSlug/photos/:photoId/highlight',
    requireRole('moderator', deps),
    setStar(true),
  )
  router.delete(
    '/events/:eventSlug/photos/:photoId/highlight',
    requireRole('moderator', deps),
    setStar(false),
  )

  router.post(
    '/events/:eventSlug/highlights/preselect',
    requireRole('moderator', deps),
    withModerator(async ({ eventId }, req, res) => {
      const body = preselectHighlightsBody.parse(req.body)
      const result = await usecases.preselectHighlights({ eventId, limit: body.limit })
      sendResult(res, result, (response, outcome) =>
        sendJson<PreselectHighlightsResponseDto>(response, { added: outcome.added }),
      )
    }),
  )

  router.get(
    '/events/:eventSlug/highlights',
    requireRole('moderator', deps),
    withModerator(async ({ eventId }, _req, res) => {
      const result = await usecases.getHighlights({ eventId })
      res.setHeader('Cache-Control', 'no-store')
      sendResult(res, result, (response, value) =>
        sendJson<HighlightsDto>(response, {
          count: value.count,
          reel: value.reel === null ? null : toReelDto(value.reel),
        }),
      )
    }),
  )

  /**
   * Asks for the montage of the favourites (spec 08). No body: the selection is the favourites as
   * they are now, frozen by the server, and there is no source to choose. `202` with the state; a
   * second click while one is made is `409 reel.alreadyRunning`, which the panel reads as "already
   * on its way".
   */
  router.post(
    '/events/:eventSlug/highlights/reel',
    requireRole('moderator', deps),
    withModerator(async ({ eventId }, _req, res) => {
      const result = await usecases.requestReel({ eventId })
      res.setHeader('Cache-Control', 'no-store')
      sendResult(res, result, (response, job) =>
        sendJson<ReelDto>(
          response,
          toReelDto({
            status: job.status,
            photoCount: job.photoIds.length,
            durationMs: null,
            byteSize: null,
            failureCode: null,
            updatedAt: job.updatedAt,
          }),
          202,
        ),
      )
    }),
  )

  /**
   * The finished montage, `Range` included so a browser can play and seek it. Every request
   * re-checks the photographs first (`getReelMedia`), so what is served is never a photograph the
   * evening has since lost. Never stored: the answer depends on the evening as it is now.
   */
  router.get(
    '/events/:eventSlug/highlights/reel.mp4',
    requireRole('moderator', deps),
    withModerator(async ({ eventId, slug }, req, res) => {
      const result = await usecases.getReelMedia({ eventId })
      res.setHeader('X-Content-Type-Options', 'nosniff')
      if (!result.ok) {
        res.setHeader('Cache-Control', 'no-store')
        sendError(res, result.error)
        return
      }

      const media = result.value
      const etag = `"${media.contentHash.value}-reel"`
      await serveRanged(req, res, media, {
        contentType: media.contentType,
        cacheControl: 'private, no-store',
        refusalCacheControl: 'no-store',
        // Played in the page and saved by the download link, under a name drawn from the slug.
        contentDisposition: `inline; filename="${slug}-souvenir.mp4"`,
        etag,
        failureMessage: 'photo media failed mid-stream',
      })
    }),
  )

  /** The favourites as a ZIP, streamed like the album's and named from the validated slug. */
  router.get(
    '/events/:eventSlug/best-of.zip',
    requireRole('moderator', deps),
    // The same bound as `album.zip`, after the role and released when the response closes (SEC-04).
    exportLimiter,
    withModerator(async ({ eventId, slug }, req, res) => {
      // Nothing is written until the use case has answered: `highlight.empty` is a JSON
      // error, never a download named `-best-of.zip`.
      const result = await usecases.exportHighlights({ eventId })
      if (!result.ok) {
        sendError(res, result.error)
        return
      }

      res.setHeader('Content-Type', 'application/zip')
      res.setHeader('Content-Disposition', `attachment; filename="${slug}-best-of.zip"`)
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('X-Content-Type-Options', 'nosniff')

      await streamOrAbandon(
        res,
        req.context.logger,
        'best-of export failed mid-stream',
        result.value,
      )
    }),
  )

  return router
}
