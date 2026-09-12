import type { ClipJob } from '../../domain/clips/clipJob'
import { holdsStagedBytes } from '../../domain/clips/clipJobStatus'
import type { ContentHash } from '../../domain/photos/contentHash'
import type { ClipJobId, EventId } from '../../domain/shared/ids'
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

  seed(...jobs: readonly ClipJob[]): this {
    for (const job of jobs) this.rows.set(this.key(job.eventId, job.id), job)
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
    return (
      [...this.rows.values()].find(
        (job) => job.eventId === eventId && job.sourceHash.equals(sourceHash),
      ) ?? null
    )
  }

  async save(job: ClipJob): Promise<void> {
    this.rows.set(this.key(job.eventId, job.id), job)
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
    if (depth >= limits.maxQueuedClips) return { refusal: { reason: 'queueFull', depth } }

    const used = photoBytes + this.stagedBytesNow(job.eventId)
    if (used + job.sourceByteSize > limits.quotaBytes) {
      return { refusal: { reason: 'quotaExceeded', remaining: Math.max(0, limits.quotaBytes - used) } }
    }

    this.rows.set(this.key(job.eventId, job.id), job)
    return { refusal: null }
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

    await this.save(claimed.value)
    return claimed.value
  }

  async recoverAbandoned(now: Date): Promise<readonly ClipJob[]> {
    const recovered: ClipJob[] = []
    for (const job of [...this.rows.values()]) {
      if (job.status !== 'running') continue

      const next = job.recover(now)
      if (!next.ok) throw new Error(`clip job ${job.id} could not be recovered`)
      await this.save(next.value)
      recovered.push(next.value)
    }
    return recovered
  }

  async stagedBytes(eventId: EventId): Promise<number> {
    return this.stagedBytesNow(eventId)
  }

  async countActive(): Promise<number> {
    return this.activeNow()
  }
}
