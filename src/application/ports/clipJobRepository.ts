import type { ClipJob } from '../../domain/clips/clipJob'
import type { ContentHash } from '../../domain/photos/contentHash'
import type { ClipJobId, EventId, PhotoId } from '../../domain/shared/ids'

/**
 * The transcode queue.
 *
 * Every read is scoped by `eventId`, as every other event-scoped port is — with two
 * deliberate exceptions, both of which are the worker's and neither of which returns
 * anything to a request. {@link ClipJobRepository.claimNext} and
 * {@link ClipJobRepository.recoverAbandoned} ask "what, anywhere on this box, is due",
 * because there is one worker for the whole process; the same shape as
 * `EventRepository.listDueForPurge`, and for the same reason. They are not reachable
 * from a route: `HttpUseCases` does not list the use cases that call them.
 */
/**
 * The half of the byte quota that is not photographs.
 *
 * A staged clip is on the disk the quota exists to protect and has no `photos` row, so
 * `SUM(byte_size)` over `photos` alone under-reports an event by the whole contents of
 * its queue — and `MediaStore.usedBytes` would then disagree with the database by that
 * amount, which the media store's own contract says means a leak worth logging.
 *
 * It is a named interface rather than one more method on the repository because the
 * photo side has to be able to ask for it: the SQLite adapter reads `clip_jobs` inside
 * the same statement as its `SUM`, and `FakePhotoRepository` is handed this to stay
 * honest about the same arithmetic.
 */
export interface StagedByteSource {
  /**
   * Bytes of sources still staged for one event: every job that still holds its source,
   * a `reserved` one included. `holdsStagedBytes` is the rule.
   */
  stagedBytes(eventId: EventId): Promise<number>

  /**
   * What **one** job alone is charged, or zero if it is holding nothing.
   *
   * Serves `PhotoAdmissionLimits.replacesStagedClip`: the transcode worker inserts a
   * clip's output while that clip's own job is still `running`, so the event would
   * otherwise be charged for the source *and* the result it became. The SQLite photo
   * repository does that subtraction inside its own insert transaction, which is the only
   * place it is correct; this is what lets the in-memory one arrive at the same number
   * instead of guessing.
   *
   * It replaced an optional `excluding` parameter on `stagedBytes` — which the adapter
   * accepted and silently ignored, because TypeScript lets an implementation declare
   * fewer parameters than its interface. A named method cannot be ignored that way.
   */
  stagedBytesOf(eventId: EventId, clipJobId: ClipJobId): Promise<number>

  /**
   * The source digests this event still has staged, as lower-case hex.
   *
   * The queue half of what the reconciliation sweep needs, and the counterpart of
   * `PhotoRepository.listReferencedDigests`. Asked per event rather than per object for
   * the same reason: one seek per digest, on the connection serving uploads and the
   * projector, to re-confirm what was referenced last pass too.
   *
   * Only jobs that still hold their bytes — `holdsStagedBytes` is the rule — so a `done`
   * job that gave its source back, and a `failed` one that is not coming for it, are
   * both absent and both collectable.
   */
  listStagedSources(eventId: EventId): Promise<ReadonlySet<string>>
}

/** What a staging insert is judged against, taken inside its own transaction. */
export interface ClipAdmissionLimits {
  /** `events.quota_bytes`. The event's photos **and** its staged sources may not pass it. */
  readonly quotaBytes: number
  /** How many clips may be waiting or running across the whole box. Process-wide. */
  readonly maxQueuedClips: number
}

/**
 * Why a staged clip was not admitted, with the numbers observed at the moment of the
 * decision — so the guest is told about the state that actually refused it rather than
 * the one the request read a moment earlier.
 */
export type ClipRefusal =
  | { readonly reason: 'quotaExceeded'; readonly remaining: number }
  | { readonly reason: 'queueFull'; readonly depth: number }

export interface ClipAdmission {
  /** `null` when the row was inserted. */
  readonly refusal: ClipRefusal | null
}

export interface ClipJobRepository extends StagedByteSource {
  findById(eventId: EventId, clipJobId: ClipJobId): Promise<ClipJob | null>

  /**
   * The idempotency check, and the reason the job carries the digest of the *source*.
   *
   * A guest on venue Wi-Fi whose upload times out and retries sends the same bytes
   * again. Without this the box transcodes the same fifteen seconds twice and the wall
   * shows the clip twice. It is deliberately a different index from
   * `photos (event_id, content_hash)`: that one addresses the stored output, and the
   * source is never what is stored.
   *
   * **Answers only with a job that still blocks a fresh attempt** — `queued`, `running`
   * or `done`, which is exactly what the unique index covers. A `failed` row is
   * invisible here, and that is the point: `event.quotaExceeded` and
   * `event.photoLimitReached` are permanent verdicts about the *album*, not about the
   * bytes, and an album empties. While terminal rows were visible, a clip refused late
   * in the evening could never be sent again — the host deleted fifty photographs, the
   * guest re-uploaded, and the dedupe answered with the failed row for ever. No route
   * retries or deletes a clip job, so nothing could clear it.
   *
   * A `done` row still blocks, because its photo exists; the caller confirms that, since
   * a deleted photo is the one case the status cannot express.
   */
  findBySourceHash(eventId: EventId, sourceHash: ContentHash): Promise<ClipJob | null>

  /**
   * Admit a freshly staged clip to the queue, **deciding the limits inside the same
   * transaction as the insert**.
   *
   * This is `saveManyWithinLimits`'s counterpart and it exists for the same reason. The
   * upload path reads the queue depth, then the byte total, then writes — three calls
   * with `await`s between them — so two uploads in flight both saw room that only one of
   * them had, and both committed. The overshoot was bounded by the queue depth rather
   * than by the quota, which is not what `docs/SECURITY.md` says the quota is.
   *
   * What the repository contributes is the one thing a use case cannot: taking the count
   * and the sum where nothing can interleave. The rules themselves are still the domain's
   * — the caller passes them in, and `clipQueue.ts` words the refusal.
   *
   * ## It **raises** on a second job for bytes this event already holds
   *
   * A refusal and a raise mean different things here, and the difference is load-bearing.
   * A {@link ClipRefusal} is a verdict about room. A raise from the unique index on
   * `(event_id, source_hash)` is not a failure at all: it says those bytes are already in
   * this event's queue, which is the same fact {@link ClipJobRepository.findBySourceHash}
   * reports — just observed a moment later, because the caller's earlier look and this
   * insert are separated by an `await` and a write of up to `MAX_CLIP_BYTES`. Two guests
   * sending the same video from the group chat land exactly there.
   *
   * **A caller must therefore re-read `findBySourceHash` after a raise and answer with
   * the job it finds, rather than reporting a failure — and must not delete the staged
   * media, because the digest it would delete by is the winner's.** Getting that wrong
   * destroys the surviving job's source; `clip.sourceMissing` is permanent, so the
   * terminal row then dedupes every later upload of those bytes onto itself and the
   * video is unrecoverable. Every other raise is a genuine storage failure.
   */
  stage(job: ClipJob, limits: ClipAdmissionLimits): Promise<ClipAdmission>

  /**
   * Write a job's state. **Update-only**, and it answers whether the row was still there.
   *
   * Every production caller is a transition of a row that already exists — the worker's
   * two post-claim writes, and the upload's `reserved` to `queued`. None of them wants an
   * insert, and update-or-insert here was a resurrection waiting to happen: `deletePhoto`
   * retires a clip's job while the worker may still be holding that `ClipJob`, so the
   * write either re-inserted a `done` row naming a photo that no longer exists, or — once
   * the guest had re-uploaded, which is now legal — collided with the fresh row on the
   * partial unique index and threw out of the worker, leaving the *first* job `running`
   * for ever with its source never released.
   *
   * `false` means the job is gone. That is not an error: a guest deleting their own clip
   * mid-transcode is an ordinary thing to do, and the caller's remaining work is simply
   * moot.
   *
   * Inserting is {@link ClipJobRepository.stage}'s job and nothing else's.
   */
  save(job: ClipJob): Promise<boolean>

  /**
   * Retire the job that produced this photo, if there was one.
   *
   * Idempotent, and a no-op for a photograph — `deletePhoto` calls it for every row and
   * does not have to know which kind it is holding.
   *
   * It exists because a `done` job blocks the dedupe: a guest who deletes their own clip
   * by mistake and sends it again was answered `duplicate: true`, `status: done`, and a
   * `photoId` for a row that no longer existed. The clip never came back, and nothing in
   * the product could make it. Deleting the job rather than marking it failed is the
   * honest shape — the clip is gone, and the record of how it was made is about a thing
   * that no longer exists.
   */
  deleteForPhoto(eventId: EventId, photoId: PhotoId): Promise<void>

  /**
   * Delete reservations older than `olderThan`, and say which they were.
   *
   * A `reserved` row is the moment between "this upload is admitted" and "its bytes are
   * on the disk" — a local `writeFile`, because multer has already streamed the upload to
   * a temporary file. One that outlives that window belonged to a request that died, and
   * it is holding **three** things it should not:
   *
   * 1. a charge against the event's quota, for bytes that may not exist — and the quota
   *    spans `photos`, so the album's own room shrinks with it;
   * 2. one of `MAX_QUEUED_CLIPS` **global** slots, which is the one that wedges a box:
   *    twenty of these and every clip upload on the machine is a `429` that never clears;
   * 3. that digest, through the partial unique index, so the guest's own retry is deduped
   *    onto a job that will never move.
   *
   * **Deleted rather than failed.** Nothing was ever transcoded, so there is nothing to
   * tell a guest about, and a `failed` row would go on answering their poll about a clip
   * that never existed.
   *
   * **The caller must not delete the bytes**, and the rows come back for reporting rather
   * than for that. The delete happens inside a transaction, so any unlink necessarily
   * follows the commit — and by then the digest is free, the guest's re-upload may have
   * reserved it, and the unlink would take *its* source. `sweepOrphanedMedia` asks the
   * database and re-checks immediately before unlinking, which is the race-free answer to
   * the same question.
   */
  deleteStaleReservations(olderThan: Date): Promise<readonly ClipJob[]>

  /**
   * Take the oldest job that is due, marking it `running` in the **same transaction** as
   * the read.
   *
   * Reading and then writing through two calls would be the quota race in a new costume:
   * a second worker — or a second container during a rolling restart — reads the same
   * `queued` row and both run ffmpeg against the same output path. The transition itself
   * is still `ClipJob.claim`'s decision; what the repository contributes is the one thing
   * a use case cannot, which is taking it where nothing can interleave.
   *
   * `null` when nothing is due, which is the ordinary answer: the queue is empty most of
   * an evening.
   */
  claimNext(now: Date): Promise<ClipJob | null>

  /**
   * Every job left `running` by a process that is no longer running, put back.
   *
   * This is the whole of crash recovery. A `running` row at startup means the container
   * was restarted mid-transcode; the job goes back on the queue with no backoff, or is
   * given up on if it has spent its attempts (`ClipJob.recover`). Runs in one
   * transaction, and answers with the jobs it touched so the worker can report them.
   */
  recoverAbandoned(now: Date): Promise<readonly ClipJob[]>

  /**
   * How many clips are waiting or being worked on, across every event.
   *
   * Drives backpressure. Process-wide rather than per event because the wait a guest
   * actually experiences is the global one — see `src/domain/clips/clipQueue.ts`.
   */
  countActive(): Promise<number>
}
