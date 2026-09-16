import type { ClipJob } from '../../domain/clips/clipJob'
import { blocksReupload, holdsStagedBytes } from '../../domain/clips/clipJobStatus'
import { admitsAnotherClip } from '../../domain/clips/clipQueue'
import type { ContentHash } from '../../domain/photos/contentHash'
import type { ClipJobId, EventId, PhotoId } from '../../domain/shared/ids'
import type {
  ClipAdmission,
  ClipAdmissionLimits,
  ClipJobRepository,
} from '../ports/clipJobRepository'

/**
 * The other half of an event's byte total, seen from the queue's side.
 *
 * `FakePhotoRepository` asks this fake for the staged bytes; staging has to ask it back
 * for the photographs, because the quota is one number over two tables and the SQLite
 * adapter reads both in a single statement. Deliberately **not** `totalBytes`: that one
 * already includes the queue, and staging needs the halves apart so the queue's half can
 * be re-read with no suspension point in the way.
 */
export interface PhotoByteSource {
  photoBytes(eventId: EventId): Promise<number>
}

/**
 * The transcode queue, in memory.
 *
 * Keyed by `${eventId}:${clipJobId}`, for the same reason `FakePhotoRepository` is: a
 * lookup with the wrong event genuinely misses, so a cross-tenant bug fails a ring-2 test
 * instead of passing because a stub returned what it was told.
 *
 * `claimNext` and `recoverAbandoned` deliberately run across every event, because the
 * production worker does — there is one queue for the box. That is the one place in this
 * fake where a key is not consulted, and it matches the SQLite adapter exactly.
 */
export class FakeClipJobRepository implements ClipJobRepository {
  private readonly rows = new Map<string, ClipJob>()

  private key(eventId: EventId, clipJobId: ClipJobId): string {
    return `${eventId}:${clipJobId}`
  }

  /**
   * Seed fixtures. Enforces the same uniqueness `save` and `stage` do: a fixture with two
   * jobs for the same bytes in one event is a broken fixture, and letting it through
   * would make the test that follows prove nothing.
   */
  seed(...jobs: readonly ClipJob[]): this {
    for (const job of jobs) this.insertOrUpdate(job)
    return this
  }

  /** Everything held, newest last. For a test asserting on the queue as a whole. */
  get all(): readonly ClipJob[] {
    return [...this.rows.values()]
  }

  async findById(eventId: EventId, clipJobId: ClipJobId): Promise<ClipJob | null> {
    return this.rows.get(this.key(eventId, clipJobId)) ?? null
  }

  async findBySourceHash(eventId: EventId, sourceHash: ContentHash): Promise<ClipJob | null> {
    // Only a job that still blocks a fresh attempt, exactly as the adapter's partial
    // unique index covers. A `failed` row is invisible here: it is a verdict about the
    // album, not about the bytes, and an album empties.
    return (
      [...this.rows.values()].find(
        (job) =>
          job.eventId === eventId &&
          blocksReupload(job.status) &&
          job.sourceHash.equals(sourceHash),
      ) ?? null
    )
  }

  async deleteForPhoto(eventId: EventId, photoId: PhotoId): Promise<void> {
    for (const [key, job] of this.rows) {
      if (job.eventId === eventId && job.photoId === photoId) this.rows.delete(key)
    }
  }

  /**
   * `CREATE UNIQUE INDEX idx_clip_jobs_event_source ON clip_jobs (event_id, source_hash)`,
   * in a `Map`.
   *
   * A fake that quietly accepted a second job for the same bytes is how the worst defect
   * on this branch reached a review: the upload path checks `findBySourceHash`, then
   * writes up to eighty megabytes, then inserts — and two guests sending the same video
   * from the group chat both pass the check. Only the index refuses the second, so a fake
   * that does not refuse it cannot reproduce what production does, and every ring-2 test
   * about the race was green against a repository that does not exist.
   *
   * Scoped per event, exactly as the index is: two events each own their copy of the same
   * fifteen seconds.
   */
  private conflictOf(job: ClipJob): ClipJob | null {
    // Partial, exactly as the index is: it covers only the statuses that block a
    // re-upload, so a `failed` row neither occupies a slot nor is refused one. Without
    // that a clip refused for a full album could never be sent again.
    if (!blocksReupload(job.status)) return null
    return (
      [...this.rows.values()].find(
        (held) =>
          held.eventId === job.eventId &&
          held.id !== job.id &&
          blocksReupload(held.status) &&
          held.sourceHash.equals(job.sourceHash),
      ) ?? null
    )
  }

  private insertOrUpdate(job: ClipJob): void {
    const conflict = this.conflictOf(job)
    if (conflict !== null) {
      // The adapter's message, near enough that a caller matching on it behaves the same
      // against both. What a caller must not do is read it as "the write failed".
      throw new Error(
        `UNIQUE constraint failed: clip_jobs.event_id, clip_jobs.source_hash (job ${conflict.id} already holds those bytes)`,
      )
    }
    this.rows.set(this.key(job.eventId, job.id), job)
  }

  async save(job: ClipJob): Promise<boolean> {
    // Update-only, as the adapter is. See the port: a write that re-inserted a job
    // `deletePhoto` had retired would resurrect a clip the guest deleted.
    const key = this.key(job.eventId, job.id)
    if (!this.rows.has(key)) return false
    this.rows.set(key, job)
    return true
  }

  /**
   * Bytes of this event's `photos` rows, which this fake cannot see on its own.
   *
   * A test that is only about the queue leaves it unwired and is judged against the
   * queue alone — which is exactly what an event with no photographs is charged.
   */
  private photos: PhotoByteSource | null = null

  chargePhotoBytesFrom(source: PhotoByteSource): this {
    this.photos = source
    return this
  }

  /** The sum the adapter takes in SQL, taken here with no suspension point in it. */
  private stagedBytesNow(eventId: EventId): number {
    return [...this.rows.values()]
      .filter((job) => job.eventId === eventId && holdsStagedBytes(job.status))
      .reduce((total, job) => total + job.sourceByteSize, 0)
  }

  private activeNow(): number {
    return [...this.rows.values()].filter((job) => holdsStagedBytes(job.status)).length
  }

  /**
   * Count, sum, decide and insert, with nothing able to interleave.
   *
   * The adapter gets that from one SQLite transaction; here it comes from the leading
   * `await` being the only one in the method. That is the whole point of the method
   * existing: the use case used to read the depth, then the byte total, then write, so
   * two guests uploading at the same moment both saw room only one of them had.
   *
   * The photographs are fetched **first and once**, because they are the half no clip
   * upload changes. The queue's half is re-read below with no `await` in front of it, so
   * a concurrent staging that has already committed is seen by this one.
   */
  async stage(job: ClipJob, limits: ClipAdmissionLimits): Promise<ClipAdmission> {
    const photoBytes = (await this.photos?.photoBytes(job.eventId)) ?? 0

    const depth = this.activeNow()
    if (!admitsAnotherClip(depth, limits.maxQueuedClips)) {
      return { refusal: { reason: 'queueFull', depth } }
    }

    const used = photoBytes + this.stagedBytesNow(job.eventId)
    if (used + job.sourceByteSize > limits.quotaBytes) {
      return {
        refusal: { reason: 'quotaExceeded', remaining: Math.max(0, limits.quotaBytes - used) },
      }
    }

    // Raises on a duplicate source, as the index does. See `insertOrUpdate`: the caller
    // has to tell that apart from a failure, and the port says so.
    this.insertOrUpdate(job)
    return { refusal: null }
  }

  async deleteStaleReservations(olderThan: Date): Promise<readonly ClipJob[]> {
    const stale = [...this.rows.values()]
      .filter((job) => job.status === 'reserved' && job.createdAt.getTime() <= olderThan.getTime())
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())

    for (const job of stale) this.rows.delete(this.key(job.eventId, job.id))
    return stale
  }

  async claimNext(now: Date): Promise<ClipJob | null> {
    const due = [...this.rows.values()]
      .filter((job) => job.isDue(now))
      // Oldest first, ties broken by id so two runs agree — the same total order the
      // adapter's index gives.
      .sort(
        (left, right) =>
          left.notBefore.getTime() - right.notBefore.getTime() ||
          left.createdAt.getTime() - right.createdAt.getTime() ||
          left.id.localeCompare(right.id),
      )

    const next = due[0]
    if (next === undefined) return null

    const claimed = next.claim(now)
    // Unreachable: `isDue` already proved the row is queued. Throwing rather than
    // returning null keeps a real transition bug from reading as an empty queue.
    if (!claimed.ok) throw new Error(`clip job ${next.id} could not be claimed`)

    this.rows.set(this.key(claimed.value.eventId, claimed.value.id), claimed.value)
    return claimed.value
  }

  async recoverAbandoned(now: Date): Promise<readonly ClipJob[]> {
    const recovered: ClipJob[] = []
    for (const job of [...this.rows.values()]) {
      if (job.status !== 'running') continue

      const next = job.recover(now)
      if (!next.ok) throw new Error(`clip job ${job.id} could not be recovered`)
      this.rows.set(this.key(next.value.eventId, next.value.id), next.value)
      recovered.push(next.value)
    }
    return recovered
  }

  async stagedBytes(eventId: EventId): Promise<number> {
    return this.stagedBytesNow(eventId)
  }

  async stagedBytesOf(eventId: EventId, clipJobId: ClipJobId): Promise<number> {
    const job = this.rows.get(this.key(eventId, clipJobId))
    return job !== undefined && holdsStagedBytes(job.status) ? job.sourceByteSize : 0
  }

  async listStagedSources(eventId: EventId): Promise<ReadonlySet<string>> {
    return new Set(
      [...this.rows.values()]
        .filter((job) => job.eventId === eventId && holdsStagedBytes(job.status))
        .map((job) => job.sourceHash.value),
    )
  }

  async countActive(): Promise<number> {
    return this.activeNow()
  }
}
