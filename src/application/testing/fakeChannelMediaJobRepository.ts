import type { ChannelMediaJobId, EventId } from '../../domain/shared/ids'
import type {
  ChannelJobOutcome,
  ChannelMediaJob,
  ChannelMediaJobRepository,
  NewChannelMediaJob,
} from '../ports/channelMediaJobRepository'
import { compareIds } from './ordering'

const messageKey = (job: Pick<ChannelMediaJob, 'channel' | 'conversationRef' | 'messageRef'>) =>
  `${job.channel}\n${job.conversationRef}\n${job.messageRef}`

/** In-memory `ChannelMediaJobRepository`, with the adapter's uniqueness per message and its transitions. */
export class FakeChannelMediaJobRepository implements ChannelMediaJobRepository {
  private readonly rows = new Map<string, ChannelMediaJob>()

  async enqueue(job: NewChannelMediaJob): Promise<'queued' | 'duplicate'> {
    const key = messageKey(job)
    if ([...this.rows.values()].some((row) => messageKey(row) === key)) return 'duplicate'
    this.rows.set(job.id, {
      ...job,
      status: 'queued',
      failureCode: null,
      attempts: 0,
      availableAt: job.createdAt,
      updatedAt: job.createdAt,
    })
    return 'queued'
  }

  async findById(eventId: EventId, jobId: ChannelMediaJobId): Promise<ChannelMediaJob | null> {
    const stored = this.rows.get(jobId)
    return stored !== undefined && stored.eventId === eventId ? stored : null
  }

  async claimNext(now: Date): Promise<ChannelMediaJob | null> {
    const due = [...this.rows.values()]
      .filter((job) => job.status === 'queued' && job.availableAt.getTime() <= now.getTime())
      .sort(
        (left, right) =>
          left.availableAt.getTime() - right.availableAt.getTime() || compareIds(left.id, right.id),
      )[0]
    if (due === undefined) return null
    const taken: ChannelMediaJob = { ...due, status: 'running', updatedAt: now }
    this.rows.set(due.id, taken)
    return taken
  }

  async recoverAbandoned(now: Date): Promise<number> {
    let recovered = 0
    for (const [id, job] of this.rows) {
      if (job.status !== 'running') continue
      this.rows.set(id, { ...job, status: 'queued', attempts: job.attempts + 1, updatedAt: now })
      recovered += 1
    }
    return recovered
  }

  async retryLater(jobId: ChannelMediaJobId, now: Date, availableAt: Date): Promise<void> {
    const job = this.rows.get(jobId)
    if (job === undefined || job.status !== 'running') return
    this.rows.set(jobId, {
      ...job,
      status: 'queued',
      attempts: job.attempts + 1,
      availableAt,
      updatedAt: now,
    })
  }

  async finish(jobId: ChannelMediaJobId, outcome: ChannelJobOutcome, now: Date): Promise<void> {
    const job = this.rows.get(jobId)
    if (job === undefined || job.status !== 'running') return
    this.rows.set(jobId, {
      ...job,
      status: outcome.status,
      failureCode: outcome.status === 'failed' ? outcome.failureCode : null,
      senderName: null,
      updatedAt: now,
    })
  }

  async countPending(eventId: EventId): Promise<number> {
    return [...this.rows.values()].filter(
      (job) => job.eventId === eventId && (job.status === 'queued' || job.status === 'running'),
    ).length
  }

  async deleteBySender(eventId: EventId, senderKey: string): Promise<number> {
    return this.deleteWhere((job) => job.eventId === eventId && job.senderKey === senderKey)
  }

  async deleteFinishedBefore(cutoff: Date): Promise<number> {
    return this.deleteWhere(
      (job) =>
        (job.status === 'done' || job.status === 'failed') &&
        job.updatedAt.getTime() < cutoff.getTime(),
    )
  }

  /** What `ON DELETE CASCADE` does when the event is purged. */
  removeEvent(eventId: EventId): void {
    this.deleteWhere((job) => job.eventId === eventId)
  }

  private deleteWhere(matches: (job: ChannelMediaJob) => boolean): number {
    let removed = 0
    for (const [id, job] of this.rows) {
      if (!matches(job)) continue
      this.rows.delete(id)
      removed += 1
    }
    return removed
  }
}
