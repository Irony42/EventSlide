import type { ContentHash } from '../photos/contentHash'
import { DomainError } from '../shared/errors'
import type { EventId, PhotoId, ReelId } from '../shared/ids'
import { err, ok, type Result } from '../shared/result'
import { classifyReelFailure, reelRetryDelayMs, shouldRetryReel } from './reelFailure'
import { canTransition, type ReelStatus } from './reelStatus'

/** The finished file: what a `done` reel carries and what the quota counts. */
export interface ReelOutput {
  readonly hash: ContentHash
  readonly byteSize: number
  readonly durationMs: number
}

export interface ReelJobProps {
  readonly id: ReelId
  readonly eventId: EventId
  readonly status: ReelStatus
  /** The montage's order, frozen when it was asked for: favourites starred later are not taken. */
  readonly photoIds: readonly PhotoId[]
  readonly attempts: number
  readonly notBefore: Date
  readonly failureCode: string | null
  /** The file, while there is one: also kept on a `stale` row until the file is deleted. */
  readonly output: ReelOutput | null
  readonly createdAt: Date
  readonly updatedAt: Date
}

/**
 * One event's highlight reel: the request, its retries, and the file it became (spec 08).
 *
 * An immutable value, like `ClipJob`. There is one per event: `rerequest` puts a finished,
 * failed or stale one back in the queue under the same id, with a fresh snapshot, and drops the
 * old output from the row so the quota stops counting it before the new montage is made.
 */
export class ReelJob {
  private constructor(private readonly props: ReelJobProps) {}

  static request(
    input: {
      readonly id: ReelId
      readonly eventId: EventId
      readonly photoIds: readonly PhotoId[]
    },
    now: Date,
  ): ReelJob {
    return new ReelJob({
      id: input.id,
      eventId: input.eventId,
      status: 'queued',
      photoIds: input.photoIds,
      attempts: 0,
      notBefore: now,
      failureCode: null,
      output: null,
      createdAt: now,
      updatedAt: now,
    })
  }

  static restore(props: ReelJobProps): ReelJob {
    return new ReelJob(props)
  }

  get id(): ReelId {
    return this.props.id
  }
  get eventId(): EventId {
    return this.props.eventId
  }
  get status(): ReelStatus {
    return this.props.status
  }
  get photoIds(): readonly PhotoId[] {
    return this.props.photoIds
  }
  get attempts(): number {
    return this.props.attempts
  }
  get notBefore(): Date {
    return this.props.notBefore
  }
  get failureCode(): string | null {
    return this.props.failureCode
  }
  get output(): ReelOutput | null {
    return this.props.output
  }
  get createdAt(): Date {
    return this.props.createdAt
  }
  get updatedAt(): Date {
    return this.props.updatedAt
  }

  toProps(): ReelJobProps {
    return this.props
  }

  /** Whether this photograph is part of the montage. A membership test in memory, never a JSON query. */
  includes(photoId: PhotoId): boolean {
    return this.props.photoIds.includes(photoId)
  }

  private move(
    next: ReelStatus,
    changes: Partial<ReelJobProps>,
    now: Date,
  ): Result<ReelJob, DomainError> {
    if (!canTransition(this.props.status, next)) {
      return err(
        DomainError.conflict('reel.illegalTransition', { from: this.props.status, to: next }),
      )
    }
    return ok(new ReelJob({ ...this.props, status: next, updatedAt: now, ...changes }))
  }

  /** The worker takes it: one more attempt. */
  claim(now: Date): Result<ReelJob, DomainError> {
    return this.move('running', { attempts: this.props.attempts + 1 }, now)
  }

  /** A process died holding it: back to the queue, the attempt it spent counted. */
  recover(now: Date): Result<ReelJob, DomainError> {
    return this.move('queued', { notBefore: now }, now)
  }

  succeed(output: ReelOutput, now: Date): Result<ReelJob, DomainError> {
    return this.move('done', { output, failureCode: null }, now)
  }

  /** Back to the queue after a transient failure, or terminal. The row says which. */
  fail(code: string, now: Date): Result<ReelJob, DomainError> {
    const kind = classifyReelFailure(code)
    if (shouldRetryReel(kind, this.props.attempts)) {
      return this.move(
        'queued',
        {
          failureCode: code,
          notBefore: new Date(now.getTime() + reelRetryDelayMs(this.props.attempts)),
        },
        now,
      )
    }
    return this.move('failed', { failureCode: code }, now)
  }

  /** A photograph left the evening. The output, if any, stays on the row until its file is gone. */
  makeStale(now: Date): Result<ReelJob, DomainError> {
    return this.move('stale', {}, now)
  }

  /** The file is deleted: the row stops claiming its bytes. */
  withoutOutput(now: Date): ReelJob {
    return new ReelJob({ ...this.props, output: null, updatedAt: now })
  }

  /** The host asks for a new montage on the event's one row. */
  rerequest(photoIds: readonly PhotoId[], now: Date): Result<ReelJob, DomainError> {
    return this.move(
      'queued',
      { photoIds, attempts: 0, notBefore: now, failureCode: null, output: null },
      now,
    )
  }
}
