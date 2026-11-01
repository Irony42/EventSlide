import { Router } from 'express'
import { asPhotoId } from '../../../domain/shared/ids'
import { requireRole } from '../middleware/authz'
import { withModerator } from '../middleware/scope'
import type { HighlightsDto, PreselectHighlightsResponseDto } from '../presenters/dto'
import { sendError, sendJson, sendResult, sendResultNoContent } from '../presenters/send'
import { photoParams, preselectHighlightsBody } from '../schemas/requestSchemas'
import type { RouteDeps } from '../useCases'
import { streamOrAbandon } from './mediaRoutes'

/**
 * The host's favourites and the best-of ZIP (spec 08, PR A).
 *
 * Every route is a moderator of this event. Nothing here decides anything: the use cases
 * own the guards (suspended client, taken-down event, archived event), the star's rule and
 * the ZIP's filter; this file parses, calls one use case and presents.
 *
 * Reads are never stored: the count and the archive describe a selection that keeps moving.
 */

export const highlightRoutes = ({ deps, usecases }: RouteDeps): Router => {
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
        sendJson<HighlightsDto>(response, { count: value.count }),
      )
    }),
  )

  /** The favourites as a ZIP, streamed like the album's and named from the validated slug. */
  router.get(
    '/events/:eventSlug/best-of.zip',
    requireRole('moderator', deps),
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
