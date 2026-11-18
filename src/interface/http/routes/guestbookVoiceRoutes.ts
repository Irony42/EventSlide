import { Router, type Request, type RequestHandler } from 'express'
import multer from 'multer'
import { resolve } from 'node:path'
import { DomainError } from '../../../domain/shared/errors'
import { asGuestbookEntryId } from '../../../domain/shared/ids'
import type { StagedUploadStore } from '../../../application/ports/stagedUploadStore'
import { requireGuest, requireRole } from '../middleware/authz'
import { createDiskSpaceGuard } from '../middleware/diskSpaceGuard'
import {
  GUESTBOOK_WRITES_PER_GUEST_PER_MINUTE,
  guestbookGuestLimiter,
  uploadBodyDeadline,
  uploadConcurrencyLimiter,
  uploadGuestLimiter,
  uploadLimiter,
} from '../middleware/rateLimit'
import { withGuest, withModerator } from '../middleware/scope'
import type { KeepPendingVoicesResponseDto } from '../presenters/dto'
import { toCreatedGuestbookVoiceDto } from '../presenters/presenters'
import { serveRanged } from '../presenters/serveRanged'
import { sendError, sendJson, sendResult } from '../presenters/send'
import { guestbookEntryParams, voiceUploadFields } from '../schemas/requestSchemas'
import type { HttpDeps } from '../types'
import type { HttpUseCases } from '../useCases'

/**
 * The voice messages of the guestbook (spec 25): a guest sends a recording, the host and the
 * moderators listen to it, and the owner lifts the secret over it.
 *
 * **A separate router, as the clips' is**, because the body is a file: its own multer, its own
 * byte limit (`MAX_VOICE_BYTES`, never the photo ceiling a heap budget was calculated against) and
 * its bytes on disk rather than in the heap. It is mounted beside `guestbookRoutes` and shares its
 * per-guest budget with it, which is why that budget is an argument and not a local.
 *
 * ## What each route is, and the one thing it must not be
 *
 * - `POST …/guestbook/voice` is the **guest's**, and `202`: nothing a moderator could act on exists
 *   yet (the recording is `queued`, and a voice is decidable and listenable only `ready`).
 * - `GET …/guestbook/:entryId/voice` is the **moderator's**, the **one** door the recording has, and
 *   it re-checks everything on every request, a player's `Range` requests included. It is not a
 *   photo route and no photo route can reach it (`mediaRoutes.test.ts` sweeps them).
 * - `POST …/guestbook/voice/open` is the **owner's** alone; `…/voice/keep-pending` a moderator's.
 *
 * None of them reaches the wall: the signals they cause are moderation-only (`signalAudience.ts`).
 */

export interface GuestbookVoiceRouteDeps {
  readonly deps: HttpDeps
  readonly usecases: Pick<
    HttpUseCases,
    | 'stageGuestbookVoice'
    | 'getGuestbookVoiceMedia'
    | 'openGuestbookVoice'
    | 'keepPendingGuestbookVoices'
  >
  /** Where multer writes the upload before it is staged. Under `MEDIA_ROOT`. */
  readonly uploadTempDir: string
  /** `MAX_VOICE_BYTES`, enforced by multer: a recording past it never reaches the use case. */
  readonly maxVoiceBytes: number
  /**
   * The bucket by address and event that photographs and clips use, **shared**: a voice is a file
   * upload and is counted with them (`guestWriteRateLimiter` is the text writes' bucket, not this
   * one). Optional only so a test can mount this router alone.
   */
  readonly uploadRateLimiter?: RequestHandler
  /** The second upload stage, per guest, shared with the photo and clip routes. */
  readonly uploadGuestRateLimiter?: RequestHandler
  /**
   * The guestbook's per-guest budget, **shared with `guestbookRoutes`** and built once by
   * `server.ts`: writing a word, leaving a voice and taking one back are one guest, and two
   * instances would be two budgets under one constant. Optional only so a test can mount this
   * router alone.
   */
  readonly guestbookGuestRateLimiter?: RequestHandler
  /** The upload concurrency semaphore, shared with the photo and clip routes. */
  readonly uploadConcurrencyLimiter?: RequestHandler
  readonly bodyDeadline?: RequestHandler
  readonly diskSpaceGuard?: RequestHandler
}

/** The multipart field name. Anything else is `LIMIT_UNEXPECTED_FILE` from multer. */
const VOICE_FIELD = 'voice'

/** The text parts a voice upload may carry, bounded in the parser: the caption, and room to spare. */
const MAX_TEXT_FIELDS = 3

/**
 * Removes the temp file multer wrote, on **every** exit path of the upload handler (the answer,
 * the refusal, the thrown error): disk storage means every exit owns a file.
 */
const removeUploadedFile =
  (stagedUploads: StagedUploadStore) =>
  async (req: Request): Promise<void> => {
    if (req.file === undefined) return
    await stagedUploads.remove(req.file.path).catch(() => {
      // A leaked temp file is removed at the next boot, when the composition root empties
      // MEDIA_ROOT/.uploads; failing a guest's recording over the cleanup would be worse.
    })
  }

export const guestbookVoiceRoutes = ({
  deps,
  usecases,
  uploadTempDir,
  maxVoiceBytes,
  uploadRateLimiter = uploadLimiter(deps.config.rateLimits.uploadPerIpPerMinute),
  uploadGuestRateLimiter = uploadGuestLimiter(deps.config.rateLimits.uploadPerMinute),
  guestbookGuestRateLimiter = guestbookGuestLimiter(GUESTBOOK_WRITES_PER_GUEST_PER_MINUTE),
  uploadConcurrencyLimiter: concurrencyLimiter = uploadConcurrencyLimiter({
    max: deps.config.uploads.maxConcurrentRequests,
    perEvent: deps.config.uploads.maxConcurrentRequestsPerEvent,
  }),
  bodyDeadline = uploadBodyDeadline(deps.config.uploads.bodyTimeoutMs),
  diskSpaceGuard = createDiskSpaceGuard({
    checker: deps.diskSpaceChecker,
    paths: deps.config.storage.diskSpacePaths,
    minFreeBytes: deps.config.storage.minFreeDiskBytes,
  }),
}: GuestbookVoiceRouteDeps): Router => {
  const router = Router()
  const voiceGuest = { cleanup: removeUploadedFile(deps.stagedUploads) }

  // Disk, never the heap, and **no `fileFilter`**: it could only read `file.mimetype`, which is a
  // string the client chose. The container is identified from the bytes, by the use case.
  const uploads = multer({
    storage: multer.diskStorage({ destination: resolve(uploadTempDir) }),
    limits: { fileSize: maxVoiceBytes, files: 1, fields: MAX_TEXT_FIELDS },
  })

  /**
   * Send a recording.
   *
   * The order is the clips' with one stage more. The address-and-event bucket runs first, before
   * authorization, so a flood is dropped before it costs a token check; then the device token; then
   * the per-guest **upload** budget and the per-guest **guestbook** budget (the second is the one
   * `POST …/guestbook` spends, because a guest who writes, records and takes back is one guest);
   * then the concurrency semaphore, the body deadline and the free-disk guard, all ahead of the
   * multipart parser. `202`: the recording is queued, and "received" is all that is true yet.
   */
  router.post(
    '/events/:eventSlug/guestbook/voice',
    uploadRateLimiter,
    requireGuest(deps),
    uploadGuestRateLimiter,
    guestbookGuestRateLimiter,
    concurrencyLimiter,
    bodyDeadline,
    diskSpaceGuard,
    uploads.single(VOICE_FIELD),
    withGuest(async ({ event, guest }, req, res) => {
      const file = req.file
      if (file === undefined) {
        // Absent when the request was not multipart at all, which to a guest is an empty picker.
        sendError(res, DomainError.invalid('upload.noFiles'))
        return
      }

      const fields = voiceUploadFields.parse(req.body)

      // Read once and **viewed**, not copied (`StagedUploadStore.read`), then the temp file goes
      // before anything that could fail, so no crash and no hung-up client leaves it behind. The
      // `finally` of the wrapper is the backstop for the paths that never reach this line.
      const bytes = await deps.stagedUploads.read(file.path)
      await deps.stagedUploads.remove(file.path)

      // Metadata is not forwarded: the client's file name is never a path and never a type.
      const result = await usecases.stageGuestbookVoice({
        eventId: event.id,
        guestId: guest.id,
        file: { bytes },
        ...(fields.caption === undefined ? {} : { caption: fields.caption }),
      })

      sendResult(res, result, (response, staged) => {
        response.setHeader('Cache-Control', 'no-store')
        sendJson(response, toCreatedGuestbookVoiceDto(staged.entry, staged.duplicate), 202)
      })
    }, voiceGuest),
  )

  /**
   * Listen to one recording. A moderator's, never a guest's (a device token is `401`, as on every
   * host route), and `Range`-capable because Safari will not play an `<audio>` without it.
   *
   * `Cache-Control: private, no-cache` with a strong `ETag` (the digest of the output): the console
   * **revalidates** on every play and a `304` costs no bytes, but nothing is ever kept past what
   * the server would say now. Every refusal is `no-store` and is the use case's: the sealed `403`,
   * the suspended `403`, and the single `404` for everything unknown, retired or not ready.
   */
  router.get(
    '/events/:eventSlug/guestbook/:entryId/voice',
    requireRole('moderator', deps),
    withModerator(async ({ eventId, slug, actor }, req, res) => {
      const params = guestbookEntryParams.parse(req.params)

      const result = await usecases.getGuestbookVoiceMedia({
        eventId,
        entryId: asGuestbookEntryId(params.entryId),
        actor,
      })
      res.setHeader('X-Content-Type-Options', 'nosniff')
      if (!result.ok) {
        res.setHeader('Cache-Control', 'no-store')
        sendError(res, result.error)
        return
      }

      const media = result.value
      await serveRanged(req, res, media, {
        contentType: media.contentType,
        cacheControl: 'private, no-cache',
        refusalCacheControl: 'no-store',
        contentDisposition: `inline; filename="${slug}-message-vocal.m4a"`,
        etag: `"${media.contentHash.value}"`,
        failureMessage: 'guestbook voice failed mid-stream',
      })
    }),
  )

  /**
   * "Ouvrir maintenant": lift the secret for good. **The owner's alone** (a moderator is `403`): a
   * delegated moderator must not be able to spoil the surprise for the couple. `200` with no body,
   * and the same `200` when it was already open.
   */
  router.post(
    '/events/:eventSlug/guestbook/voice/open',
    requireRole('owner', deps),
    withModerator(async ({ eventId, actor }, _req, res) => {
      const result = await usecases.openGuestbookVoice({ eventId, actor })

      sendResult(res, result, (response) => {
        response.status(200).end()
      })
    }),
  )

  /**
   * "Garder les N messages en attente": publish the ready voices still waiting for a decision. A
   * moderator's, with the count it kept; `0` when there was nothing to do.
   */
  router.post(
    '/events/:eventSlug/guestbook/voice/keep-pending',
    requireRole('moderator', deps),
    withModerator(async ({ eventId, actor }, _req, res) => {
      const result = await usecases.keepPendingGuestbookVoices({ eventId, actor })

      sendResult(res, result, (response, kept) => {
        response.setHeader('Cache-Control', 'no-store')
        const body: KeepPendingVoicesResponseDto = { kept: kept.kept }
        sendJson(response, body)
      })
    }),
  )

  return router
}
