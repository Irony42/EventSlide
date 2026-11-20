import type { ChannelMediaJobRepository } from '../../ports/channelMediaJobRepository'
import type { Clock } from '../../ports/clock'

/**
 * Forget the jobs that are over (spec 27 §5): a job `done` or `failed` is a record of a message nobody needs
 * after a day, and it holds a conversation's and a message's references. The window is long enough for a replayed
 * update (Telegram redelivers inside the day it was sent) to be recognised as taken, short enough that nothing
 * lingers. Run by the worker's repeater; answers how many it removed, for the log.
 */
export const CHANNEL_JOB_RETENTION_MS = 24 * 60 * 60 * 1000

export interface SweepChannelJobsDeps {
  readonly jobs: ChannelMediaJobRepository
  readonly clock: Clock
}

export type SweepChannelJobs = () => Promise<number>

export const makeSweepChannelJobs =
  ({ jobs, clock }: SweepChannelJobsDeps): SweepChannelJobs =>
  async () =>
    jobs.deleteFinishedBefore(new Date(clock.now().getTime() - CHANNEL_JOB_RETENTION_MS))
