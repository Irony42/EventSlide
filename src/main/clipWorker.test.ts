import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClipWorker, type ClipWorkerDeps } from './clipWorker'
import { FakeClock } from '../application/testing/fakeClock'
import { RecordingEventBus } from '../application/testing/recordingEventBus'
import { asClipJobId, asEventId, asPhotoId } from '../domain/shared/ids'
import { DomainError } from '../domain/shared/errors'
import { ok, type Result } from '../domain/shared/result'
import type { LogContext, Logger } from '../application/ports/logger'
import type { RecoverClipJobsReport } from '../application/usecases/clips/recoverClipJobs'
import type { TranscodeNextClipOutcome } from '../application/usecases/clips/transcodeNextClip'

/**
 * The drain loop, driven from a test.
 *
 * `src/main` is excluded from the coverage gates — it is wiring, and the gate would only
 * measure how much of `container.ts` a test happened to execute. That exclusion is
 * exactly why this file is explicit: nothing else fails if the worker stops draining,
 * runs two encoders at once, never recovers a job a crash left behind, or holds the
 * process open at `docker stop`. The symptom of the first is a guest watching "en cours
 * de traitement" for the rest of the evening.
 *
 * What a pass decides — which failures come back, how long the backoff is, whether a clip
 * fits the quota — is `transcodeNextClip`'s own tests' business. This asserts only what
 * the composition root adds around it.
 */

const INTERVAL_MS = 15_000
const AT = new Date('2026-09-11T20:00:00.000Z')

const EVENT = asEventId('evt-wedding')

interface LoggedLine {
  readonly level: string
  readonly message: string
}

const recordingLogger = (): { logger: Logger; lines: LoggedLine[] } => {
  const lines: LoggedLine[] = []
  const at = (level: string) => (message: string) => {
    lines.push({ level, message })
  }
  const logger: Logger = {
    debug: at('debug'),
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
    child: (_bindings: LogContext): Logger => logger,
  }
  return { logger, lines }
}

const transcoded = (id: string): TranscodeNextClipOutcome => ({
  kind: 'transcoded',
  clipJobId: asClipJobId(id),
  eventId: EVENT,
  photoId: asPhotoId(`${id}-photo`),
  recovered: false,
})

const failed = (id: string): TranscodeNextClipOutcome => ({
  kind: 'failed',
  clipJobId: asClipJobId(id),
  eventId: EVENT,
  code: 'clip.noVideoStream',
  willRetry: false,
})

const IDLE: TranscodeNextClipOutcome = { kind: 'idle' }

/**
 * A queue as a list of outcomes, handed out one at a time and `idle` once it is empty.
 *
 * `calls` is what the overlap assertions read: two drains running at once would take two
 * jobs from it at once, which is the single thing this module exists to prevent.
 */
const queueOf = (...outcomes: readonly TranscodeNextClipOutcome[]) => {
  const pending = [...outcomes]
  const state = {
    calls: 0,
    take: async (): Promise<Result<TranscodeNextClipOutcome, DomainError>> => {
      state.calls += 1
      return ok(pending.shift() ?? IDLE)
    },
  }
  return state
}

const noRecovery = async (): Promise<RecoverClipJobsReport> => ({ requeued: 0, abandoned: 0 })

const build = (overrides: Partial<ClipWorkerDeps> = {}) => {
  const clock = new FakeClock(AT)
  const bus = new RecordingEventBus()
  const { logger, lines } = recordingLogger()

  const worker = createClipWorker({
    transcodeNext: async () => ok(IDLE),
    recover: noRecovery,
    bus,
    logger,
    clock,
    intervalMs: INTERVAL_MS,
    ...overrides,
  })

  return { worker, bus, clock, lines }
}

describe('clipWorker', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('runOnce', () => {
    it('drains the queue rather than taking one clip per pass', async () => {
      // Ten guests filming the first dance is the normal case, and one clip per interval
      // is a queue that never empties.
      const queue = queueOf(transcoded('a'), transcoded('b'), transcoded('c'))
      const { worker } = build({ transcodeNext: queue.take })

      const outcome = await worker.runOnce()

      expect(outcome.status).toBe('completed')
      expect(outcome.status === 'completed' && outcome.report).toEqual({
        transcoded: 3,
        failed: 0,
      })
    })

    it('stops as soon as nothing is due, without a spin', async () => {
      const queue = queueOf(transcoded('a'))
      const { worker } = build({ transcodeNext: queue.take })

      await worker.runOnce()

      // One taking the clip, one learning the queue is empty. Never more.
      expect(queue.calls).toBe(2)
    })

    it('counts what failed as well as what landed', async () => {
      const queue = queueOf(transcoded('a'), failed('b'))
      const { worker } = build({ transcodeNext: queue.take })

      const outcome = await worker.runOnce()

      expect(outcome.status === 'completed' && outcome.report).toEqual({
        transcoded: 1,
        failed: 1,
      })
    })

    it('answers an empty queue without saying anything', async () => {
      // Every fifteen seconds, all evening. "Nothing was due" is not news.
      const { worker, lines } = build()

      await worker.runOnce()

      expect(lines).toEqual([])
    })

    it('never runs two drains at once', async () => {
      // Two drains would each claim a job — the claim is atomic, so they would not fight
      // over one — and then run two encoders on a box whose whole design assumes one.
      let release: (() => void) | undefined
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      let calls = 0
      const { worker } = build({
        transcodeNext: async () => {
          calls += 1
          await held
          return ok(IDLE)
        },
      })

      const first = worker.runOnce()
      const second = await worker.runOnce()

      expect(second.status).toBe('skipped')
      expect(calls).toBe(1)
      release?.()
      await first
    })

    it('runs again once the previous drain has finished', async () => {
      const queue = queueOf(transcoded('a'))
      const { worker } = build({ transcodeNext: queue.take })

      await worker.runOnce()
      const second = await worker.runOnce()

      expect(second.status).toBe('completed')
    })

    it('survives a pass that rejects, rather than taking the process down', async () => {
      // An unhandled rejection from a timer callback is fatal in `index.ts`, and losing
      // the server because one clip could not be read would be far worse than a skipped
      // drain.
      const { worker, lines } = build({
        transcodeNext: async () => {
          throw new Error('database is locked')
        },
      })

      const outcome = await worker.runOnce()

      expect(outcome.status).toBe('failed')
      expect(lines.some((line) => line.level === 'error')).toBe(true)
    })

    it('survives a pass that throws before it returns a promise', async () => {
      const { worker } = build({
        transcodeNext: (): never => {
          throw new Error('thrown synchronously')
        },
      })

      await expect(worker.runOnce()).resolves.toEqual(expect.objectContaining({ status: 'failed' }))
    })

    it('stops the drain when a pass answers with a refusal rather than an outcome', async () => {
      // A `Result` failure means a repository handed back something impossible. The next
      // pass meets the same row, so hammering it would fill a log instead of a queue.
      let calls = 0
      const { worker, lines } = build({
        transcodeNext: async () => {
          calls += 1
          return { ok: false as const, error: DomainError.conflict('clipJob.illegalTransition') }
        },
      })

      await worker.runOnce()

      expect(calls).toBe(1)
      expect(lines.some((line) => line.level === 'error')).toBe(true)
    })

    it('yields after a bounded number of clips, so shutdown can interrupt it', async () => {
      const queue = queueOf(
        ...Array.from({ length: 10 }, (_unused, index) => transcoded(`c${index}`)),
      )
      const { worker } = build({ transcodeNext: queue.take, maxPerDrain: 2 })

      const outcome = await worker.runOnce()

      expect(outcome.status === 'completed' && outcome.report.transcoded).toBe(2)
    })
  })

  describe('start', () => {
    it('recovers interrupted jobs and drains immediately, not one interval from now', async () => {
      // The opposite of the two sweeps, deliberately: a restart that leaves a guest's
      // clip in a queue for an interval has lost their clip for that long, and a row
      // still marked `running` is invisible to everything until this puts it back.
      const recovered: string[] = []
      const queue = queueOf(transcoded('a'))
      const { worker } = build({
        transcodeNext: queue.take,
        recover: async () => {
          recovered.push('recovered')
          return { requeued: 1, abandoned: 0 }
        },
      })

      worker.start()
      await vi.advanceTimersByTimeAsync(0)

      expect(recovered).toEqual(['recovered'])
      expect(queue.calls).toBeGreaterThan(0)
      worker.stop()
    })

    it('drains anyway when recovery itself fails', async () => {
      // An unrecovered job is picked up at the next boot; refusing to start the worker
      // over it would strand every *new* clip as well.
      const queue = queueOf(transcoded('a'))
      const { worker, lines } = build({
        transcodeNext: queue.take,
        recover: async () => {
          throw new Error('database is locked')
        },
      })

      worker.start()
      await vi.advanceTimersByTimeAsync(0)

      expect(lines.some((line) => line.level === 'error')).toBe(true)
      expect(queue.calls).toBeGreaterThan(0)
      worker.stop()
    })

    it('wakes on a staged clip rather than waiting for the next tick', async () => {
      // A clip uploaded at 22:03 must not wait for a timer sized for an idle evening.
      const queue = queueOf(transcoded('a'))
      const { worker, bus } = build({ transcodeNext: queue.take })
      worker.start()
      await vi.advanceTimersByTimeAsync(0)
      const before = queue.calls

      bus.publish({ type: 'clip.queued', eventId: EVENT, clipJobId: asClipJobId('a') })
      await vi.advanceTimersByTimeAsync(0)

      expect(queue.calls).toBeGreaterThan(before)
      worker.stop()
    })

    it('ignores every other fact on the bus', async () => {
      const queue = queueOf()
      const { worker, bus } = build({ transcodeNext: queue.take })
      worker.start()
      await vi.advanceTimersByTimeAsync(0)
      const before = queue.calls

      bus.publish({ type: 'photo.uploaded', eventId: EVENT, photoId: asPhotoId('p1') })
      await vi.advanceTimersByTimeAsync(0)

      expect(queue.calls).toBe(before)
      worker.stop()
    })

    it('keeps draining on a tick, as the backstop for an announcement nobody heard', async () => {
      const queue = queueOf()
      const { worker } = build({ transcodeNext: queue.take })
      worker.start()
      await vi.advanceTimersByTimeAsync(0)
      const before = queue.calls

      await vi.advanceTimersByTimeAsync(INTERVAL_MS)

      expect(queue.calls).toBeGreaterThan(before)
      worker.stop()
    })

    it('is idempotent, so a second start leaves one timer and one subscription', async () => {
      // The observable half is the subscription: a second listener on the bus would be a
      // second drain attempt per upload, and `stop()` releases only the one it holds — so
      // the leak would outlive the worker.
      const queue = queueOf()
      const { worker, bus } = build({ transcodeNext: queue.take })

      worker.start()
      worker.start()
      await vi.advanceTimersByTimeAsync(0)

      expect(bus.globalSubscriberCount()).toBe(1)

      worker.stop()
      expect(bus.globalSubscriberCount()).toBe(0)
    })
  })

  describe('stop', () => {
    it('stops the timer', async () => {
      const queue = queueOf()
      const { worker } = build({ transcodeNext: queue.take })
      worker.start()
      await vi.advanceTimersByTimeAsync(0)
      worker.stop()
      const after = queue.calls

      await vi.advanceTimersByTimeAsync(INTERVAL_MS * 5)

      expect(queue.calls).toBe(after)
    })

    it('stops listening to the bus', async () => {
      const queue = queueOf()
      const { worker, bus } = build({ transcodeNext: queue.take })
      worker.start()
      await vi.advanceTimersByTimeAsync(0)
      worker.stop()
      const after = queue.calls

      bus.publish({ type: 'clip.queued', eventId: EVENT, clipJobId: asClipJobId('a') })
      await vi.advanceTimersByTimeAsync(0)

      expect(queue.calls).toBe(after)
      expect(bus.globalSubscriberCount()).toBe(0)
    })

    it('says so when a transcode was in flight, and does not wait for it', async () => {
      // Safe to abandon: the clip being encoded is `running`, so the next boot's recovery
      // puts it back. What is *not* left to chance is the encoder process itself, which
      // the transcoder's own `close()` kills from `container.dispose()`.
      let release: (() => void) | undefined
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      const { worker, lines } = build({
        transcodeNext: async () => {
          await held
          return ok(IDLE)
        },
      })

      const running = worker.runOnce()
      worker.stop()

      expect(lines.some((line) => line.level === 'warn')).toBe(true)
      release?.()
      await running
    })

    it('is idempotent, and safe before start', () => {
      const { worker } = build()

      expect(() => {
        worker.stop()
        worker.stop()
      }).not.toThrow()
    })
  })
})
