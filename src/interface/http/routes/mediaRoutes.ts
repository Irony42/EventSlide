import { Router } from 'express'
import type { PhotoMedia } from '../../../application/usecases/photos/getPhotoMedia'
import { DomainError } from '../../../domain/shared/errors'
import { ContentHash } from '../../../domain/photos/contentHash'
import { asPhotoId } from '../../../domain/shared/ids'
import { Slug } from '../../../domain/shared/slug'
import { asyncHandler } from '../middleware/asyncHandler'
import { guestTokenOf, requireRole, resolvePublicEvent } from '../middleware/authz'
import { publicEventOf } from '../middleware/scope'
import { sendError } from '../presenters/send'
import { serveRanged, streamOrAbandon, type RangedHeaders } from '../presenters/serveRanged'
import { photoVariantParams, venuePhotoDigest } from '../schemas/requestSchemas'
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
  readonly usecases: Pick<
    HttpUseCases,
    | 'exportAlbum'
    | 'getPhotoMedia'
    | 'getVenuePhotoMedia'
    | 'getEventLogoMedia'
    | 'identifyMediaViewer'
  >
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
 * The representation headers of a stored photo, clip or published file: inline (the wall, the
 * moderation grid and the guest's own view render these in an `<img>` or a `<video>`, never as
 * a download), cached for a year under the content-addressed ETag.
 */
const mediaHeaders = (media: Pick<PhotoMedia, 'contentType'>, etag: string): RangedHeaders => ({
  contentType: media.contentType,
  cacheControl: IMMUTABLE_CACHE,
  contentDisposition: 'inline',
  etag,
  failureMessage: 'photo media failed mid-stream',
})

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

      return serveRanged(req, res, media.value, mediaHeaders(media.value, etagFor(media.value)))
    }),
  )

  /**
   * One public file an event's settings name, served by digest: the host's own photograph of their
   * venue (ADR 0010, decision 8) and the host's logo (spec 03). They differ only in the route, the
   * use case, the 404 code and the ETag's suffix.
   *
   * Not behind `resolvePublicEvent`, which refuses a draft: the host sets the look of an event
   * before it opens and has to be able to see what they uploaded. The event is read here and the
   * rule is the use case's: the public and a guest only while the event serves its wall, a
   * moderator at any time, and only for the digest the event's settings name right now.
   *
   * **Every refusal is the same 404** for the route's code, an unknown slug and a malformed digest
   * included, so the route cannot be used to ask which events exist or which digests they once held.
   */
  const servePublishedFile = (
    path: string,
    notFoundCode: string,
    getMedia: typeof usecases.getVenuePhotoMedia,
    etagSuffix: string,
  ): void => {
    router.get(
      path,
      asyncHandler(async (req, res) => {
        const refuse = (): void => sendError(res, DomainError.notFound(notFoundCode))

        const slug = Slug.create(req.params['eventSlug'])
        const digest = venuePhotoDigest.safeParse(req.params['hash'])
        const hash = digest.success ? ContentHash.create(digest.data) : null
        if (!slug.ok || hash === null || !hash.ok) return refuse()

        const event = await deps.events.findBySlug(slug.value)
        if (event === null) return refuse()

        const identified = await usecases.identifyMediaViewer({
          event,
          guestToken: guestTokenOf(req),
          userId: req.context.user?.userId,
        })
        if (!identified.ok) return refuse()

        const media = await getMedia({
          event,
          hash: hash.value,
          viewer: identified.value,
        })
        if (!media.ok) return sendError(res, media.error)

        res.setHeader('X-Content-Type-Options', 'nosniff')

        const etag = `"${media.value.contentHash.value}-${etagSuffix}"`
        return serveRanged(req, res, media.value, mediaHeaders(media.value, etag))
      }),
    )
  }

  servePublishedFile(
    '/events/:eventSlug/venue-photo/:hash',
    'venuePhoto.notFound',
    usecases.getVenuePhotoMedia,
    'ground',
  )
  servePublishedFile(
    '/events/:eventSlug/logo/:hash',
    'logo.notFound',
    usecases.getEventLogoMedia,
    'logo',
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
