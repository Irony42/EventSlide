import { Router } from 'express'
import { requireRole } from '../middleware/authz'
import {
  BOOK_DOWNLOADS_PER_ACCOUNT_PER_MINUTE,
  bookDownloadLimiter,
  bookRequestLimiter,
} from '../middleware/rateLimit'
import { withModerator } from '../middleware/scope'
import type { AlbumBookDto } from '../presenters/dto'
import { toAlbumBookDto } from '../presenters/presenters'
import { errorBody, sendError, sendJson, sendResult, sendResultNoContent } from '../presenters/send'
import { serveRanged } from '../presenters/serveRanged'
import { requestBookBody } from '../schemas/requestSchemas'
import type { RouteDeps } from '../useCases'

/**
 * The photo book, a PDF of the published album (spec 04).
 *
 * Every route is a moderator of this event, like the album ZIP. Nothing here decides anything:
 * the use cases own the guards (suspended client, taken-down event, the box and client switches,
 * the daily ceiling, an expired or stale book); this file parses, calls one use case and presents.
 *
 * **One answer for "there is nothing to download"**: `404 book.notFound`, whether the book was
 * never made, is not finished, went stale because a photograph left, expired, or its file is gone.
 * The filename comes from the event's validated slug, never from the title the host typed.
 * `book.unavailable` (the function is switched off on this box) is a correct answer about a
 * temporary state, so it is `503`, like the other ones `send.ts` lists.
 */

export const bookRoutes = ({ deps, usecases }: RouteDeps): Router => {
  const router = Router()
  const requestLimiter = bookRequestLimiter(deps.config.rateLimits.bookRequestsPerHour)
  const downloadLimiter = bookDownloadLimiter(BOOK_DOWNLOADS_PER_ACCOUNT_PER_MINUTE)

  router.post(
    '/events/:eventSlug/book',
    requireRole('moderator', deps),
    requestLimiter,
    withModerator(async ({ eventId }, req, res) => {
      const body = requestBookBody.parse(req.body)
      const result = await usecases.requestAlbumBook({ eventId, ...body })
      if (!result.ok && result.error.code === 'book.unavailable') {
        res.status(503).json(errorBody(result.error))
        return
      }
      res.setHeader('Cache-Control', 'no-store')
      sendResult(res, result, (response, book) =>
        sendJson<AlbumBookDto>(response, toAlbumBookDto(book), 202),
      )
    }),
  )

  router.get(
    '/events/:eventSlug/book',
    requireRole('moderator', deps),
    withModerator(async ({ eventId }, _req, res) => {
      const result = await usecases.getAlbumBook({ eventId })
      res.setHeader('Cache-Control', 'no-store')
      sendResult(res, result, (response, book) =>
        sendJson<AlbumBookDto>(response, toAlbumBookDto(book)),
      )
    }),
  )

  router.get(
    '/events/:eventSlug/book.pdf',
    requireRole('moderator', deps),
    downloadLimiter,
    withModerator(async ({ eventId, slug }, req, res) => {
      // Nothing is written until the use case has answered: a refusal is a JSON error, never a
      // download named `-livre.pdf`.
      const result = await usecases.downloadAlbumBook({ eventId })
      if (!result.ok) {
        sendError(res, result.error)
        return
      }
      const file = result.value

      res.setHeader('X-Content-Type-Options', 'nosniff')

      await serveRanged(req, res, file, {
        contentType: 'application/pdf',
        cacheControl: 'no-store',
        refusalCacheControl: 'no-store',
        contentDisposition: `attachment; filename="${slug}-livre.pdf"`,
        failureMessage: 'photo book download failed mid-stream',
      })
    }),
  )

  router.delete(
    '/events/:eventSlug/book',
    requireRole('moderator', deps),
    withModerator(async ({ eventId }, _req, res) => {
      sendResultNoContent(res, await usecases.deleteAlbumBook({ eventId }))
    }),
  )

  return router
}
