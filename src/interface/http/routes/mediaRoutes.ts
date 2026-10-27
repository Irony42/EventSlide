import { Router, type Request, type Response } from 'express'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Logger } from '../../../application/ports/logger'
import type { ByteRange } from '../../../application/ports/mediaStore'
import type { PhotoMedia } from '../../../application/usecases/photos/getPhotoMedia'
import { DomainError } from '../../../domain/shared/errors'
import { asPhotoId } from '../../../domain/shared/ids'
import { asyncHandler } from '../middleware/asyncHandler'
import { guestTokenOf, requireRole, resolvePublicEvent } from '../middleware/authz'
import { publicEventOf } from '../middleware/scope'
import { contentRange, parseByteRange, unsatisfiedRange } from '../presenters/byteRange'
import { errorBody, sendError } from '../presenters/send'
import { photoVariantParams } from '../schemas/requestSchemas'
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
 * Any refusal that would confirm a photo or an event exists is **404, never 403**. A 403
 * confirms that a photo id sits inside an event the caller cannot see, which turns a
 * media URL into an enumeration oracle for a wedding's photo count. That rule is in
 * docs/API.md, and it is why `getPhotoMedia` answers `photo.notFound` for a variant the
 * caller merely lacks the standing to read, and why `requireRole` answers the album with
 * `event.notFound` for a caller who is not a member of that event.
 *
 * The album is the one route here that also answers **401**: refusing a caller with no
 * session before the event is looked up is what stops an anonymous request being used to
 * discover which slugs are on the box.
 */

/**
 * Only the two use cases this module calls.
 *
 * `RouteDeps` satisfies it structurally, so `server.ts` passes its whole bag unchanged.
 * Narrowing here states what the module needs and keeps a test from having to build
 * thirty unrelated use cases to exercise a photo download.
 */
export type MediaRouteDeps = Pick<RouteDeps, 'deps'> & {
  readonly usecases: Pick<HttpUseCases, 'exportAlbum' | 'getPhotoMedia' | 'identifyMediaViewer'>
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
export const streamOrAbandon = async (
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
 * Everything decided before a single byte is opened, then exactly one stream.
 *
 * **The order here is the fix for a descriptor leak, not a preference.** `openRead`
 * opens the file when the stream is *constructed*, so any answer that opens bytes it
 * does not write costs a descriptor until the garbage collector happens to run — and
 * three of this route's four answers send no bytes. A `<video>` issues a `Range` request
 * per seek and a projector revalidates every slide it already holds, so the count climbs
 * for as long as the party lasts and ends in `EMFILE`, which takes the wall down.
 *
 * So: headers, then the freshness check, then the range verdict, and only then `open`.
 * A `304` and a `416` leave this function having opened nothing at all.
 */
const sendMedia = async (
  req: Request,
  res: Response,
  media: PhotoMedia,
  range: ByteRange | null,
): Promise<void> => {
  // Set before the freshness check: a 304 must still carry the validator and the caching
  // policy, or a projector revalidates every slide for the rest of the night.
  res.setHeader('ETag', etagFor(media))
  res.setHeader('Cache-Control', IMMUTABLE_CACHE)
  // Never `attachment`: the wall, the moderation grid and the guest's own view all
  // render these in an `<img>` or a `<video>`.
  res.setHeader('Content-Disposition', 'inline')
  // **Advertised on every response, not only on a clip.** A media element decides whether
  // it can seek from this header, and it asks about the object before it plays it — so a
  // response that omits it is one a player treats as unseekable.
  res.setHeader('Accept-Ranges', 'bytes')

  // `req.fresh` compares `If-None-Match` weakly, as RFC 9110 requires, handles a list of
  // validators and honours a client's own `Cache-Control: no-cache`. A projector
  // re-requesting the same slide across an eight-hour run must not re-download it.
  if (req.fresh) {
    // No body, and deliberately no `Content-Length`: a 304 that declares a length is a
    // response some proxies wait on.
    res.status(304).end()
    return
  }

  // The one open, for the bytes this response is now committed to writing. `null` here
  // is not the range being outside the object — that was answered above, against the
  // size this same read reported — so it is a row pointing at a file that is gone.
  const bytes = await media.open(range ?? undefined)
  if (bytes === null) {
    sendError(res, DomainError.notFound('photo.mediaMissing'))
    return
  }

  res.setHeader('Content-Type', media.contentType)

  if (range === null) {
    // From the store's own metadata, so the declared length is the length that will be
    // written. 1.0 had no length at all and every image arrived chunked.
    res.setHeader('Content-Length', String(media.byteSize))
  } else {
    // A `206` declares the length of the **part**, and `Content-Range` the whole. Getting
    // the two the wrong way round is how a player stalls at the end of the first chunk.
    res.status(206)
    res.setHeader('Content-Range', contentRange(range, media.byteSize))
    res.setHeader('Content-Length', String(range.end - range.start + 1))
  }

  await streamOrAbandon(res, req.context.logger, 'photo media failed mid-stream', bytes)
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
    // A suspended client's members still read their own photographs, so the middleware lets the
    // event through and the viewer decides below (G2-14).
    resolvePublicEvent(deps, { suspended: 'visible' }),
    asyncHandler(async (req, res) => {
      const event = publicEventOf(req)

      // Who turned up, in the use case's vocabulary (HTTP-H-02): the one answer to "who is this" for
      // a route with a public caller. It also answers the public and a guest as for an event that is
      // not there when the client is suspended, and a moderator still reads (roadmap §10.7; G2-14).
      const identified = await usecases.identifyMediaViewer({
        event,
        guestToken: guestTokenOf(req),
        userId: req.context.user?.userId,
      })
      if (!identified.ok) return sendError(res, identified.error)
      const viewer = identified.value

      // Parsed only now: a malformed id or variant is a 400 for an event that serves, and must not
      // be what tells a suspended client's slug from an unknown one (G2-14).
      const params = photoVariantParams.parse(req.params)

      /**
       * **One call, and it opens nothing.**
       *
       * The use case answers with the object's metadata and a function that opens its
       * bytes, so the size a `Range` header is judged against costs a `stat` rather than
       * an open file. The previous shape asked twice — once for the whole object purely
       * to learn its size, then again for the part — and the first stream was discarded
       * unread. `openRead` opens the descriptor when the stream is constructed, so every
       * seek in a clip and every `416` leaked one, guest-reachable, until `EMFILE`.
       *
       * The alternative considered and rejected: pass a range the handler has not
       * checked and let the store answer `null`. That cannot tell "outside the object"
       * from "the file is gone", and those are a `416` and a `404`.
       */
      const media = await usecases.getPhotoMedia({
        eventId: event.id,
        photoId: asPhotoId(params.photoId),
        variant: params.variant,
        viewer,
      })
      if (!media.ok) return sendError(res, media.error)

      // **On every answer this route can give, the `416`'s JSON body included.** The
      // stored bytes are always re-encoded, but a browser that sniffs its way to
      // something executable is how an upload becomes stored XSS — and the refusal that
      // bypasses `sendMedia` was the one response going out without it.
      res.setHeader('X-Content-Type-Options', 'nosniff')

      const verdict = parseByteRange(req.get('range'), media.value.byteSize)
      if (verdict.kind === 'whole') return sendMedia(req, res, media.value, null)

      if (verdict.kind === 'unsatisfiable') {
        /**
         * **416, written here rather than through the kind table.**
         *
         * `DomainErrorKind` has no member for it and should not grow one: it is a
         * property of this one representation and of the header that asked for it, not a
         * class of business failure — and the taxonomy's value is that it is small
         * enough to hold in your head. This is the same call `streamRoutes` makes when it
         * answers `503` for an error whose kind maps to `500`.
         *
         * The `Content-Range` is what lets a player correct itself instead of retrying
         * the same impossible range for the rest of the evening.
         */
        res.setHeader('Accept-Ranges', 'bytes')
        res.setHeader('Content-Range', unsatisfiedRange(media.value.byteSize))
        return res.status(416).json(errorBody(DomainError.invalid('photo.rangeNotSatisfiable')))
      }

      return sendMedia(req, res, media.value, verdict.range)
    }),
  )

  /** The whole album as a ZIP. Moderator or above, and streamed. */
  router.get(
    '/events/:eventSlug/album.zip',
    requireRole('moderator', deps),
    asyncHandler(async (req, res) => {
      const event = publicEventOf(req)

      // Nothing is written to the response until the use case has answered: once
      // `Content-Disposition: attachment` is on the wire the client is saving a file, and
      // a refusal after that point is a download of an error page named `-album.zip`.
      const result = await usecases.exportAlbum({ eventId: event.id })
      if (!result.ok) return sendError(res, result.error)

      res.setHeader('Content-Type', 'application/zip')
      // The name comes from the resolved event, never from the path, so the download
      // cannot be called something the wall and the printed card do not. It is a
      // validated `Slug`, so it carries neither a quote nor a CRLF into this header, and
      // nothing guest-supplied reaches the filename, here or inside the archive.
      res.setHeader('Content-Disposition', `attachment; filename="${event.slug.value}-album.zip"`)
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
