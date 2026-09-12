import { ClipJob } from '../../../domain/clips/clipJob'
import { admitsAnotherClip, clipQueueFull } from '../../../domain/clips/clipQueue'
import type { ClipJobStatus } from '../../../domain/clips/clipJobStatus'
import { Caption } from '../../../domain/photos/caption'
import { ContentHash } from '../../../domain/photos/contentHash'
import type { PhotoAuthor } from '../../../domain/photos/photo'
import { DomainError } from '../../../domain/shared/errors'
import type { ClipJobId, EventId, PhotoId } from '../../../domain/shared/ids'
import { err, ok, type Result } from '../../../domain/shared/result'
import type { ClipJobRepository } from '../../ports/clipJobRepository'
import type { Clock } from '../../ports/clock'
import type { ContentHasher } from '../../ports/contentHasher'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import type { IdGenerator } from '../../ports/idGenerator'
import type { Logger } from '../../ports/logger'
import { STAGED_SOURCE, type MediaStore } from '../../ports/mediaStore'
import type { PhotoRepository } from '../../ports/photoRepository'
import type { VideoTranscoder } from '../../ports/videoTranscoder'

/**
 * Staging a clip: everything that has to happen while the guest is still holding the
 * request open, and nothing that does not.
 *
 * A clip is not a photo with a different extension. Transcoding fifteen seconds of 4K
 * HEVC is seconds of a core, and doing it inline would hold the guest's phone on a
 * spinner over venue Wi-Fi, block the request slot, and — twelve at a time behind the
 * upload limiter — take the wall down with it. So this use case does the cheap, decisive
 * work and hands the rest to a queue:
 *
 * 1. the event gate, as guest photo ingest has it;
 * 2. the **signature** check, which starts no process, so a renamed PDF is refused
 *    before a byte reaches the disk — the same ordering as magic bytes before `sharp`;
 * 3. backpressure, which is a `429` and never the quota's `413`;
 * 4. the source written to the media store, **then** the job row, because a row pointing
 *    at bytes that do not exist is the failure 1.0 shipped;
 * 5. one fact on the bus, which is what wakes the worker rather than making it wait for
 *    a tick sized for an idle evening.
 *
 * The `photos` row does not exist yet and will not until the transcode succeeds. That is
 * the design, not an omission: it is what makes a half-encoded clip on the projector
 * something nobody has to filter out.
 */

export interface UploadClipFile {
  readonly bytes: Uint8Array
  /** Metadata echoed nowhere and never a path. Kept for the log line only. */
  readonly declaredName: string
}

export interface UploadClipInput {
  readonly eventId: EventId
  readonly author: PhotoAuthor
  readonly file: UploadClipFile
  readonly caption?: string | null
}

export interface UploadClipLimits {
  /**
   * How many clips may be waiting or running across the whole box before an upload is
   * told to come back. Process-wide because the worker is — see
   * `src/domain/clips/clipQueue.ts`.
   */
  readonly maxQueuedClips: number
}

export interface UploadClipDeps {
  readonly events: EventRepository
  readonly clips: ClipJobRepository
  readonly photos: PhotoRepository
  readonly media: MediaStore
  readonly transcoder: VideoTranscoder
  readonly hasher: ContentHasher
  readonly bus: EventBus
  readonly clock: Clock
  readonly ids: IdGenerator
  readonly logger: Logger
  readonly limits: UploadClipLimits
}

export interface UploadClipResult {
  readonly clipJobId: ClipJobId
  readonly status: ClipJobStatus
  /** The row this job will produce, so a client can start watching for it. */
  readonly photoId: PhotoId
  /** The stable code behind a `failed` status — a retry of a clip already given up on. */
  readonly failureCode: string | null
  /**
   * True when these exact bytes were already staged for this event — the retry after a
   * dropped upload. A success, not a failure: the guest's clip is in hand.
   *
   * Deliberately **not** on the wire: what a client acts on is the status, and a second
   * flag saying the same thing twice is a second thing to keep in step.
   */
  readonly duplicate: boolean
}

export type UploadClip = (input: UploadClipInput) => Promise<Result<UploadClipResult, DomainError>>

export const makeUploadClip = ({
  events,
  clips,
  photos,
  media,
  transcoder,
  hasher,
  bus,
  clock,
  ids,
  logger,
  limits,
}: UploadClipDeps): UploadClip => {
  return async ({ eventId, author, file, caption }) => {
    const event = await events.findById(eventId)
    if (event === null) return err(DomainError.notFound('event.notFound'))

    if (!event.acceptsUploads()) {
      return err(DomainError.conflict('event.notAcceptingUploads', { status: event.status }))
    }

    const settings = event.settings
    if (!settings.allowClips) {
      // A host's switch, not a capability question: a wedding that does not want video
      // on the wall says so, and the guest is told which it was.
      return err(DomainError.forbidden('event.clipsNotAllowed'))
    }

    const parsedCaption = Caption.createOptional(caption)
    if (!parsedCaption.ok) return parsedCaption
    if (parsedCaption.value !== null && !settings.allowCaptions) {
      return err(DomainError.forbidden('event.captionsNotAllowed'))
    }

    // Signature before anything else touches the disk. This starts no process — see the
    // note on `VideoTranscoder.identify` — so a renamed document costs the box nothing
    // and the guest is told immediately rather than twenty seconds into a queue.
    if (transcoder.identify(file.bytes) === null) {
      return err(DomainError.invalid('clip.unsupportedFormat'))
    }

    // No separate "is it empty" check: `ClipJob.create` is the one gate on the staged
    // size, because those bytes are charged to a quota the instant the row exists and a
    // second spelling of the same rule is a second thing to keep in step.
    const byteSize = file.bytes.byteLength

    const digest = ContentHash.create(hasher.sha256Hex(file.bytes))
    if (!digest.ok) {
      logger.error('content hasher returned something that is not a sha-256 digest', {
        eventId,
        code: digest.error.code,
      })
      return err(DomainError.unexpected('photo.hashFailed'))
    }

    // The retry on venue Wi-Fi. The same bytes staged twice would be two jobs, two
    // transcodes and two slides; this is why the job carries the digest of the *source*.
    const existing = await clips.findBySourceHash(eventId, digest.value)
    if (existing !== null) {
      return ok({
        clipJobId: existing.id,
        failureCode: existing.failureCode,
        status: existing.status,
        photoId: existing.photoId,
        duplicate: true,
      })
    }

    // **The cheap look, not the decision.** Both of the rules below are decided again
    // inside `clips.stage`'s transaction, where nothing can interleave; what they buy
    // here is a refusal *before* sixty megabytes are written to the disk. Refusing a
    // full queue after staging the source would be the queue paying for its own
    // backpressure.
    //
    // Backpressure is deliberately **not** `event.quotaExceeded`, which tells a guest in
    // French that the gallery is full and to go and find the organiser — for a condition
    // that clears in ninety seconds.
    const depth = await clips.countActive()
    if (!admitsAnotherClip(depth, limits.maxQueuedClips)) {
      return err(clipQueueFull(depth, limits.maxQueuedClips))
    }

    // The staged source is charged to the quota **from now**, because it is on the disk
    // the quota exists to protect from now. `totalBytes` spans the queue as well as the
    // album for exactly this reason.
    const usedBytes = await photos.totalBytes(eventId)
    if (!event.hasQuotaFor(byteSize, usedBytes)) {
      return err(
        DomainError.quotaExceeded('event.quotaExceeded', {
          remaining: event.remainingQuota(usedBytes),
          required: byteSize,
        }),
      )
    }

    const now = clock.now()
    const job = ClipJob.create(
      {
        eventId,
        author,
        sourceHash: digest.value,
        sourceByteSize: byteSize,
        caption: parsedCaption.value,
      },
      ids.clipJobId(),
      // Minted here, before any transcode: a crash between the photo insert and the
      // job's `done` is then a lookup rather than a duplicate row or an orphan.
      ids.photoId(),
      now,
    )
    // Fails closed on a source the entity will not accept — an empty upload that an
    // adapter's signature check waved through. Nothing has been written yet.
    if (!job.ok) return job

    // Media, then the row. A row naming bytes that were never written is 1.0's defect.
    try {
      await media.put(eventId, digest.value, STAGED_SOURCE, file.bytes)
    } catch (cause) {
      logger.error('could not stage a clip for transcoding', {
        eventId,
        cause: String(cause),
      })
      return err(DomainError.unexpected('clip.stageFailed'))
    }

    // **The enforcing check, and the only insert into the queue.** Depth and quota are
    // taken again here inside the row's own transaction, which is what makes them a
    // bound rather than a hope: the two reads above happen with `await`s between them,
    // so a second upload in flight passed the same ones.
    let admission
    try {
      admission = await clips.stage(job.value, {
        quotaBytes: event.quotaBytes,
        maxQueuedClips: limits.maxQueuedClips,
      })
    } catch (cause) {
      logger.error('could not queue a staged clip; removing what this upload wrote', {
        eventId,
        cause: String(cause),
      })
      await media.delete(eventId, digest.value)
      return err(DomainError.unexpected('clip.stageFailed'))
    }

    const refusal = admission.refusal
    if (refusal !== null) {
      // Refused against committed state, so the bytes just written are charged to
      // nothing and have to go before the response does.
      await media.delete(eventId, digest.value)
      return err(
        refusal.reason === 'queueFull'
          ? clipQueueFull(refusal.depth, limits.maxQueuedClips)
          : DomainError.quotaExceeded('event.quotaExceeded', {
              remaining: refusal.remaining,
              required: byteSize,
            }),
      )
    }

    // Last, after the row is committed: a subscriber must never learn about work that is
    // not there yet. This is what wakes the worker.
    bus.publish({ type: 'clip.queued', eventId, clipJobId: job.value.id })

    return ok({
      clipJobId: job.value.id,
      failureCode: job.value.failureCode,
      status: job.value.status,
      photoId: job.value.photoId,
      duplicate: false,
    })
  }
}
