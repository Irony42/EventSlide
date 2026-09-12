import { Router, type Request, type RequestHandler, type Response } from 'express'
import multer from 'multer'
import type { Event } from '../../../domain/events/event'
import type { Guest } from '../../../domain/guests/guest'
import type { Photo, PhotoActor } from '../../../domain/photos/photo'
import { DomainError } from '../../../domain/shared/errors'
import { asPhotoId } from '../../../domain/shared/ids'
import { asyncHandler } from '../middleware/asyncHandler'
import { GUEST_COOKIE, requireGuest } from '../middleware/authz'
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
 *
 * One path is shared with the host surface: `DELETE /events/:eventSlug/photos/:photoId`
 * is a guest taking back their own photo *and* a moderator removing any photo, in both
 * sections of docs/API.md. `server.ts` mounts this router first, so that route defers —
 * see {@link declineWithoutGuestToken}.
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
  /**
   * The aggregate byte bound, overridable so a test can reach it in bytes rather than
   * in hundreds of megabytes. Same arrangement as `streamConnectionLimiter`'s two
   * ceilings, and for the same reason. Production leaves it alone.
   */
  readonly maxUploadBytesPerRequest?: number
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

/**
 * How many bytes **one request** may hold in the heap, across every file in it.
 *
 * This is the number multer does not have. `limits.fileSize` bounds one file and
 * `limits.files` bounds the count; nothing bounds the product, and the product is what
 * a single request can buffer — 20 x 25 MB = 500 MB at the defaults, into a container
 * `compose.yaml` gives 1 GB, with `sharp` still to decode each accepted image into
 * three variants on top of it. The upload limiter does not cover this: it bounds
 * requests per minute, and twelve of these can be in flight at once.
 *
 * 150 MB leaves the guest flow untouched and the arithmetic honest. A phone photo is
 * 2-5 MB, so the twenty the picker allows are 40-100 MB — a real batch off a real
 * phone stays inside this, and what does not is a batch nobody assembled by hand. On
 * the other side, one request now costs the container 150 MB of buffers rather than
 * 500 MB, which is what makes the memory limit in `compose.yaml` a number an operator
 * can reason about instead of a hope.
 *
 * It is a constant rather than configuration because `HttpConfig` is the slice of
 * settings the HTTP layer is given, and widening it reaches `src/interface/http/types.ts`
 * and `src/main/container.ts`. The relationship an operator does need — that raising
 * `MAX_UPLOAD_BYTES` past this raises what one request may hold — is written in
 * `.env.example` and in `compose.yaml`.
 */
const MAX_UPLOAD_BYTES_PER_REQUEST = 150_000_000

/**
 * `multer.memoryStorage()`, plus the one thing it does not count.
 *
 * The bound is checked **while the stream is read**, which is the whole point: summing
 * `req.files` afterwards would answer 413 about 500 MB the process had already
 * allocated, and a limit that reports an exhaustion it did not prevent is documentation
 * with a status code. Here the total is carried across the files of one request, so the
 * request is cut off at the byte that crosses the line and multer drains the rest
 * without buffering it.
 *
 * The refusal is a `DomainError`, so it leaves by the same door as every other failure:
 * `errorHandler` recognises it before it reaches the opaque 500, `quotaExceeded` maps
 * to **413**, and `upload.tooLarge` is a code `web/src/lib/i18n/fr.ts` already answers
 * in French. A guest gets a sentence, not a dropped connection.
 *
 * The running total is kept in a `WeakMap` keyed by the request rather than as a
 * property on it: `req` carries `RequestContext` and nothing else this layer invented,
 * and the entry dies with the request either way.
 */
const boundedMemoryStorage = (maxBytesPerRequest: number): multer.StorageEngine => {
  const spent = new WeakMap<Request, number>()

  return {
    _handleFile(req, file, callback) {
      const chunks: Buffer[] = []
      let size = 0
      // Multer requires exactly one callback per file. A file aborted here still
      // reaches `end` as multer drains what is left of the request.
      let settled = false

      file.stream.on('data', (chunk: Buffer) => {
        if (settled) return

        const total = (spent.get(req) ?? 0) + chunk.length
        if (total > maxBytesPerRequest) {
          settled = true
          callback(DomainError.quotaExceeded('upload.tooLarge', { max: maxBytesPerRequest }))
          return
        }

        spent.set(req, total)
        size += chunk.length
        chunks.push(chunk)
      })

      file.stream.on('end', () => {
        if (settled) return
        settled = true
        callback(null, { buffer: Buffer.concat(chunks, size), size })
      })

      // No `error` listener: multer registers its own on this stream before calling
      // the engine, and it both aborts the request and settles the pending write. A
      // second one here would race it to a callback multer may only receive once.
    },

    _removeFile(_req, file, callback) {
      // Multer calls this for every file already read when a later one aborts the
      // request. There is nothing to unlink — dropping the reference is the whole of
      // freeing a file that only ever existed as a Buffer, and doing it now rather
      // than at the next collection is the point of bounding this at all.
      ;(file as { buffer?: Buffer | undefined }).buffer = undefined
      callback(null)
    },
  }
}

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

/**
 * Hands the request to the next router when no guest device token was presented.
 *
 * `DELETE /events/:eventSlug/photos/:photoId` is two endpoints on one path: section 3 of
 * docs/API.md gives it to a guest for their own photo, section 6 gives it to a moderator
 * for any photo. `server.ts` mounts this router before `moderationRoutes`, and
 * `requireGuest` answers 401 rather than calling `next()` — so without this the
 * moderator's handler was unreachable on the assembled server and "delete any photo"
 * was a dead endpoint.
 *
 * `next('router')` leaves this router rather than skipping one handler, which is the
 * only way the next `/api` router gets a chance to match. The test for it lives in
 * `guestRoutes.test.ts`, behind the real `requireRole`.
 *
 * It keys on the **cookie**, not on a session, and that direction matters: a host who
 * also joined their own event as a guest must keep the guest path, since deferring on
 * the presence of a session would send a legitimate guest at somebody else's event into
 * `requireRole` and answer 404. A caller with neither credential is refused by
 * `requireRole` with the same `401 auth.required` this router used to send.
 */
const declineWithoutGuestToken: RequestHandler = (req, _res, next) => {
  const raw = req.cookies?.[GUEST_COOKIE]
  if (typeof raw !== 'string' || raw.length === 0) {
    next('router')
    return
  }
  next()
}

const actorFor = (guest: Guest): PhotoActor => ({ kind: 'guest', guestId: guest.id })

/**
 * Whether this guest may still take their own photo back.
 *
 * `Photo.canBeDeletedBy` is the rule — their own photo, not yet on the wall, inside the
 * grace window — and the event's switch is the host's veto over the whole feature.
 * Neither condition is restated: each is read from the entity that owns it.
 *
 * The **conjunction**, though, is a second copy of the one `deletePhoto` makes, and the
 * two must agree or the DTO promises a button the server then refuses. Only a test holds
 * them together today ("reports canDelete false for every photo when the host turned
 * self-deletion off", which asserts the flag and the subsequent 403 in one case).
 * Single-sourcing it means one predicate in `src/domain/photos` that `deletePhoto` also
 * calls, which is an application-layer change and not this module's to make.
 */
const canGuestDelete = (event: Event, photo: Photo, guest: Guest, now: Date): boolean =>
  event.settings.allowGuestSelfDelete &&
  photo.canBeDeletedBy(actorFor(guest), now, event.settings.guestSelfDeleteGraceMs)

export const guestRoutes = ({
  deps,
  usecases,
  maxUploadBytesPerRequest = MAX_UPLOAD_BYTES_PER_REQUEST,
}: GuestRouteDeps): Router => {
  const router = Router()

  /**
   * The aggregate bound, never smaller than the one file the operator said was fine.
   *
   * `MAX_UPLOAD_BYTES` is an explicit statement that a file of that size is acceptable,
   * so a per-request ceiling below it would be a configuration arguing with itself: the
   * guest would be refused at a size the same operator had just permitted, and no
   * combination of settings could send one photo. Taking the larger of the two keeps
   * the bound meaningful — the worst case is `max(150 MB, MAX_UPLOAD_BYTES)` and never
   * the `MAX_UPLOAD_BYTES x MAX_FILES_PER_UPLOAD` product again — while leaving the
   * only lever that can raise it the one `.env.example` ties to the memory limit.
   */
  const perRequestBytes = Math.max(maxUploadBytesPerRequest, deps.config.uploads.maxBytes)

  /**
   * Memory, not a temp file.
   *
   * The ingest pipeline re-encodes every byte it accepts, so a disk-backed upload would
   * write a file and read it straight back for nothing — and then need cleanup on every
   * exit path, which is where 1.0 leaked. What that choice costs is heap, and the three
   * limits below are what bound it: `fileSize` per file, `files` by count, and
   * {@link boundedMemoryStorage} across the request, which is the one multer has no
   * setting for. multer's own limit errors are already translated by the error handler.
   *
   * Deliberately **no `fileFilter`**. It could only inspect `file.mimetype`, which is a
   * string the client chose; trusting it is the exact 1.0 defect. The format is
   * identified from the bytes, by the use case, from the header.
   */
  const uploads = multer({
    storage: boundedMemoryStorage(perRequestBytes),
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
      // Absent when the request was not multipart at all, which to a guest is the same
      // thing as an empty picker.
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
        // `declaredName` travels as metadata only, never as a path: the media store
        // addresses bytes by `(eventId, contentHash, variant)` and never sees a
        // client-chosen name. 1.0 built its storage path out of one.
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
   *
   * The shared path: without a guest cookie this defers to `moderationRoutes`, which
   * owns the same `DELETE` for a moderator.
   */
  router.delete(
    '/events/:eventSlug/photos/:photoId',
    declineWithoutGuestToken,
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
