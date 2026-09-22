import { Router, type Request, type RequestHandler, type Response } from 'express'
import { notAvailable } from '../../../application/usecases/gallery/galleryAccess'
import { DomainError } from '../../../domain/shared/errors'
import { asPhotoId, asShareLinkId } from '../../../domain/shared/ids'
import { asyncHandler } from '../middleware/asyncHandler'
import {
  galleryLimiter,
  galleryMediaLimiter,
  galleryUnlockLimiters,
  streamConnectionLimiter,
} from '../middleware/rateLimit'
import { toGalleryDto, toGalleryPageDto } from '../presenters/presenters'
import { sendError, sendJson, sendNoContent, sendResult } from '../presenters/send'
import {
  galleryArchiveParams,
  galleryGrantQuery,
  galleryMediaParams,
  galleryPhotosQuery,
  galleryTokenParams,
  galleryUnlockBody,
} from '../schemas/requestSchemas'
import type { HttpConfig, HttpDeps } from '../types'
import type { HttpUseCases } from '../useCases'
import { streamOrAbandon } from './mediaRoutes'

/**
 * The shared gallery (roadmap §4.1): **the product's first public read surface.**
 *
 * Everything else a stranger can reach is the wall, which shows what is on a projector in
 * a room anyway. This serves full-resolution photographs to whoever holds a URL, so it is
 * built as a public surface from the first line:
 *
 * - **No authorization middleware, by decision.** The token in the path *is* the
 *   credential, and the use cases decide everything with it (`galleryAccess.ts`). The
 *   route sweep lists these under `PUBLIC_ROUTES` with that reason.
 * - **One neutral refusal.** A malformed token, an unknown one, an expired, revoked or
 *   orphaned link and a purged event are all the same `404 gallery.notAvailable`, byte
 *   for byte. A malformed URL is parsed with `safeParse` so that it cannot answer a
 *   different `400` and tell a guesser which half of the check they failed.
 * - **Its own rate limits**: pages, bytes, and password attempts per client *and* per
 *   link, failures only — `middleware/rateLimit.ts` has the argument.
 * - **Headers on every response**, refusals included: `Referrer-Policy: no-referrer`,
 *   because the token is in the page's URL; `X-Robots-Tag: noindex, nofollow`, because a
 *   wedding album is nobody's search result; `Cache-Control: no-store` for everything the
 *   token gates, relaxed only to `private` for a signed thumbnail, for no longer than its
 *   signature lives. The global `helmet` policy sets a referrer policy too; this sets its
 *   own so the gallery does not depend on a line in another file staying put.
 * - **Media by signed URL**, never by token: the id of the link, the photograph, the
 *   rendition and an expiry, all inside one HMAC — so "copy image address" does not hand
 *   out the key to the album — and re-checked against the link on every request, so a
 *   revoked link's URLs die with it.
 * - **The password is posted, never put in a URL**, and what comes back is a short-lived
 *   `HttpOnly`, `SameSite=Strict` cookie scoped to this API path, holding a MAC and not the
 *   password.
 */

export const GALLERY_UNLOCK_COOKIE = 'es_gallery'

/**
 * Scoped to the gallery's API, so the unlock is sent to nothing else — not to the rest of
 * `/api`, and not to the signed media URLs under `/api/gallery-media`, which do not need
 * it: a cookie path matches only at a `/` boundary.
 */
export const GALLERY_COOKIE_PATH = '/api/gallery'

/**
 * The headers every gallery response carries. Exported for the one response that is not
 * an API route: the SPA shell `server.ts` serves at `/g/:token`.
 */
export const setGalleryHeaders = (res: Response): void => {
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Robots-Tag', 'noindex, nofollow')
  res.setHeader('Cache-Control', 'no-store')
}

const galleryHeaders: RequestHandler = (_req, res, next) => {
  setGalleryHeaders(res)
  next()
}

/**
 * How many archives one client, and the whole box, may be streaming at once.
 *
 * A ZIP of a wedding is gigabytes and minutes of disk reads, so a rate per minute is the
 * wrong quantity: two requests a minute is nothing, two hundred concurrent ones is the box.
 * The same concurrency limiter the wall's stream uses, with numbers for a download.
 */
const ARCHIVES_PER_CLIENT = 2
const ARCHIVES_TOTAL = 4

export interface GalleryRouteDeps {
  readonly deps: HttpDeps
  readonly usecases: Pick<
    HttpUseCases,
    | 'openGallery'
    | 'unlockGallery'
    | 'listGalleryPhotos'
    | 'getGalleryMedia'
    | 'downloadGalleryArchive'
  >
  readonly limits: Pick<
    HttpConfig['rateLimits'],
    'galleryPerMinute' | 'galleryMediaPerMinute' | 'galleryUnlockPerClient' | 'galleryUnlockPerLink'
  >
}

const unlockProofOf = (req: Request): string | null => {
  const raw: unknown = req.cookies?.[GALLERY_UNLOCK_COOKIE]
  return typeof raw === 'string' && raw.length > 0 ? raw : null
}

/** A token that is not token-shaped is answered exactly as a dead one. */
const tokenOf = (req: Request): string | null => {
  const parsed = galleryTokenParams.safeParse(req.params)
  return parsed.success ? parsed.data.token : null
}

export const galleryRoutes = ({ deps, usecases, limits }: GalleryRouteDeps): Router => {
  const router = Router()

  router.use(['/gallery', '/gallery-media'], galleryHeaders)

  const pages = galleryLimiter(limits.galleryPerMinute)
  const bytes = galleryMediaLimiter(limits.galleryMediaPerMinute)
  const attempts = galleryUnlockLimiters({
    perClient: limits.galleryUnlockPerClient,
    perLink: limits.galleryUnlockPerLink,
  })
  const archives = streamConnectionLimiter({
    perClient: ARCHIVES_PER_CLIENT,
    total: ARCHIVES_TOTAL,
  })

  /** What the album is, before the grid: its name, its size, its archive, its expiry. */
  router.get(
    '/gallery/:token',
    pages,
    asyncHandler(async (req, res) => {
      const token = tokenOf(req)
      if (token === null) return sendError(res, notAvailable())

      const result = await usecases.openGallery({ token, unlockProof: unlockProofOf(req) })

      sendResult(res, result, (response, view) => sendJson(response, toGalleryDto(view)))
    }),
  )

  /**
   * The password, posted. The answer is a cookie and an empty body.
   *
   * Two budgets, in this order. The attempt limiters count failures only, so a family can
   * all open one album — which also means they never stop somebody who *knows* the
   * password from posting it all day, and every post is a hash verification sized to cost
   * real CPU. The page budget in front bounds that to what one client may already spend
   * reading the album. It goes first so that a request it turns away is never counted as
   * a failed guess against the link.
   */
  router.post(
    '/gallery/:token/unlock',
    pages,
    ...attempts,
    asyncHandler(async (req, res) => {
      const token = tokenOf(req)
      if (token === null) return sendError(res, notAvailable())
      const body = galleryUnlockBody.parse(req.body)

      const result = await usecases.unlockGallery({ token, password: body.password })
      if (!result.ok) return sendError(res, result.error)

      res.cookie(GALLERY_UNLOCK_COOKIE, result.value.proof, {
        httpOnly: true,
        // Strict, not the Lax the session uses: the gallery's own page is the only thing
        // that ever needs to send this, and it does so from this origin. A guest arriving
        // from a messaging app is a top-level navigation to `/g/…`, which loads the page
        // and needs no cookie.
        sameSite: 'strict',
        secure: deps.config.secureCookie,
        path: GALLERY_COOKIE_PATH,
        maxAge: Math.max(0, result.value.expiresAt.getTime() - deps.clock.now().getTime()),
      })
      return sendNoContent(res)
    }),
  )

  /** One page of the grid, each photograph with its three signed URLs. */
  router.get(
    '/gallery/:token/photos',
    pages,
    asyncHandler(async (req, res) => {
      const token = tokenOf(req)
      if (token === null) return sendError(res, notAvailable())
      const query = galleryPhotosQuery.parse(req.query)

      const result = await usecases.listGalleryPhotos({
        token,
        unlockProof: unlockProofOf(req),
        cursor: query.cursor ?? null,
      })

      sendResult(res, result, (response, page) => sendJson(response, toGalleryPageDto(page)))
    }),
  )

  /** The whole album as one ZIP, behind its own signature. */
  router.get(
    '/gallery-media/:linkId/album.zip',
    bytes,
    archives,
    asyncHandler(async (req, res) => {
      const params = galleryArchiveParams.safeParse(req.params)
      const grant = galleryGrantQuery.safeParse(req.query)
      if (!params.success || !grant.success) return sendError(res, notAvailable())

      // Nothing is written until the use case has answered: once `attachment` is on the
      // wire the browser is saving a file, and a refusal after that would be saved too.
      const result = await usecases.downloadGalleryArchive({
        linkId: asShareLinkId(params.data.linkId),
        expiresAtMs: grant.data.e,
        signature: grant.data.s,
      })
      if (!result.ok) return sendError(res, result.error)

      res.setHeader('Content-Type', 'application/zip')
      // A validated slug: no quote and no CRLF can reach this header.
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${result.value.event.slug.value}-album.zip"`,
      )
      res.setHeader('X-Content-Type-Options', 'nosniff')
      return streamOrAbandon(
        res,
        req.context.logger,
        'gallery archive failed mid-stream',
        result.value.chunks,
      )
    }),
  )

  /** One rendition of one photograph, behind a signature. */
  router.get(
    '/gallery-media/:linkId/:photoId/:variant',
    bytes,
    asyncHandler(async (req, res) => {
      const params = galleryMediaParams.safeParse(req.params)
      const grant = galleryGrantQuery.safeParse(req.query)
      if (!params.success || !grant.success) return sendError(res, notAvailable())

      const result = await usecases.getGalleryMedia({
        linkId: asShareLinkId(params.data.linkId),
        photoId: asPhotoId(params.data.photoId),
        variant: params.data.variant,
        expiresAtMs: grant.data.e,
        signature: grant.data.s,
      })
      if (!result.ok) return sendError(res, result.error)
      const media = result.value

      // Everything is decided; now the one open, for the bytes this response will write.
      const chunks = await media.open()
      if (chunks === null) return sendError(res, DomainError.notFound('photo.mediaMissing'))

      res.setHeader('Content-Type', media.contentType)
      res.setHeader('Content-Length', String(media.byteSize))
      res.setHeader('X-Content-Type-Options', 'nosniff')
      if (media.disposition === 'attachment') {
        // The full-resolution file, saved rather than shown, under a name the server chose.
        res.setHeader('Content-Disposition', `attachment; filename="${media.fileName ?? 'photo'}"`)
      } else {
        // A thumbnail may sit in this browser's own cache — `private`, so in no shared
        // one — for exactly as long as its signature would still be honoured, and no
        // longer. The grid re-renders without re-downloading; nothing outlives the grant.
        const seconds = Math.floor((media.expiresAt.getTime() - deps.clock.now().getTime()) / 1000)
        res.setHeader('Content-Disposition', 'inline')
        res.setHeader('Cache-Control', `private, max-age=${Math.max(0, seconds)}`)
      }

      return streamOrAbandon(res, req.context.logger, 'gallery media failed mid-stream', chunks)
    }),
  )

  return router
}
