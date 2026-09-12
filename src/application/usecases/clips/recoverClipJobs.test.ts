import { beforeEach, describe, expect, it } from 'vitest'
import { MAX_ATTEMPTS } from '../../../domain/clips/clipFailure'
import { asClipJobId, asEventId } from '../../../domain/shared/ids'
import type { LogContext, Logger } from '../../ports/logger'
import { AT, aClipJob, atPlus } from '../../testing/builders'
import { FakeClipJobRepository } from '../../testing/fakeClipJobRepository'
import { FakeClock } from '../../testing/fakeClock'
import { InMemoryMediaStore } from '../../testing/inMemoryMediaStore'
import { makeRecoverClipJobs, type RecoverClipJobs } from './recoverClipJobs'

const EVENT = asEventId('event-1')

class CapturingLogger implements Logger {
  readonly lines: { level: string; message: string }[] = []

  debug(message: string): void {
    this.lines.push({ level: 'debug', message })
  }

  info(message: string): void {
    this.lines.push({ level: 'info', message })
  }

  warn(message: string): void {
    this.lines.push({ level: 'warn', message })
  }

  error(message: string): void {
    this.lines.push({ level: 'error', message })
  }

  child(_bindings: LogContext): Logger {
    return this
  }
}

describe('recoverClipJobs', () => {
  let clips: FakeClipJobRepository
  let media: InMemoryMediaStore
  let clock: FakeClock
  let logger: CapturingLogger
  let recoverClipJobs: RecoverClipJobs

  beforeEach(() => {
    clips = new FakeClipJobRepository()
    media = new InMemoryMediaStore()
    clock = new FakeClock(atPlus(120_000))
    logger = new CapturingLogger()
    recoverClipJobs = makeRecoverClipJobs({ clips, media, clock, logger })
  })

  /** Stages a job's source the way `uploadClip` would: the bytes, then the row. */
  const stage = async (job: ReturnType<typeof aClipJob>): Promise<void> => {
    await media.put(job.eventId, job.sourceHash, 'source', Uint8Array.of(1, 2, 3))
    await clips.save(job)
  }

  it('puts back a clip the previous process was holding', async () => {
    // A `running` row at boot cannot mean anything else: one worker drains this queue at
    // concurrency 1, so there is no other claimant to wait for.
    clips.seed(aClipJob({ id: 'job-1', eventId: 'event-1', status: 'running' }))

    const report = await recoverClipJobs()

    expect(report).toEqual({ requeued: 1, abandoned: 0 })
    expect((await clips.findById(EVENT, asClipJobId('job-1')))?.status).toBe('queued')
  })

  it('makes the recovered clip claimable at once, because the guest already waited', async () => {
    clips.seed(aClipJob({ id: 'job-1', eventId: 'event-1', status: 'running' }))

    await recoverClipJobs()

    expect((await clips.claimNext(clock.now()))?.id).toBe('job-1')
  })

  it('gives up on a clip that has already spent every attempt it is allowed', async () => {
    // A file that takes the process down with it would otherwise cost a boot forever.
    clips.seed(
      aClipJob({ id: 'job-1', eventId: 'event-1', status: 'running', attempts: MAX_ATTEMPTS }),
    )

    const report = await recoverClipJobs()

    expect(report).toEqual({ requeued: 0, abandoned: 1 })
    expect((await clips.findById(EVENT, asClipJobId('job-1')))?.failureCode).toBe('clip.abandoned')
  })

  it('releases the staged source of a clip it gives up on', async () => {
    // The row stops charging those bytes the moment it is `failed`, so leaving them on
    // the disk is up to MAX_CLIP_BYTES of a guest's un-stripped original — GPS atom and
    // all — charged to nothing and named by nothing.
    const job = aClipJob({
      id: 'job-1',
      eventId: 'event-1',
      status: 'running',
      attempts: MAX_ATTEMPTS,
    })
    await stage(job)

    await recoverClipJobs()

    expect(await media.exists(EVENT, job.sourceHash, 'source')).toBe(false)
    expect(await clips.stagedBytes(EVENT)).toBe(0)
  })

  it('keeps the staged source of a clip it put back, because the retry needs it', async () => {
    const job = aClipJob({ id: 'job-1', eventId: 'event-1', status: 'running' })
    await stage(job)

    await recoverClipJobs()

    expect(await media.exists(EVENT, job.sourceHash, 'source')).toBe(true)
  })

  it('leaves a queue that was already tidy alone, and says nothing about it', async () => {
    clips.seed(
      aClipJob({ id: 'job-1', eventId: 'event-1', status: 'queued' }),
      aClipJob({ id: 'job-2', eventId: 'event-1', status: 'done' }),
    )

    const report = await recoverClipJobs()

    expect(report).toEqual({ requeued: 0, abandoned: 0 })
    expect(logger.lines).toEqual([])
  })

  it('records that a restart interrupted work, which is the only trace of it', async () => {
    clips.seed(aClipJob({ id: 'job-1', eventId: 'event-1', status: 'running' }))

    await recoverClipJobs()

    expect(logger.lines.map((line) => line.level)).toEqual(['info'])
  })

  it('reads the clock rather than the wall clock, so the report is assertable', async () => {
    clips.seed(aClipJob({ id: 'job-1', eventId: 'event-1', status: 'running', createdAt: AT }))

    await recoverClipJobs()

    expect((await clips.findById(EVENT, asClipJobId('job-1')))?.updatedAt).toEqual(atPlus(120_000))
  })
})
