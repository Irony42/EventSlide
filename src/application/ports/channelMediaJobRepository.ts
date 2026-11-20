import type { ChannelKind } from '../../domain/channels/channelKind'
import type { ChannelMedia } from '../../domain/channels/inboundMessage'
import type { ChannelBindingId, ChannelMediaJobId, EventId } from '../../domain/shared/ids'

/**
 * The queue between "a message arrived" and "the photograph is stored" (spec 27 §5).
 *
 * Receiving a message only writes a row here and answers; one worker takes the rows one at a time,
 * downloads, stores and acknowledges. So the poller stays fast, a crash loses nothing (a `running` row is
 * put back at start), and an update delivered twice is taken once: a job is unique per
 * (channel, conversation, message).
 *
 * Like `ClipJobRepository`, the worker's reads (`claimNext`, `recoverAbandoned`, `deleteFinishedBefore`)
 * ask "what is due, anywhere on this box" because there is one worker for the process; none is reachable
 * from a route. The reads a request could reach (`countPending`, `deleteBySender`) take the event first.
 */

export type ChannelMediaJobStatus = 'queued' | 'running' | 'done' | 'failed'

export interface ChannelMediaJob {
  readonly id: ChannelMediaJobId
  readonly eventId: EventId
  readonly bindingId: ChannelBindingId
  readonly channel: ChannelKind
  readonly conversationRef: string
  readonly messageRef: string
  /** The sender's fingerprint (never the channel's identifier). */
  readonly senderKey: string
  /** What the channel shows for the sender, kept only until the job is processed, then `null`. */
  readonly senderName: string | null
  readonly kind: ChannelMedia['kind']
  readonly fileRef: string
  readonly declaredBytes: number | null
  readonly durationMs: number | null
  readonly declaredName: string
  readonly declaredMimeType: string | null
  readonly status: ChannelMediaJobStatus
  /** Why a `failed` job failed: a stable code, never a message. */
  readonly failureCode: string | null
  /** How many times a worker has taken it and given it back. */
  readonly attempts: number
  readonly createdAt: Date
  /** The earliest instant a worker may take it: a retry waits. */
  readonly availableAt: Date
  readonly updatedAt: Date
}

/** What the receiving side writes: a job is born `queued`, untried, available at once. */
export type NewChannelMediaJob = Omit<
  ChannelMediaJob,
  'status' | 'failureCode' | 'attempts' | 'availableAt' | 'updatedAt'
>

export type ChannelJobOutcome =
  { readonly status: 'done' } | { readonly status: 'failed'; readonly failureCode: string }

export interface ChannelMediaJobRepository {
  /**
   * Add a job unless the same message is already there, in any state. `'duplicate'` is the answer to
   * an update delivered twice, and to a message whose job was already processed.
   */
  enqueue(job: NewChannelMediaJob): Promise<'queued' | 'duplicate'>

  /** Scoped by event, for the tests and the host's own reads. */
  findById(eventId: EventId, jobId: ChannelMediaJobId): Promise<ChannelMediaJob | null>

  /**
   * The oldest job that is `queued` and available at `now`, taken: it becomes `running` and its
   * `updatedAt` is `now`. `null` when nothing is due.
   */
  claimNext(now: Date): Promise<ChannelMediaJob | null>

  /**
   * Every job left `running` by a process that is no longer running, put back to `queued` with its
   * attempts unchanged. Run once at start: there is one worker, so a `running` row then is abandoned.
   * Answers how many.
   */
  recoverAbandoned(now: Date): Promise<number>

  /** A taken job that failed for a reason worth another try: back to `queued`, one more attempt, waiting until `availableAt`. */
  retryLater(jobId: ChannelMediaJobId, now: Date, availableAt: Date): Promise<void>

  /** A taken job is over, and the sender's name is forgotten with it. */
  finish(jobId: ChannelMediaJobId, outcome: ChannelJobOutcome, now: Date): Promise<void>

  /** Jobs of an event that are `queued` or `running`: what the per-event ceiling counts. */
  countPending(eventId: EventId): Promise<number>

  /**
   * What one sender still has on its way at one event, taken back by `/forget`: the jobs `queued` or `running` are deleted
   * (answers how many). The finished ones stay as **the record of messages already taken** (an update redelivered after
   * the erasure must not be stored again) but are made anonymous: their sender key and name are emptied.
   */
  deleteBySender(eventId: EventId, senderKey: string): Promise<number>

  /** Jobs `done` or `failed` and not touched since `cutoff` are removed. Answers how many. */
  deleteFinishedBefore(cutoff: Date): Promise<number>
}
