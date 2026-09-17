import { ClipJob } from '../../../domain/clips/clipJob'
import { clipQueueFull } from '../../../domain/clips/clipQueue'
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
 * 4. one fact on the bus, which is what wakes the worker rather than making it wait for
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

    // The host allows video; this box cannot do it. Refused **here**, while the guest is
    // still holding the request, rather than by accepting eighty megabytes, answering
    // 202, and letting them discover by polling that the job they were told was accepted
    // had already failed. Costs nothing: the capability was decided once at boot.
    if (!transcoder.available()) {
      logger.error('a clip was offered to a deployment with no video encoder', { eventId })
      return err(DomainError.unexpected('clip.transcoderUnavailable'))
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

    /** The answer for bytes this event already has a job for. */
    const alreadyStaged = (held: ClipJob): Result<UploadClipResult, DomainError> =>
      ok({
        clipJobId: held.id,
        failureCode: held.failureCode,
        status: held.status,
        photoId: held.photoId,
        duplicate: true,
      })

    /**
     * Does a job for these bytes still mean something?
     *
     * The repository answers only with `queued`, `running` or `done` — a `failed` row is
     * a verdict about the album or about a machine, and an album empties, so it must
     * never block a fresh attempt. The one thing a status cannot express is the last
     * case: a **`done` job whose photo has been deleted**. `deletePhoto` retires the job,
     * so this is the crash between those two writes rather than the ordinary path; if the
     * row is gone, so is the reason to dedupe, and the guest gets a new job.
     */
    const stillMeaningful = async (held: ClipJob): Promise<boolean> =>
      held.status !== 'done' || (await photos.findById(eventId, held.photoId)) !== null

    // The retry on venue Wi-Fi. The same bytes staged twice would be two jobs, two
    // transcodes and two slides; this is why the job carries the digest of the *source*.
    //
    // **This look is not the decision.** It is separated from the insert by an `await`
    // and an up-to-80 MB write, so two guests sending the same video from the group chat
    // both miss it. The unique index is what decides; see `clips.stage` below.
    const existing = await clips.findBySourceHash(eventId, digest.value)
    if (existing !== null && (await stillMeaningful(existing))) return alreadyStaged(existing)

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

    /**
     * **The row first, then the bytes.** This ordering is the whole of the quota story.
     *
     * The quota is computed from rows — `photos.byte_size` plus the staged sources — so
     * while the bytes went first, every refused upload had already written up to
     * `MAX_CLIP_BYTES` that nothing counted, for as long as it took the reconciliation
     * sweep to come round. A table of guests all forwarding the same video from the group
     * chat would pass the check one at a time and fill the disk between them, and ENOSPC
     * takes photo ingest and the wall down with it.
     *
     * Reserving first buys three things at once. A refusal costs **zero bytes**, because
     * nothing has been written yet. The reservation is charged to the event from the
     * instant it exists, so the burst above is refused honestly. And deleting becomes
     * safe again — the row *is* the proof of ownership, since the unique index means no
     * other request can be holding that digest.
     *
     * Depth, quota and uniqueness are still decided inside this one transaction, which is
     * what makes them a bound rather than a hope.
     */
    let admission
    try {
      admission = await clips.stage(job.value, {
        quotaBytes: event.quotaBytes,
        maxQueuedClips: limits.maxQueuedClips,
      })
    } catch (cause) {
      // **A raise here is not necessarily a failure.** The port says `stage` raises on a
      // second job for bytes this event already holds — the dedupe look above and this
      // insert are separated by an `await`, so two guests sending the same video from the
      // group chat both miss it. Asking again tells the two apart without matching on a
      // driver's message: if those bytes now have a job, this upload's outcome is that
      // job. Nothing was written either way, so there is nothing to clean up.
      const winner = await clips.findBySourceHash(eventId, digest.value)
      if (winner !== null && (await stillMeaningful(winner))) {
        logger.info('an identical clip was reserved first; answering with the job it made', {
          eventId,
          clipJobId: winner.id,
        })
        return alreadyStaged(winner)
      }

      logger.error('could not reserve a place in the transcode queue', {
        eventId,
        cause: String(cause),
      })
      return err(DomainError.unexpected('clip.stageFailed'))
    }

    const refusal = admission.refusal
    if (refusal !== null) {
      // Refused against committed state, and **nothing has been written**: that is the
      // point of reserving first.
      return err(
        refusal.reason === 'queueFull'
          ? clipQueueFull(refusal.depth, limits.maxQueuedClips)
          : DomainError.quotaExceeded('event.quotaExceeded', {
              remaining: refusal.remaining,
              required: byteSize,
            }),
      )
    }

    /**
     * Give the reservation back, with anything that landed under its digest.
     *
     * Safe to delete here, and this is the only place in the upload path where that is
     * true: the reservation is committed and the unique index covers it, so no other
     * request can be holding this digest. Contrast the old shape, where the bytes went
     * first and a refusal was deleting by a name it could not prove it owned.
     *
     * **The bytes go first, and the order is the whole of that argument.** Deleting the
     * row first releases the digest, so a re-upload can reserve it in the gap and the
     * unlink then takes *its* source — the sentence above would be describing an index
     * entry that no longer existed by the time it mattered. `transcodeNextClip.giveUpOn`
     * is ordered the same way for the same reason.
     *
     * Best effort on the media, for the reason `transcodeNextClip.discard` gives at
     * length: a file that will not unlink is a leak the reconciliation sweep collects,
     * while an exception escaping here would leave the reservation charging the event and
     * holding a queue slot until something reaped it.
     */
    const releaseReservation = async (): Promise<void> => {
      await media.delete(eventId, digest.value).catch((cause: unknown) => {
        logger.warn('could not remove a reserved clip’s source; left for the sweep', {
          eventId,
          cause: String(cause),
        })
      })
      await clips.deleteForPhoto(eventId, job.value.photoId)
    }

    try {
      await media.put(eventId, digest.value, STAGED_SOURCE, file.bytes)
    } catch (cause) {
      logger.error('could not stage a clip for transcoding', {
        eventId,
        cause: String(cause),
      })
      await releaseReservation()
      return err(DomainError.unexpected('clip.stageFailed'))
    }

    // The bytes are there. Only now may the worker see it — `isDue` is `queued` only, so
    // until this lands nothing can claim a job whose source might not exist.
    //
    // `ready()` throws rather than answering, and it is **inside** the try for that
    // reason: unreachable today (its only caller is here, on a job `create` just made),
    // but if it ever did throw from outside one, the source would be on the disk, the row
    // would stay `reserved`, the digest would stay locked against the guest's own retry,
    // and the reaper would not touch it for five minutes. One `catch` covers both.
    let queued
    let ready
    try {
      ready = job.value.ready(clock.now())
      queued = await clips.save(ready)
    } catch (cause) {
      logger.error('could not hand a staged clip to the queue', {
        eventId,
        cause: String(cause),
      })
      await releaseReservation()
      return err(DomainError.unexpected('clip.stageFailed'))
    }

    if (!queued) {
      /**
       * **The one exit that deletes nothing, and the only one where it would be wrong.**
       *
       * Every other failure above still holds its reservation, and that row is what makes
       * removing the source safe: the unique index means no other request can be holding
       * this digest. Here the row is gone — reaped as wreckage, or taken with a purged
       * event — so that proof has evaporated, and the guest may already have re-uploaded
       * the same video onto a fresh reservation holding these very bytes. Unlinking would
       * take its source out from under it, which is the mistake `transcodeNextClip.finish`
       * refuses to make about the identical situation.
       *
       * So the bytes stay, and `sweepOrphanedMedia` collects them if nothing names them:
       * it asks the database rather than guessing, and will not touch anything written in
       * the last few minutes.
       */
      logger.warn('a clip’s reservation was gone before its bytes were handed over', {
        eventId,
        clipJobId: job.value.id,
      })
      return err(DomainError.unexpected('clip.stageFailed'))
    }

    // Last, after the row says the bytes are there: a subscriber must never learn about
    // work that cannot be done yet. This is what wakes the worker.
    bus.publish({ type: 'clip.queued', eventId, clipJobId: ready.id })

    return ok({
      clipJobId: ready.id,
      failureCode: ready.failureCode,
      status: ready.status,
      photoId: ready.photoId,
      duplicate: false,
    })
  }
}
