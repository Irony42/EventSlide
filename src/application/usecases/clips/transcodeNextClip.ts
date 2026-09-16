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
   * Remove bytes this pass is finished with, **without letting the disk strand the row.**
   *
   * `fsMediaStore.delete` swallows `ENOENT` and rethrows everything else, and the failure
   * that brings the worker here is correlated with the failure that makes an unlink
   * throw: a venue SSD starts erroring, the filesystem remounts read-only, `media.put`
   * fails with `clip.storageFailed`, the attempts run out — and then the unlink throws
   * against the same read-only mount. Unguarded, that exception left `giveUpOn`, left the
   * pass, and left the row **`running` for the life of the process**, because
   * `recoverAbandoned` is boot-only. Such a row holds one of `MAX_QUEUED_CLIPS` slots,
   * charges its event up to `MAX_CLIP_BYTES` against a quota that also covers the album,
   * keeps its digest in the unique index so the guest's re-upload dedupes onto it, and
   * answers "running" all evening. Twenty of them and every clip upload on the box is a
   * `429` for the rest of the wedding.
   *
   * Leaving bytes behind is the trade this whole feature makes — `sweepOrphanedMedia`
   * collects them. Stranding a `running` row is not a trade, it is a wedged queue.
   */
  const discard = async (eventId: EventId, hash: ContentHash): Promise<void> => {
    await media.delete(eventId, hash).catch((cause: unknown) => {
      logger.warn('could not remove a clip’s bytes; left for the reconciliation sweep', {
        eventId,
        cause: String(cause),
      })
    })
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

    /**
     * **The bytes go before the row does, when they go at all.**
     *
     * The order is the point. Committing `failed` first releases this digest from the
     * partial unique index, so the guest's own re-upload can reserve it in the gap — and
     * the unlink below would then take that new reservation's source. Deleting first
     * means the window does not exist: while this job is still `running` no other row can
     * hold the digest, which is the same argument that makes the reservation the proof of
     * ownership everywhere else in this feature.
     *
     * The mirror hazard — the row already gone before this pass reached here — is what
     * `finish` guards against and this one does not need to: `deleteForPhoto` retires a
     * job by its **photo** id, and a clip has no `photos` row until the transcode
     * succeeds, so the only way a row disappears under `giveUpOn` is the event being
     * purged, which takes the digest and the bytes with it.
     *
     * What failed here is the clip's own content — not a video, a header that will not
     * parse, longer than the cap, a frame past the pixel budget — so nothing will ever
     * come of those bytes and leaving them is a leak. `recoverClipJobs` is the other path
     * and deliberately keeps them: giving up after three interrupted boots says something
     * about the box, not about the video.
     */
    const givingUp = failed.value.status !== 'queued'
    if (givingUp) await discard(job.eventId, job.sourceHash)

    const stillThere = await clips.save(failed.value)

    const willRetry = stillThere && !givingUp
    if (stillThere && givingUp) {
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

    // **The job may have been retired under this pass.** `deletePhoto` deletes a clip's
    // job row, and a guest deleting their own clip mid-transcode is an ordinary thing to
    // do — so `save` is update-only and answers whether the row was still there. Writing
    // it back would either re-insert a `done` row naming a photo that no longer exists,
    // or collide with the guest's re-upload on the unique index and throw out of here,
    // leaving this job `running` for ever with its source never released.
    //
    // The source goes either way: this pass is finished with it, and nothing else can be
    // holding that digest.
    const stillThere = await clips.save(done.value)

    if (stillThere) {
      // Only now: while the job was `running` its source still counted against the event's
      // quota, which is what kept the database and the disk agreeing during the queue.
      //
      // Save-then-delete is safe **here** and nowhere else in this file, because `done`
      // still blocks a re-upload — the partial unique index covers it — so committing the
      // transition does not release the digest. Best-effort all the same, for the reason
      // `discard` gives.
      await discard(job.eventId, job.sourceHash)
    } else {
      // **And deliberately no delete when the row is gone.** The guest may already have
      // re-uploaded the same video — which is legal the moment the old job is retired —
      // and that new reservation holds this very digest. Deleting here would take its
      // source out from under it. `sweepOrphanedMedia` asks the database instead, so it
      // collects these bytes only if nothing names them.
      logger.info('the clip this pass transcoded was deleted while it ran', {
        eventId: job.eventId,
        clipJobId: job.id,
      })
    }

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

    /**
     * Take back what this pass wrote — **and only what nothing else is naming.**
     *
     * The video's digest is safe by construction: `photos (event_id, content_hash)` is
     * unique, so no other row can hold it. The **poster** is not. It is a deterministic
     * 640-max-edge JPEG of a frame one second in, and it carries no unique index, so two
     * clips whose opening second looks the same — a dark room, a stage before the lights
     * — share it. Unwinding clip B without asking destroyed published clip A's poster,
     * which is both its `thumbUrl` and its `displayUrl`: a broken tile on the wall, in
     * the grid and in the album, while A's mp4 went on playing.
     *
     * The same guard `deletePhoto` and `uploadPhotos` have, on the path that did not
     * have it. This is called from four places and every one of them can hit that.
     */
    const written = [videoHash.value, posterHash.value]
    const unwind = async (): Promise<void> => {
      for (const hash of written) {
        // The row this pass is inserting does not exist yet on any path that unwinds, so
        // anything found here belongs to somebody else.
        if ((await photos.findIdsReferencing(job.eventId, hash)).length > 0) continue
        // Best effort, for the reason `discard` gives: `unwind` is called from inside two
        // catch blocks, so a throwing unlink here strands the row exactly as it did in
        // `giveUpOn` — and both are reached by the same failing disk.
        await discard(job.eventId, hash)
      }
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
        // **The source this output replaces, credited inside the same transaction.**
        // The job is still `running` here, deliberately — marking it `done` first would
        // open a window where a crash loses the accounting entirely — so without this
        // the event is charged for the guest's original *and* the 720p result it became.
        // A source is routinely twenty times its output, so an event anywhere near its
        // quota refused a clip that plainly fitted; and `event.quotaExceeded` is
        // permanent, so the outputs were unwound, the source deleted and the row left
        // terminal. Freeing space did not help the guest: the re-upload deduped onto it.
        replacesStagedClip: job.id,
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
