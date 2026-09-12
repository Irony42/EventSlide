import type { ClipJob } from '../../domain/clips/clipJob'
import type { ContentHash } from '../../domain/photos/contentHash'
import type { ClipJobId, EventId } from '../../domain/shared/ids'

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
  /** Bytes of sources still staged for one event: the `queued` and `running` jobs. */
  stagedBytes(eventId: EventId): Promise<number>
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
   */
  stage(job: ClipJob, limits: ClipAdmissionLimits): Promise<ClipAdmission>

  /**
   * Write a job's state: the worker's transitions, and nothing that has to be judged.
   *
   * Update-or-insert, because a transition is idempotent and a retry of one must not
   * raise. It is deliberately **not** the upload path's door: an insert that skipped
   * {@link ClipJobRepository.stage} would be a staged source charged to nothing.
   */
  save(job: ClipJob): Promise<void>

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
