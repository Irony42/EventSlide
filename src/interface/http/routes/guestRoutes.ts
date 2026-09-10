import { Router, type Request, type RequestHandler, type Response } from 'express'
import multer from 'multer'
import type { Event } from '../../../domain/events/event'
import type { Guest } from '../../../domain/guests/guest'
import type { Photo, PhotoActor } from '../../../domain/photos/photo'
import { DomainError } from '../../../domain/shared/errors'
import { asPhotoId } from '../../../domain/shared/ids'
import { asyncHandler } from '../middleware/asyncHandler'
import { requireGuest } from '../middleware/authz'
import { reactionLimiter, uploadLimiter } from '../middleware/rateLimit'
import { toGuestPhotoDto, toReactionsDto, toUploadResponseDto } from '../presenters/presenters'
import { sendError, sendJson, sendResult, sendResultNoContent } from '../presenters/send'
import {
  captionBody,
  photoParams,
  reactionBody,
  reactionParams,
  uploadFields,
} from '../schemas/requestSchemas'
import type { HttpDeps } from '../types'
import type { HttpUseCases } from '../useCases'

/**
 * The guest surface: a phone, one thumb, and a venue's Wi-Fi.
 *
 * Every route here is gated by `requireGuest`, which resolves the HMAC device token
 * **against the event in the path** — the cross-event attack (a guest at one wedding
 * pointing their own cookie at another event's upload endpoint) is refused there, not
 * here. Because it also resolves the event, no handler re-reads `:eventSlug`: the slug
 * is already parsed by `Slug.create` and turned into an `Event`, so a handler parses
 * only the parts of the request it reads itself.
 *
 * A photo belonging to another event answers **404**, and that is not an accident of
 * implementation: every use case below takes the event id from `req.context.event` and
 * the repository has no `findById(photoId)` at all, so the wrong event genuinely
 * misses. A 403 would confirm the photo exists and turn this into an enumeration
 * oracle over other people's evenings.
 */

/**
 * What this module needs from the application, and nothing more.
 *
 * A `Pick` rather than the whole `HttpUseCases`, for the same reason `HttpUseCases`
 * exists rather than an import from the container: the module states its requirements
 * and the caller proves it satisfies them. `RouteDeps` is assignable to this, so
 * `server.ts` passes its bag unchanged — and a test can build seven use cases instead
 * of thirty.
 */
export interface GuestRouteDeps {
  readonly deps: HttpDeps
  readonly usecases: Pick<
    HttpUseCases,
    | 'uploadPhotos'
    | 'listGuestPhotos'
    | 'deletePhoto'
    | 'setPhotoCaption'
    | 'reactToPhoto'
    | 'withdrawReaction'
    | 'getPhotoReactions'
  >
}

/** The multipart field name. Anything else is `LIMIT_UNEXPECTED_FILE` from multer. */
const PHOTOS_FIELD = 'photos'

/**
 * A ceiling on text parts, not a schema.
 *
 * `uploadFields` reads exactly one (`caption`) and is `.strict()`, so extras are a 400
 * either way — but the schema only runs once the whole body has been buffered, and a
 * client streaming a hundred thousand tiny fields would exhaust memory before it got a
 * chance. This stops that at the parser.
 */
const MAX_TEXT_FIELDS = 4

/** Both are populated by `requireGuest`. Narrowed once, in {@link withGuest}. */
interface GuestScope {
  readonly event: Event
  readonly guest: Guest
}

type GuestHandler = (scope: GuestScope, req: Request, res: Response) => Promise<void>

/**
 * `asyncHandler` plus the one narrowing every handler here would otherwise repeat.
 *
 * The 401 is unreachable behind `requireGuest` — it means the middleware did not run,
 * which is a wiring bug. It fails closed rather than asserting non-null: a `!` here
 * would turn that bug into a `TypeError` on a guest's phone mid-upload, and Express 4
 * would answer 500 after the fact. Exported so its guard can be exercised without a
 * route in front of it.
 */
export const withGuest = (handler: GuestHandler): RequestHandler =>
  asyncHandler(async (req, res) => {
    const { event, guest } = req.context
    if (event === undefined || guest === undefined) {
      sendError(res, DomainError.unauthenticated('auth.required'))
      return
    }
    await handler({ event, guest: guest.guest }, req, res)
  })

const actorFor = (guest: Guest): PhotoActor => ({ kind: 'guest', guestId: guest.id })

/**
 * Whether this guest may still take their own photo back.
 *
 * `Photo.canBeDeletedBy` is the rule — their own photo, not yet on the wall, inside the
 * grace window — and the event's switch is the host's veto over the whole feature. Both
 * are asked here, in the same order `deletePhoto` asks them, because the two answers
 * must agree: a `canDelete: true` that DELETE then refuses is precisely the enabled
 * button the field exists to prevent. Neither condition is restated; each is read from
 * the entity that owns it.
 */
const canGuestDelete = (event: Event, photo: Photo, guest: Guest, now: Date): boolean =>
  event.settings.allowGuestSelfDelete &&
  photo.canBeDeletedBy(actorFor(guest), now, event.settings.guestSelfDeleteGraceMs)

export const guestRoutes = ({ deps, usecases }: GuestRouteDeps): Router => {
  const router = Router()

  /**
   * Memory, not a temp file.
   *
   * The ingest pipeline re-encodes every byte it accepts, so a disk-backed upload would
   * write a file and read it straight back for nothing — and then need cleanup on every
   * exit path, which is where 1.0 leaked. `fileSize` is what bounds the memory this
   * costs, and multer's own limit errors are already translated by the error handler.
   *
   * Deliberately **no `fileFilter`**. It could only inspect `file.mimetype`, which is a
   * string the client chose; trusting it is the exact 1.0 defect. The format is
   * identified from the bytes, by the use case, from the header.
   */
  const uploads = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: deps.config.uploads.maxBytes,
      files: deps.config.uploads.maxFiles,
      fields: MAX_TEXT_FIELDS,
    },
  })

  /**
   * The upload. The only public write in the product.
   *
   * The rate limiter runs before authorization on purpose: a flood must be dropped
   * before it costs a token verification and two repository reads.
   *
   * **201 with a per-file outcome array**, never one opaque error for the batch. A guest
   * who selected five photos and one screenshot of a PDF is told which one was refused
   * and why; 1.0 failed the whole request, and the guest re-picked six files on venue
   * Wi-Fi.
   */
  router.post(
    '/events/:eventSlug/photos',
    uploadLimiter(deps.config.rateLimits.uploadPerMinute),
    requireGuest(deps),
    uploads.array(PHOTOS_FIELD),
    withGuest(async ({ event, guest }, req, res) => {
      // `req.files` is an array for `.array()`, and absent when the request was not
      // multipart at all. Both mean the same thing to a guest: nothing was sent.
      const files = Array.isArray(req.files) ? req.files : []
      if (files.length === 0) {
        // The contract makes `photos` a required part (1..maxFilesPerUpload). Answering
        // 201 with an empty result array would tell a guest whose picker silently
        // failed that their upload worked.
        sendError(res, DomainError.invalid('upload.noFiles'))
        return
      }

      const fields = uploadFields.parse(req.body)

      const result = await usecases.uploadPhotos({
        eventId: event.id,
        author: { kind: 'guest', guestId: guest.id },
        // `declaredName` travels as metadata and is echoed back, never as a path: the
        // media store addresses bytes by `(eventId, contentHash, variant)` and never
        // sees a client-chosen name. 1.0 built its path out of one.
        files: files.map((file) => ({ bytes: file.buffer, declaredName: file.originalname })),
        // Conditional rather than `caption: fields.caption`: under
        // `exactOptionalPropertyTypes` an absent field and an explicit `null` are
        // different intents, and only the second means "clear it".
        ...(fields.caption === undefined ? {} : { caption: fields.caption }),
      })

      sendResult(res, result, (response, value) => {
        sendJson(response, toUploadResponseDto(value), 201)
      })
    }),
  )

  /**
   * "Mes photos" — this guest's own photos, **whatever the host decided**.
   *
   * Deliberately unfiltered by status. Being shown that a photo is awaiting moderation
   * beats wondering whether the upload worked: a guest who cannot tell sends it again,
   * and the host moderates it twice.
   */
  router.get(
    '/events/:eventSlug/photos/mine',
    requireGuest(deps),
    withGuest(async ({ event, guest }, _req, res) => {
      const result = await usecases.listGuestPhotos({ eventId: event.id, guestId: guest.id })

      sendResult(res, result, (response, page) => {
        const now = deps.clock.now()
        // Never cached. This is the one view a guest reloads to find out whether their
        // photo got through, and a proxy or a back-button serving it from a store would
        // show them the answer from before the host published it.
        response.setHeader('Cache-Control', 'no-store')
        sendJson(response, {
          items: page.items.map((photo) =>
            toGuestPhotoDto({
              photo,
              slug: event.slug.value,
              canDelete: canGuestDelete(event, photo, guest, now),
            }),
          ),
        })
      })
    }),
  )

  /**
   * A guest taking back a photo they regret.
   *
   * The rules — their own photo, still off the wall, inside the window, and only if the
   * host allows self-deletion at all — belong to `Photo.canBeDeletedBy` and the use
   * case. Pulling a photo off the wall mid-slideshow is the host's call, so a published
   * photo is refused here and moderated there.
   */
  router.delete(
    '/events/:eventSlug/photos/:photoId',
    requireGuest(deps),
    withGuest(async ({ event, guest }, req, res) => {
      const params = photoParams.parse(req.params)

      const result = await usecases.deletePhoto({
        eventId: event.id,
        photoId: asPhotoId(params.photoId),
        actor: actorFor(guest),
      })

      sendResultNoContent(res, result)
    }),
  )

  /** The line projected under the photo. `null` clears it. */
  router.patch(
    '/events/:eventSlug/photos/:photoId/caption',
    requireGuest(deps),
    withGuest(async ({ event, guest }, req, res) => {
      const params = photoParams.parse(req.params)
      const body = captionBody.parse(req.body)

      const result = await usecases.setPhotoCaption({
        eventId: event.id,
        photoId: asPhotoId(params.photoId),
        actor: actorFor(guest),
        caption: body.caption,
      })

      sendResultNoContent(res, result)
    }),
  )

  /**
   * A badge tapped while the photo is on the wall.
   *
   * The limiter is the coarse control — a flood per IP and per event, dropped before it
   * reaches a use case — and the domain's per-guest budget is the fine one. Both exist
   * because each reaction fans out to every browser holding the wall open.
   */
  router.post(
    '/events/:eventSlug/photos/:photoId/reactions',
    reactionLimiter(deps.config.rateLimits.reactionPerMinute),
    requireGuest(deps),
    withGuest(async ({ event, guest }, req, res) => {
      const params = photoParams.parse(req.params)
      const body = reactionBody.parse(req.body)

      const result = await usecases.reactToPhoto({
        eventId: event.id,
        photoId: asPhotoId(params.photoId),
        guestId: guest.id,
        kind: body.kind,
      })

      sendResultNoContent(res, result)
    }),
  )

  /**
   * Withdrawing one's own reaction.
   *
   * "Only their own" is a property of the lookup, not a check: the row is addressed by
   * `(eventId, photoId, guestId, kind)`, so another guest's reaction is not forbidden —
   * it is simply not there, and the caller learns nothing about whether it exists.
   */
  router.delete(
    '/events/:eventSlug/photos/:photoId/reactions/:kind',
    requireGuest(deps),
    withGuest(async ({ event, guest }, req, res) => {
      const params = reactionParams.parse(req.params)

      const result = await usecases.withdrawReaction({
        eventId: event.id,
        photoId: asPhotoId(params.photoId),
        guestId: guest.id,
        kind: params.kind,
      })

      sendResultNoContent(res, result)
    }),
  )

  /**
   * The counts under one photo, plus which of them this phone already sent.
   *
   * Every kind is always present and zeroed — the domain's `tally` guarantees it — so
   * the client never renders `NaN` for a kind nobody tapped.
   */
  router.get(
    '/events/:eventSlug/photos/:photoId/reactions',
    requireGuest(deps),
    withGuest(async ({ event, guest }, req, res) => {
      const params = photoParams.parse(req.params)

      const result = await usecases.getPhotoReactions({
        eventId: event.id,
        photoId: asPhotoId(params.photoId),
        guestId: guest.id,
      })

      sendResult(res, result, (response, view) => {
        // A count is stale the instant it is read; the wall and the phone both recount
        // on the next SSE signal.
        response.setHeader('Cache-Control', 'no-store')
        sendJson(response, toReactionsDto(view))
      })
    }),
  )

  return router
}
