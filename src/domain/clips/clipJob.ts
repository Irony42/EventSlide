import type { Caption } from '../photos/caption'
import type { ContentHash } from '../photos/contentHash'
import type { PhotoActor, PhotoAuthor } from '../photos/photo'
import { DomainError } from '../shared/errors'
import type { ClipJobId, EventId, PhotoId } from '../shared/ids'
import { err, ok, type Result } from '../shared/result'
import { MAX_ATTEMPTS, classifyClipFailure, retryDelayMs, shouldRetry } from './clipFailure'
import { canTransition, type ClipJobStatus } from './clipJobStatus'

/**
 * A clip that has been staged and is waiting for, or undergoing, a transcode.
 *
 * **This is the aggregate that makes "a transcoding clip reached the wall" impossible to
 * write down.** A clip in flight has no `photos` row; it has one of these. The row that
 * the wall, the moderation queue, the album and the quota all read is created only when
 * the transcode has succeeded — which is the same ordering guest photo ingest already
 * uses, media before row, for the same reason: 1.0 inserted first and a failure left a
 * row pointing at nothing.
 *
 * Two fields carry most of the design:
 *
 * - **`sourceHash` is not a `ContentHash` of stored bytes in the sense `photos` uses.**
 *   It is the digest of what the guest uploaded, and it exists so that the same fifteen
 *   seconds re-sent after venue Wi-Fi dropped is recognised as the same job instead of
 *   transcoded twice. It is deliberately **not** in `photos (event_id, content_hash)`:
 *   that index addresses what is on the disk under the photo's name, and the source is
 *   never what is stored.
 * - **`photoId` is minted here, at staging, not when the transcode finishes.** A crash
 *   between "the photo row was inserted" and "the job was marked done" would otherwise be
 *   unrecoverable: the retry would mint a second id and either duplicate the row or
 *   orphan the first. With the id fixed up front, recovery is a lookup — if the row is
 *   already there, the work is done and only the bookkeeping is missing.
 */

export interface NewClipJob {
  readonly eventId: EventId
  readonly author: PhotoAuthor
  readonly sourceHash: ContentHash
  readonly sourceByteSize: number
  readonly caption: Caption | null
}

export interface ClipJobProps {
  readonly id: ClipJobId
  readonly eventId: EventId
  readonly author: PhotoAuthor
  /** The id the `photos` row will carry. Fixed at staging; see the class note. */
  readonly photoId: PhotoId
  readonly status: ClipJobStatus
  readonly sourceHash: ContentHash
  readonly sourceByteSize: number
  readonly caption: Caption | null
  /** How many times the worker has claimed this job. */
  readonly attempts: number
  readonly createdAt: Date
  readonly updatedAt: Date
  /** The retry ladder: a queued job is not claimable before this instant. */
  readonly notBefore: Date
  /** The `DomainError.code` that ended it, for a `failed` job. */
  readonly failureCode: string | null
}

/** What a job that was left `running` by a process that died is given up on as. */
export const ABANDONED_CODE = 'clip.abandoned'

export class ClipJob {
  private constructor(private readonly props: ClipJobProps) {}

  /**
   * A freshly staged clip. Queued immediately and claimable at once: the guest is
   * standing in the room, and the only thing between them and the wall is this queue.
   */
  static create(
    input: NewClipJob,
    id: ClipJobId,
    photoId: PhotoId,
    now: Date,
  ): Result<ClipJob, DomainError> {
    if (!Number.isInteger(input.sourceByteSize) || input.sourceByteSize <= 0) {
      // The staged bytes are charged to the event's quota from this moment, so a size
      // that is not a positive whole number would charge the event nothing at all.
      return err(DomainError.invalid('clip.sourceByteSizeInvalid'))
    }

    return ok(
      new ClipJob({
        id,
        eventId: input.eventId,
        author: input.author,
        photoId,
        status: 'queued',
        sourceHash: input.sourceHash,
        sourceByteSize: input.sourceByteSize,
        caption: input.caption,
        attempts: 0,
        createdAt: now,
        updatedAt: now,
        notBefore: now,
        failureCode: null,
      }),
    )
  }

  /** Rehydrate from a row. Trusts it, as `Photo.restore` does and for the same reason. */
  static restore(props: ClipJobProps): ClipJob {
    return new ClipJob(props)
  }

  get id(): ClipJobId {
    return this.props.id
  }

  get eventId(): EventId {
    return this.props.eventId
  }

  get author(): PhotoAuthor {
    return this.props.author
  }

  get photoId(): PhotoId {
    return this.props.photoId
  }

  get status(): ClipJobStatus {
    return this.props.status
  }

  get sourceHash(): ContentHash {
    return this.props.sourceHash
  }

  get sourceByteSize(): number {
    return this.props.sourceByteSize
  }

  get caption(): Caption | null {
    return this.props.caption
  }

  get attempts(): number {
    return this.props.attempts
  }

  get createdAt(): Date {
    return this.props.createdAt
  }

  get updatedAt(): Date {
    return this.props.updatedAt
  }

  get notBefore(): Date {
    return this.props.notBefore
  }

  get failureCode(): string | null {
    return this.props.failureCode
  }

  /**
   * Whether this is the caller's own clip.
   *
   * The same rule `Photo.isAuthoredBy` applies, and it has to be here too: between the
   * upload and the transcode there is no photo to ask, and "where is my clip" is the one
   * question a guest has during that window. A host may look at any of them.
   */
  isAuthoredBy(actor: PhotoActor): boolean {
    if (actor.kind === 'guest') {
      return this.props.author.kind === 'guest' && this.props.author.guestId === actor.guestId
    }
    return this.props.author.kind === 'host' && this.props.author.userId === actor.userId
  }

  /** Claimable now: queued, and past its backoff. */
  isDue(now: Date): boolean {
    return this.props.status === 'queued' && this.props.notBefore.getTime() <= now.getTime()
  }

  /**
   * The worker takes it.
   *
   * `attempts` is incremented **here**, not on failure, which is what makes a job that
   * takes the process down with it count against the ladder — a file that segfaults a
   * decoder would otherwise be claimed forever, each crash costing a boot.
   */
  claim(now: Date): Result<ClipJob, DomainError> {
    return this.moveTo('running', now, {
      attempts: this.props.attempts + 1,
    })
  }

  /** The photo row exists. Nothing else will happen to this job. */
  succeed(now: Date): Result<ClipJob, DomainError> {
    return this.moveTo('done', now, { failureCode: null })
  }

  /**
   * The attempt did not produce a photo.
   *
   * Whether it comes back is {@link classifyClipFailure}'s decision, taken from the
   * `DomainError.code` the transcoder or the write transaction answered with, and never
   * from how bad the failure felt at the call site.
   */
  fail(code: string, now: Date): Result<ClipJob, DomainError> {
    if (!shouldRetry(classifyClipFailure(code), this.props.attempts)) {
      return this.moveTo('failed', now, { failureCode: code })
    }
    return this.moveTo('queued', now, {
      failureCode: code,
      notBefore: new Date(now.getTime() + retryDelayMs(this.props.attempts)),
    })
  }

  /**
   * Crash recovery, run at startup on every row still marked `running`.
   *
   * A `running` job with no process behind it is the normal consequence of a container
   * restart mid-transcode, so it goes back on the queue — immediately, with no backoff,
   * because the guest has already waited once. What it must not do is loop: a clip that
   * has spent its attempts is given up on here rather than being handed to the next boot.
   */
  recover(now: Date): Result<ClipJob, DomainError> {
    if (this.props.attempts >= MAX_ATTEMPTS) {
      return this.moveTo('failed', now, { failureCode: ABANDONED_CODE })
    }
    return this.moveTo('queued', now, { notBefore: now })
  }

  /** Snapshot for a repository to map into a row. */
  toProps(): ClipJobProps {
    return this.props
  }

  /** The single gate for every status change, as `Photo.transitionTo` is for a photo. */
  private moveTo(
    next: ClipJobStatus,
    now: Date,
    changes: Partial<ClipJobProps>,
  ): Result<ClipJob, DomainError> {
    if (!canTransition(this.props.status, next)) {
      return err(
        DomainError.conflict('clipJob.illegalTransition', {
          from: this.props.status,
          to: next,
        }),
      )
    }
    return ok(new ClipJob({ ...this.props, ...changes, status: next, updatedAt: now }))
  }
}
