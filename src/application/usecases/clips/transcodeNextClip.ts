import type { ClipJob } from '../../../domain/clips/clipJob'
import { ClipDuration } from '../../../domain/clips/clipDuration'
import { ContentHash } from '../../../domain/photos/contentHash'
import { Photo } from '../../../domain/photos/photo'
import type { DomainError } from '../../../domain/shared/errors'
import type { ClipJobId, EventId, PhotoId } from '../../../domain/shared/ids'
import { ok, type Result } from '../../../domain/shared/result'
import type { ClipJobRepository } from '../../ports/clipJobRepository'
import type { Clock } from '../../ports/clock'
import type { ContentHasher } from '../../ports/contentHasher'
import type { EventBus } from '../../ports/eventBus'
import type { EventRepository } from '../../ports/eventRepository'
import type { Logger } from '../../ports/logger'
import { STAGED_SOURCE, type MediaStore } from '../../ports/mediaStore'
import type { PhotoRepository } from '../../ports/photoRepository'
import type { TranscodeSpec, VideoTranscoder } from '../../ports/videoTranscoder'

/**
 * One pass of the transcode queue: claim a clip, encode it, and give it a `photos` row.
 *
 * **Every decision lives here**, not in the worker that calls it. `src/main` is excluded
 * from coverage, so a retry ladder, an error classification or an admission rule written
 * into the timer would be a rule nothing can test; the worker gets a loop and a timer and
 * this gets the judgement.
 *
 * The order is the design, and it is guest photo ingest's order with a crash in the
 * middle of it:
 *
 * 1. **Claim atomically.** The repository takes the row and marks it `running` in one
 *    transaction, so two processes during a rolling restart cannot encode to one path.
 * 2. **Check whether the work is already done.** The photo id was minted at staging, so
 *    a process that died between the insert and the bookkeeping left a row that can be
 *    recognised — and this run finishes the bookkeeping instead of encoding again.
 * 3. **Probe, and refuse at the probe.** The duration cap is applied to the header
 *    before a frame is decoded, and again as a hard bound on the encoder, because a
 *    truncated container declares whatever it declared before the phone died.
 * 4. **Write the media, then the row**, exactly as ingest does — a row naming bytes that
 *    do not exist is the failure 1.0 shipped.
 * 5. **The row goes in through `saveManyWithinLimits`**, the only insert that counts the
 *    quota inside its own transaction. A clip that no longer fits is refused there, after
 *    the work, and its media is removed — the alternative is a disk that fills while
 *    every individual check passed.
 * 6. **Only then is the job `done`**, which is what stops the staged source counting
 *    against the quota, and the staged bytes are removed.
 */

export interface TranscodeClipPolicy {
  /** The projected height of a clip. 720p reads well on a projector and encodes fast. */
  readonly maxHeight: number
  readonly maxDurationMs: number
  readonly maxOutputBytes: number
  readonly posterMaxEdge: number
  /**
   * The decompression-bomb control for video, and the exact counterpart of the photo
   * path's `exceedsPixelBudget`.
   *
   * `maxHeight` is not one: it is what the *output* is scaled to, and `-vf scale` runs
   * **after** the decoder has already produced a frame. A valid 16000x16000 HEVC is
   * about 380 MB per frame before anything is scaled, which is an OOM kill on a venue
   * box — classified transient, so the worker would take the same clip twice more and
   * pin itself while the room waits.
   *
   * Judged from the probed header, before a frame exists, exactly as a photograph's is.
   */
  readonly maxPixels: number
}

export interface TranscodeNextClipDeps {
  readonly events: EventRepository
  readonly clips: ClipJobRepository
  readonly photos: PhotoRepository
  readonly media: MediaStore
  readonly transcoder: VideoTranscoder
  readonly hasher: ContentHasher
  readonly bus: EventBus
  readonly clock: Clock
  readonly logger: Logger
  readonly policy: TranscodeClipPolicy
}

export type TranscodeNextClipOutcome =
  /** Nothing was due. The ordinary answer for most of an evening. */
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'transcoded'
      readonly clipJobId: ClipJobId
      readonly eventId: EventId
      readonly photoId: PhotoId
      /** True when the row was already there and this pass only finished the paperwork. */
      readonly recovered: boolean
    }
  | {
      readonly kind: 'failed'
      readonly clipJobId: ClipJobId
      readonly eventId: EventId
      readonly code: string
      readonly willRetry: boolean
    }

export type TranscodeNextClip = () => Promise<Result<TranscodeNextClipOutcome, DomainError>>

export const makeTranscodeNextClip = ({
  events,
  clips,
  photos,
  media,
  transcoder,
  hasher,
  bus,
  clock,
  logger,
  policy,
}: TranscodeNextClipDeps): TranscodeNextClip => {
  const spec: TranscodeSpec = {
    maxHeight: policy.maxHeight,
    maxDurationMs: policy.maxDurationMs,
    maxOutputBytes: policy.maxOutputBytes,
    posterMaxEdge: policy.posterMaxEdge,
  }

  /**
   * Record a failure and decide, through the entity, whether it comes back.
   *
   * Never throws and never returns an error `Result`: a clip that cannot be transcoded
   * is an outcome of the pass, not a failure of it. The pass fails only when the
   * database does, which is what the worker's own guard is for.
   */
  const giveUpOn = async (
    job: ClipJob,
    code: string,
    now: Date,
  ): Promise<Result<TranscodeNextClipOutcome, DomainError>> => {
    const failed = job.fail(code, now)
    if (!failed.ok) return failed

    await clips.save(failed.value)

    const willRetry = failed.value.status === 'queued'
    if (!willRetry) {
      // The staged bytes are the guest's un-stripped original. A clip nobody will ever
      // transcode must not leave them on the disk to be reconciled as a leak later.
      await media.delete(job.eventId, job.sourceHash)
      bus.publish({ type: 'clip.failed', eventId: job.eventId, clipJobId: job.id })
    }

    logger.warn('clip transcode failed', {
      eventId: job.eventId,
      clipJobId: job.id,
      code,
      attempts: failed.value.attempts,
      willRetry,
    })

    return ok({
      kind: 'failed',
      clipJobId: job.id,
      eventId: job.eventId,
      code,
      willRetry,
    })
  }

  /** The bookkeeping every success ends with, whether or not it did any encoding. */
  const finish = async (
    job: ClipJob,
    now: Date,
    recovered: boolean,
  ): Promise<Result<TranscodeNextClipOutcome, DomainError>> => {
    const done = job.succeed(now)
    if (!done.ok) return done
    await clips.save(done.value)
    // Only now: while the job was `running` its source still counted against the event's
    // quota, which is what kept the database and the disk agreeing during the queue.
    await media.delete(job.eventId, job.sourceHash)

    return ok({
      kind: 'transcoded',
      clipJobId: job.id,
      eventId: job.eventId,
      photoId: job.photoId,
      recovered,
    })
  }

  return async () => {
    const now = clock.now()

    const job = await clips.claimNext(now)
    if (job === null) return ok({ kind: 'idle' })

    const event = await events.findById(job.eventId)
    if (event === null) return giveUpOn(job, 'event.notFound', now)

    // Crash recovery. The photo id was fixed at staging, so a row under it means a
    // previous attempt got as far as the insert and died before saying so. Encoding
    // again would produce a second file under a different digest and orphan the first.
    if ((await photos.findById(job.eventId, job.photoId)) !== null) {
      logger.info('clip photo row already existed; finishing the interrupted job', {
        eventId: job.eventId,
        clipJobId: job.id,
      })
      return finish(job, now, true)
    }

    const source = await media.read(job.eventId, job.sourceHash, STAGED_SOURCE)
    if (source === null) return giveUpOn(job, 'clip.sourceMissing', now)

    const probed = await transcoder.probe(source)
    if (!probed.ok) return giveUpOn(job, probed.error.code, now)

    // The pixel budget, from the header, before a frame is decoded. The same control the
    // photo path applies, and for the same reason: `maxHeight` scales the *output*, and
    // the filter that does it runs after the decoder has already allocated the frame.
    if (probed.value.dimensions.exceedsPixelBudget(policy.maxPixels)) {
      return giveUpOn(job, 'clip.pixelBudgetExceeded', now)
    }

    // Refused at the probe, and bounded again at the encoder through `spec`. Both,
    // because the header is a claim by the file: a truncated recording declares a
    // duration it never had, and a hand-written one can declare anything at all.
    const declared = ClipDuration.create(probed.value.durationMs, policy.maxDurationMs)
    if (!declared.ok) return giveUpOn(job, declared.error.code, now)

    const transcoded = await transcoder.transcode(source, spec)
    if (!transcoded.ok) return giveUpOn(job, transcoded.error.code, now)

    const { video, poster } = transcoded.value
    const videoHash = ContentHash.create(hasher.sha256Hex(video.bytes))
    const posterHash = ContentHash.create(hasher.sha256Hex(poster.bytes))
    if (!videoHash.ok) return giveUpOn(job, 'photo.hashFailed', now)
    if (!posterHash.ok) return giveUpOn(job, 'photo.hashFailed', now)

    // Measured on what was actually written, never copied from the source: `-t` and the
    // output size bound both truncate, and the wall lays out what it will really play.
    const duration = ClipDuration.create(video.durationMs, policy.maxDurationMs)
    if (!duration.ok) return giveUpOn(job, duration.error.code, now)

    /** Every byte this pass put on the disk, so a refusal removes exactly them. */
    const written = [videoHash.value, posterHash.value]
    const unwind = async (): Promise<void> => {
      for (const hash of written) await media.delete(job.eventId, hash)
    }

    try {
      await media.put(job.eventId, videoHash.value, 'video', video.bytes)
      await media.put(job.eventId, posterHash.value, 'poster', poster.bytes)
    } catch (cause) {
      logger.error('could not store a transcoded clip; removing what this pass wrote', {
        eventId: job.eventId,
        clipJobId: job.id,
        cause: String(cause),
      })
      await unwind()
      return giveUpOn(job, 'clip.storageFailed', now)
    }

    const photo = Photo.create(
      {
        eventId: job.eventId,
        author: job.author,
        contentHash: videoHash.value,
        dimensions: video.dimensions,
        // Both files, because both are on the disk the quota protects. The staged source
        // stops counting a few statements below, when the job is marked done.
        byteSize: video.byteSize + poster.byteSize,
        caption: job.caption,
        facet: { kind: 'clip', duration: duration.value, posterHash: posterHash.value },
      },
      job.photoId,
      now,
    )
    if (!photo.ok) {
      await unwind()
      return giveUpOn(job, photo.error.code, now)
    }

    // The only insert that takes the quota and the per-guest cap inside its own
    // transaction. A clip refused here is refused against committed state, which is why
    // `clipFailure` classifies those codes as permanent: retrying decides the same way.
    let admissions
    try {
      admissions = await photos.saveManyWithinLimits(job.eventId, [photo.value], {
        quotaBytes: event.quotaBytes,
        maxPhotosPerGuest: event.settings.maxPhotosPerGuest,
      })
    } catch (cause) {
      logger.error('could not insert a transcoded clip; removing what this pass wrote', {
        eventId: job.eventId,
        clipJobId: job.id,
        cause: String(cause),
      })
      await unwind()
      return giveUpOn(job, 'clip.storageFailed', now)
    }

    const refusal = admissions[0]?.refusal ?? null
    if (refusal !== null) {
      await unwind()
      return giveUpOn(
        job,
        refusal.reason === 'quotaExceeded' ? 'event.quotaExceeded' : 'event.photoLimitReached',
        now,
      )
    }

    // An auto-publish event records an `automatic` reviewer immediately, exactly as
    // photo ingest does, so the wall never shows something whose decision nobody can
    // account for afterwards.
    const published =
      event.settings.moderation === 'auto'
        ? await photos.updateStatuses(job.eventId, [photo.value.id], 'published', {
            kind: 'automatic',
            at: now,
          })
        : []

    const finished = await finish(job, now, false)
    if (!finished.ok) return finished

    bus.publish({ type: 'photo.uploaded', eventId: job.eventId, photoId: photo.value.id })
    for (const photoId of published) {
      bus.publish({ type: 'photo.moderated', eventId: job.eventId, photoId, status: 'published' })
    }

    return finished
  }
}
