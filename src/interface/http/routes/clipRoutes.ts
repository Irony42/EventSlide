import { Router, type Request, type RequestHandler } from 'express'
import { rm } from 'node:fs/promises'
import { readFile } from 'node:fs/promises'
import multer from 'multer'
import { join, resolve } from 'node:path'
import { DomainError } from '../../../domain/shared/errors'
import { asClipJobId } from '../../../domain/shared/ids'
import { requireGuest } from '../middleware/authz'
import { withGuest } from '../middleware/scope'
import { createDiskSpaceGuard } from '../middleware/diskSpaceGuard'
import { uploadConcurrencyLimiter, uploadLimiter } from '../middleware/rateLimit'
import { toClipJobDto } from '../presenters/presenters'
import { sendError, sendJson, sendResult } from '../presenters/send'
import { clipJobParams, clipUploadFields } from '../schemas/requestSchemas'
import type { HttpDeps } from '../types'
import type { HttpUseCases } from '../useCases'

/**
 * Short video clips: **a separate route, a separate multer, a separate byte limit.**
 *
 * None of that is incidental. `guestRoutes.ts` derives the heap a single photo request
 * may hold from `MAX_UPLOAD_BYTES`, and `compose.yaml`'s memory limit was reasoned
 * against that number — so raising the photo limit to admit a 60 MB clip would silently
 * raise a ceiling somebody else calculated. A clip gets its own number instead, and its
 * bytes go to **disk** rather than the heap, because the request that carries them is
 * slow by nature: a phone pushing sixty megabytes over venue Wi-Fi holds the connection
 * for a minute, and a dozen of those must not be a dozen buffers in memory for its
 * duration.
 *
 * The response is **202, not 201**. Nothing has been created that a moderator can see: a
 * clip that is still transcoding has no `photos` row at all, which is what makes a
 * half-encoded clip on the projector unrepresentable rather than filtered. What the guest
 * gets back is the job to watch and the id of the row it will become.
 */

export interface ClipRouteDeps {
  readonly deps: HttpDeps
  readonly usecases: Pick<HttpUseCases, 'uploadClip' | 'getClipJob'>
  /** Where multer writes the upload before it is staged. Under `MEDIA_ROOT`. */
  readonly uploadTempDir: string
  readonly maxClipBytes: number
  /**
   * The same bucket the photo upload uses, which is why it is passed in rather than
   * built here: express-rate-limit mints a store per instance, so a second call would be
   * a second, independent allowance under one configuration key.
   *
   * Optional only so a test can mount this router alone; production passes it.
   */
  readonly uploadRateLimiter?: RequestHandler
  /**
   * The upload concurrency semaphore (G3-06 / P4-10), **shared with the photo route**
   * for the same reason `uploadRateLimiter` is: a guest sending a photo and a clip at
   * once is one guest, and a slot held by each independently would double the real
   * ceiling `MAX_CONCURRENT_UPLOAD_REQUESTS` names.
   *
   * Optional only so a test can mount this router alone; production passes it.
   */
  readonly uploadConcurrencyLimiter?: RequestHandler
  /**
   * The free-disk-space guard (G3-06 / P4-10). Built from `deps` when absent — see
   * `guestRoutes.ts` for why that default costs nothing shared with the photo route.
   */
  readonly diskSpaceGuard?: RequestHandler
}

/** The multipart field name. Anything else is `LIMIT_UNEXPECTED_FILE` from multer. */
const CLIP_FIELD = 'clip'

/** A ceiling on text parts, for the reason `guestRoutes` has one: the parser, not zod. */
const MAX_TEXT_FIELDS = 4

/**
 * Removes the temp file multer wrote, on **every** exit path of a clip handler: the happy
 * one, the refusal, the thrown error. Disk storage means every exit owns a file, and
 * "cleanup on every exit path" is exactly what 1.0 leaked. `withGuest` runs this in its
 * `finally`, and the read route shares it rather than repeating the narrowing.
 */
const removeUploadedFile = async (req: Request): Promise<void> => {
  if (req.file === undefined) return
  await rm(req.file.path, { force: true }).catch(() => {
    // A leaked temp file is removed at the next boot, when the composition root empties
    // MEDIA_ROOT/.uploads; failing a guest's clip over the cleanup would be worse.
  })
}
const clipGuest = { cleanup: removeUploadedFile }

export const clipRoutes = ({
  deps,
  usecases,
  uploadTempDir,
  maxClipBytes,
  uploadRateLimiter = uploadLimiter(deps.config.rateLimits.uploadPerMinute),
  uploadConcurrencyLimiter: concurrencyLimiter = uploadConcurrencyLimiter(
    deps.config.uploads.maxConcurrentRequests,
  ),
  diskSpaceGuard = createDiskSpaceGuard({
    checker: deps.diskSpaceChecker,
    paths: deps.config.storage.diskSpacePaths,
    minFreeBytes: deps.config.storage.minFreeDiskBytes,
  }),
}: ClipRouteDeps): Router => {
  const router = Router()

  /**
   * Disk, not memory, and not `os.tmpdir()`.
   *
   * The container runs `read_only: true` with a small tmpfs charged to the same memory
   * cgroup as the process, so a clip written to `/tmp` is a clip written to the memory
   * budget — the one thing disk storage was chosen to avoid. This directory is under
   * `MEDIA_ROOT`, which is the volume the operator already gave the container.
   *
   * Deliberately **no `fileFilter`**: it could only read `file.mimetype`, which is a
   * string the client chose, and trusting it is the 1.0 defect. The container is
   * identified from the bytes, by the use case, from the signature.
   */
  const uploads = multer({
    storage: multer.diskStorage({ destination: resolve(uploadTempDir) }),
    limits: { fileSize: maxClipBytes, files: 1, fields: MAX_TEXT_FIELDS },
  })

  /**
   * Send a clip.
   *
   * The limiter runs before authorization for the same reason it does on the photo path:
   * a flood must be dropped before it costs a token verification and two repository
   * reads. It is the *same instance* the photo route uses, handed to both by `server.ts` —
   * a guest sending clips and photos at once is one guest, and two buckets would have
   * been twice the documented allowance. The upload concurrency semaphore and the
   * free-disk-space guard (G3-06 / P4-10) run next, cheapest-first and ahead of
   * `requireGuest` and the multipart parser, for the same reason.
   */
  router.post(
    '/events/:eventSlug/clips',
    uploadRateLimiter,
    concurrencyLimiter,
    diskSpaceGuard,
    requireGuest(deps),
    uploads.single(CLIP_FIELD),
    withGuest(async ({ event, guest }, req, res) => {
      const file = req.file
      if (file === undefined) {
        // Absent when the request was not multipart at all, which to a guest is the same
        // thing as an empty picker.
        sendError(res, DomainError.invalid('upload.noFiles'))
        return
      }

      const fields = clipUploadFields.parse(req.body)

      /**
       * Read once, and **viewed rather than copied**.
       *
       * The upload itself streamed to disk, which is what kept it off the heap for the
       * minute it took to arrive; the pipeline behind this is bytes-in and bytes-out, so
       * one buffer of at most `MAX_CLIP_BYTES` is the floor either way. What is not the
       * floor is two: `new Uint8Array(buffer)` **copies**, and both halves stay live for
       * the length of the request — 160 MB per upload in flight at the default limit,
       * against a container given 1 GB, with a limiter that bounds requests per minute
       * rather than concurrency.
       *
       * A `Buffer` is already a `Uint8Array` over an `ArrayBuffer`; this names the same
       * bytes. The offset and length are passed explicitly because a small read can come
       * from Node's shared pool, where the buffer is a window onto a larger allocation
       * and `.buffer` alone would hand on the whole pool.
       */
      const read = await readFile(file.path)
      const bytes = new Uint8Array(read.buffer, read.byteOffset, read.byteLength)

      // **Removed before the use case runs, not after the response goes out.** The
      // `finally` below is the backstop for the paths that never reach this line; doing
      // it here as well means the temp file is gone before anything that could fail, and
      // before any byte of the response — so there is no window in which a crash, or a
      // client that hangs up, leaves it behind.
      await rm(file.path, { force: true })

      const result = await usecases.uploadClip({
        eventId: event.id,
        author: { kind: 'guest', guestId: guest.id },
        file: {
          bytes,
          // Metadata only. It never becomes a path: the media store addresses bytes by
          // `(eventId, contentHash, variant)` and never sees a client-chosen name.
          declaredName: file.originalname,
        },
        ...(fields.caption === undefined ? {} : { caption: fields.caption }),
      })

      sendResult(res, result, (response, value) => {
        // 202: accepted, and nothing exists yet that a moderator could act on.
        sendJson(response, toClipJobDto(value), 202)
      })
    }, clipGuest),
  )

  /**
   * "Where is my clip?"
   *
   * The window this design creates is real — a clip is queued, then transcoded, and for
   * those seconds `GET /photos/mine` has nothing to show. A guest who cannot tell sends
   * it again, and the host moderates it twice.
   *
   * Never cached: this is the one view whose whole purpose is to change.
   */
  router.get(
    '/events/:eventSlug/clips/:clipJobId',
    requireGuest(deps),
    withGuest(async ({ event, guest }, req, res) => {
      const params = clipJobParams.parse(req.params)

      const result = await usecases.getClipJob({
        eventId: event.id,
        clipJobId: asClipJobId(params.clipJobId),
        actor: { kind: 'guest', guestId: guest.id },
      })

      sendResult(res, result, (response, view) => {
        response.setHeader('Cache-Control', 'no-store')
        sendJson(response, toClipJobDto(view))
      })
    }, clipGuest),
  )

  return router
}

/** Exported so the composition root can name the same directory multer writes into. */
export const clipUploadTempDir = (mediaRoot: string): string => join(mediaRoot, '.uploads')
