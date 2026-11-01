import type { StorageRefusal } from '../../domain/events/admission'
import type { ContentHash } from '../../domain/photos/contentHash'
import type { ReelJob, ReelOutput } from '../../domain/highlights/reelJob'
import type { EventId, PhotoId } from '../../domain/shared/ids'
import type { ClientByteLimit } from './clientRepository'

/**
 * The reel's half of the byte quota (spec 08): the montage's file is on the event's disk, so
 * `MediaStore.usedBytes` and the database sum must agree on it. The SQLite adapter reads
 * `highlight_reels` inside the same statement as its other sums (`eventHoldingBytesSum`);
 * `FakePhotoRepository` is handed this to stay honest about the same arithmetic.
 */
export interface ReelByteSource {
  /** What the event's one reel file is charged: a `done` row, or a `stale` one not yet deleted. */
  reelBytes(eventId: EventId): Promise<number>
}

/** The ceilings a request is judged against, in the transaction that writes it. */
export interface ReelAdmissionLimits {
  readonly quotaBytes: number
  /** The client's ceiling over every one of its events, or `null`. */
  readonly clientBytes: ClientByteLimit | null
  /** The most a montage may weigh: the room that must be left, estimated prudently. */
  readonly reservedBytes: number
  /** Queued and running montages the box accepts together (`MAX_QUEUED_REELS`). */
  readonly maxQueued: number
}

export type ReelRefusal =
  | StorageRefusal
  | { readonly reason: 'alreadyRunning' }
  | { readonly reason: 'queueFull'; readonly depth: number; readonly maxDepth: number }

export interface ReelAdmission {
  /** `null` when the request was written. */
  readonly refusal: ReelRefusal | null
  /**
   * The file the request replaced, whose bytes the quota stopped counting in the same write.
   * The caller deletes it: the row no longer names it.
   */
  readonly replacedOutput: ContentHash | null
}

/** What the final write of a render decided. */
export type ReelFinish =
  | { readonly kind: 'done' }
  /** A photograph of the montage left the evening, or the row was made stale, while it rendered. */
  | { readonly kind: 'stale' }
  | { readonly kind: 'refused'; readonly refusal: StorageRefusal }
  /** The row is gone: the event was purged while the montage rendered. */
  | { readonly kind: 'gone' }

export interface ReelInvalidation {
  /** Whether a live montage was spoiled by this. */
  readonly staled: boolean
  /** Its file, when it had one: the caller deletes it, then clears the row's claim on it. */
  readonly output: ContentHash | null
}

export interface ReelRepository extends ReelByteSource {
  /** The event's one row. Scoped by event, like every read in the port. */
  findByEvent(eventId: EventId): Promise<ReelJob | null>

  /**
   * Writes a request (a new row, or the event's one row put back to `queued`), after judging the
   * limits **in the same write transaction**: not already active, the box's queue not full, and
   * room for `reservedBytes` once the replaced file is no longer counted.
   */
  request(job: ReelJob, limits: ReelAdmissionLimits): Promise<ReelAdmission>

  /** The oldest due queued row, claimed in one atomic step (`ReelJob.claim`). */
  claimNext(now: Date): Promise<ReelJob | null>

  /**
   * Plain write of a job this process holds (a failure, a retry, a stale judgement). Applies only
   * to a row still `running`: `false` when the row is gone or an invalidation already made it
   * stale, so a late failure never brings a spoiled montage back to the queue.
   */
  save(job: ReelJob): Promise<boolean>

  /**
   * The final write of a render: in one transaction, the row must still be `running`, **every**
   * photograph of its snapshot must still be eligible (published, a photograph, not taken
   * down), and the file must fit what the event and its client may hold. Then, and only then,
   * the row is `done` with its output.
   */
  finish(job: ReelJob, output: ReelOutput, limits: ReelFinishLimits, now: Date): Promise<ReelFinish>

  /**
   * Makes the event's reel stale if it holds any of these photographs and is not already
   * past use, in one transaction. The row keeps naming its file until `clearOutput`.
   */
  invalidate(eventId: EventId, photoIds: readonly PhotoId[], now: Date): Promise<ReelInvalidation>

  /** The row stops claiming a file that has been deleted. Scoped by event and by digest. */
  clearOutput(eventId: EventId, hash: ContentHash): Promise<void>

  /** Rows `running` when the process died, back to the queue. */
  recoverAbandoned(now: Date): Promise<number>

  /** Stale rows still naming a file, for the boot sweep: a crash between the two steps leaves one. */
  listStaleOutputs(): Promise<readonly { readonly eventId: EventId; readonly hash: ContentHash }[]>

  /** The file this event's row names, as lower-case hex, for the orphan sweep. */
  listReferencedDigests(eventId: EventId): Promise<ReadonlySet<string>>

  /** Queued and running rows across the box. */
  countActive(): Promise<number>
}

export interface ReelFinishLimits {
  readonly quotaBytes: number
  readonly clientBytes: ClientByteLimit | null
}
