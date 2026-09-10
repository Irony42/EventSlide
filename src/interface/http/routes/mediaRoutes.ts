import { Router, type Request, type Response } from 'express'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Logger } from '../../../application/ports/logger'
import type { MediaViewer, PhotoMedia } from '../../../application/usecases/photos/getPhotoMedia'
import type { Event } from '../../../domain/events/event'
import { canModerate } from '../../../domain/events/eventRole'
import { DomainError } from '../../../domain/shared/errors'
import { asPhotoId } from '../../../domain/shared/ids'
import { asyncHandler } from '../middleware/asyncHandler'
import { GUEST_COOKIE, requireRole, resolvePublicEvent } from '../middleware/authz'
import { sendError } from '../presenters/send'
import { eventSlugParams, photoVariantParams } from '../schemas/requestSchemas'
import type { HttpDeps } from '../types'
import type { HttpUseCases, RouteDeps } from '../useCases'

/**
 * The bytes. Every photo and every album is served by a controller, never by
 * `express.static`, which is the only arrangement under which authorization and event
 * scoping apply to *every byte*.
 *
 * 1.0 served its photo directory statically and built the path out of the session's
 * `partyId` and the client's own filename. Two consequences followed. A pending photo —
 * one nobody had approved — was readable by anyone who guessed a name, still carrying
 * the guest's GPS coordinates. And the filename was a path, so keeping `..` out was a
 * regex's job.
 *
 * Both routes below refuse with **404 and never 403**. A 403 confirms that a photo id
 * exists inside an event the caller cannot see, which turns a media URL into an
 * enumeration oracle for a wedding's photo count. That rule is in docs/API.md and it is
 * the reason `getPhotoMedia` returns `photo.notFound` for a variant the caller merely
 * lacks the standing to read.
 */

/**
 * Only the two use cases this module calls.
 *
 * `RouteDeps` satisfies it structurally, so `server.ts` passes its whole bag unchanged.
 * Narrowing here states what the module needs and keeps a test from having to build
 * thirty unrelated use cases to exercise a photo download.
 */
export type MediaRouteDeps = Pick<RouteDeps, 'deps'> & {
  readonly usecases: Pick<HttpUseCases, 'exportAlbum' | 'getPhotoMedia'>
}

/** A year. Safe only because the name is the content hash — see {@link etagFor}. */
const IMMUTABLE_CACHE = 'private, max-age=31536000, immutable'

/**
 * A strong validator, derived from the digest of the stored bytes.
 *
 * The variant is part of it as well as part of the URL. An ETag identifies one
 * representation, and `thumb` and `display` of the same photo share a content hash
 * while being different bytes — so keying on the digest alone would be correct only for
 * as long as nothing ever compared validators across two of this photo's URLs.
 */
const etagFor = (media: PhotoMedia): string => `"${media.contentHash.value}-${media.variant}"`

/**
 * Streams an iterable to the response, and abandons the connection if it fails.
 *
 * `pipeline`, never `pipe`: `pipe` leaves the response open when the source errors, so
 * the client would receive a truncated body under the 200 it has every reason to trust.
 * A half-written ZIP looks exactly like a complete album, and a host who then deletes
 * their photos believing they hold a copy has lost them. By the time bytes are flowing
 * the status line is long gone, so destroying the socket is the only signal left that
 * the body is incomplete.
 *
 * The failure is caught here rather than forwarded to the error handler because
 * `pipeline` has already destroyed the response: handing it on would have the error
 * handler write a JSON body to a dead socket.
 */
const streamOrAbandon = async (
  res: Response,
  logger: Logger,
  message: string,
  chunks: AsyncIterable<Uint8Array>,
): Promise<void> => {
  try {
    await pipeline(Readable.from(chunks), res)
  } catch (error) {
    logger.error(message, { error: error instanceof Error ? error.message : String(error) })
    res.destroy()
  }
}

/**
 * The same three checks `requireGuest` makes, but silent on failure.
 *
 * A cookie that fails any of them leaves the caller **public** rather than rejected: a
 * guest at another wedding, or one whose event was purged and recreated, may still look
 * at this event's published photos, and answering 401 would break the public wall for
 * anyone who has ever joined anything. Failing open is safe here precisely because the
 * public viewer is the least privileged one.
 *
 * The event id in the claims is compared against the event resolved from the URL, never
 * against an id the client sent. That comparison is the cross-event attack, and its
 * absence is what let 1.0's upload endpoint write to any event name a client asked for.
 */
const guestViewer = async (
  deps: HttpDeps,
  req: Request,
  event: Event,
): Promise<MediaViewer | null> => {
  const raw: unknown = req.cookies?.[GUEST_COOKIE]
  if (typeof raw !== 'string' || raw.length === 0) return null

  const claims = deps.guestTokens.verify(raw, deps.clock.now())
  if (!claims.ok) return null
  if (claims.value.eventId !== event.id) return null

  // The row is what makes a signed, stateless token revocable at all, so it is read on
  // every request rather than trusted from the signature.
  const guest = await deps.guests.findById(event.id, claims.value.guestId)
  if (guest === null || guest.isRevoked()) return null

  return { kind: 'guest', guestId: guest.id }
}

/**
 * Who is asking, in the use case's own vocabulary.
 *
 * This is identity, not permission. `getPhotoMedia` owns the policy — which viewer may
 * read which variant of which status — and this route only tells it who turned up.
 * Resolving a role through `deps.memberships` is the same work `requireRole` does; it is
 * merely optional here, because a projector holding the public wall URL is a legitimate
 * caller of this route and must not be turned away before the policy has been applied.
 *
 * The order is deliberate. A host who is also carrying a guest cookie for their own
 * event is a moderator: the broader identity wins, or the host's own moderation grid
 * would show them less than they are entitled to see.
 *
 * `canModerate` is asked rather than the two roles being listed. Both of today's roles
 * satisfy it, so the negative branch is unreachable — that is the price of a check that
 * does not silently start granting the day a third, weaker role is added.
 */
const viewerFor = async (deps: HttpDeps, req: Request, event: Event): Promise<MediaViewer> => {
  const user = req.context.user
  if (user) {
    const role = await deps.memberships.roleFor(event.id, user.userId)
    // A session with no membership of *this* event is a member of the public here, and
    // is told nothing more than the public is told.
    if (role !== null && canModerate(role)) return { kind: 'moderator', userId: user.userId }
  }

  return (await guestViewer(deps, req, event)) ?? { kind: 'public' }
}

const sendMedia = async (req: Request, res: Response, media: PhotoMedia): Promise<void> => {
  // Set before the freshness check: a 304 must still carry the validator and the caching
  // policy, or a projector revalidates every slide for the rest of the night.
  res.setHeader('ETag', etagFor(media))
  res.setHeader('Cache-Control', IMMUTABLE_CACHE)
  // The stored bytes are always a re-encoded image, but a browser that sniffs its way to
  // something executable is how an upload becomes stored XSS.
  res.setHeader('X-Content-Type-Options', 'nosniff')
  // Never `attachment`: the wall, the moderation grid and the guest's own view all
  // render these in an `<img>`.
  res.setHeader('Content-Disposition', 'inline')

  // `req.fresh` compares `If-None-Match` weakly, as RFC 9110 requires, handles a list of
  // validators and honours a client's own `Cache-Control: no-cache`. A projector
  // re-requesting the same slide across an eight-hour run must not re-download it.
  if (req.fresh) {
    // No body, and deliberately no `Content-Length`: a 304 that declares a length is a
    // response some proxies wait on.
    res.status(304).end()
    return
  }

  res.setHeader('Content-Type', media.contentType)
  // From the store's own metadata, so the declared length is the length that will be
  // written. 1.0 had no length at all and every image arrived chunked.
  res.setHeader('Content-Length', String(media.byteSize))

  await streamOrAbandon(res, req.context.logger, 'photo media failed mid-stream', media.bytes)
}

export const mediaRoutes = ({ deps, usecases }: MediaRouteDeps): Router => {
  const router = Router()

  /**
   * One variant of one photo.
   *
   * The event is resolved without requiring a principal, because the public may read a
   * published photo — that is what makes the projector work with no credential at all.
   * Note the consequence of `resolvePublicEvent`: an event that does not serve its wall
   * (a draft, or an archived one) serves no media either, to anybody. The album export
   * below is the archived event's read path.
   */
  router.get(
    '/events/:eventSlug/photos/:photoId/:variant',
    resolvePublicEvent(deps),
    asyncHandler(async (req, res) => {
      const params = photoVariantParams.parse(req.params)

      const event = req.context.event
      if (!event) {
        // `resolvePublicEvent` always populates it. This keeps the type honest without a
        // non-null assertion, which is banned here because the one case where `!` would
        // be wrong is a route that forgot its authorization decision.
        return sendError(res, DomainError.notFound('event.notFound'))
      }

      const viewer = await viewerFor(deps, req, event)

      const result = await usecases.getPhotoMedia({
        eventId: event.id,
        photoId: asPhotoId(params.photoId),
        variant: params.variant,
        viewer,
      })

      if (!result.ok) return sendError(res, result.error)

      return sendMedia(req, res, result.value)
    }),
  )

  /** The whole album as a ZIP. Moderator or above, and streamed. */
  router.get(
    '/events/:eventSlug/album.zip',
    requireRole('moderator', deps),
    asyncHandler(async (req, res) => {
      const params = eventSlugParams.parse(req.params)

      const event = req.context.event
      if (!event) return sendError(res, DomainError.notFound('event.notFound'))

      const result = await usecases.exportAlbum({ eventId: event.id })
      if (!result.ok) return sendError(res, result.error)

      res.setHeader('Content-Type', 'application/zip')
      // The slug has been parsed against `^[a-z0-9]+(?:-[a-z0-9]+)*$`, so it cannot
      // carry a quote or a CRLF into this header. Nothing guest-supplied reaches the
      // filename, here or inside the archive.
      res.setHeader('Content-Disposition', `attachment; filename="${params.eventSlug}-album.zip"`)
      // An album is a snapshot of a queue that keeps moving, and unlike a photo it is
      // not content-addressed, so there is no name that could make it cacheable.
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('X-Content-Type-Options', 'nosniff')

      // No `Content-Length`: the size is unknown until the archive has been written, and
      // a four-thousand-photo wedding is several gigabytes. Streamed, never buffered.
      return streamOrAbandon(
        res,
        req.context.logger,
        'album export failed mid-stream',
        result.value,
      )
    }),
  )

  return router
}
