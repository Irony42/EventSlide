import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createChannelWorker, type ChannelWorkerDeps } from './channelWorker'
import { CapturingLogger } from '../application/testing/capturingLogger'
import { FakeClock } from '../application/testing/fakeClock'
import { RecordingEventBus } from '../application/testing/recordingEventBus'
import type { DrainOutcome } from '../application/usecases/channels/drainChannelMedia'
import { asEventId } from '../domain/shared/ids'

/**
 * The drain loop, driven from a test. `src/main` is out of the coverage gate, so what the composition adds around
 * `drainChannelMedia` is asserted here: it drains until idle, one at a time, wakes on the bus, recovers before the
 * first pass, sweeps at most once an hour, and aborts a download at shutdown.
 */

const INTERVAL_MS = 30_000
const AT = new Date('2026-09-11T20:00:00.000Z')

const queueOf = (...outcomes: readonly DrainOutcome[]) => {
  const pending = [...outcomes]
  const state = {
    calls: 0,
    signals: [] as AbortSignal[],
    take: async (signal: AbortSignal): Promise<DrainOutcome> => {
      state.calls += 1
      state.signals.push(signal)
      return pending.shift() ?? 'idle'
    },
  }
  return state
}

const build = (overrides: Partial<ChannelWorkerDeps> = {}) => {
  const clock = new FakeClock(AT)
  const bus = new RecordingEventBus()
  const logger = new CapturingLogger()
  const sweeps = { count: 0 }
  const worker = createChannelWorker({
    drainOne: async () => 'idle',
    recover: async () => 0,
    sweep: async () => {
      sweeps.count += 1
      return 0
    },
    bus,
    logger,
    clock,
    intervalMs: INTERVAL_MS,
    ...overrides,
  })
  return { worker, clock, bus, logger, sweeps }
}

const flush = async (): Promise<void> => {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('channelWorker', () => {
  it('drains until the queue is idle and reports what happened', async () => {
    const queue = queueOf('stored', 'duplicate', 'refused', 'stored')
    const { worker } = build({ drainOne: queue.take })

    const outcome = await worker.runOnce()

    expect(outcome).toEqual({
      status: 'completed',
      report: { stored: 2, duplicate: 1, refused: 1, retry: 0, skipped: 0 },
    })
    expect(queue.calls).toBe(5)
  })

  it('yields after maxPerDrain, so a refilled queue cannot hold the loop', async () => {
    const queue = queueOf('stored', 'stored', 'stored', 'stored')
    const { worker } = build({ drainOne: queue.take, maxPerDrain: 2 })

    await worker.runOnce()

    expect(queue.calls).toBe(2)
  })

  it('never runs two drains at once', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let calls = 0
    const { worker } = build({
      drainOne: async () => {
        calls += 1
        await gate
        return 'idle'
      },
    })

    const first = worker.runOnce()
    const second = await worker.runOnce()
    release()
    await first

    expect(second).toEqual({ status: 'skipped' })
    expect(calls).toBe(1)
  })

  it('recovers before its first drain, and still drains if recovery fails', async () => {
    const order: string[] = []
    const { worker, logger } = build({
      recover: async () => {
        order.push('recover')
        throw new Error('database is locked')
      },
      drainOne: async () => {
        order.push('drain')
        return 'idle'
      },
    })

    worker.start()
    await flush()
    worker.stop()

    expect(order).toEqual(['recover', 'drain'])
    expect(logger.lines.some((line) => line.level === 'error')).toBe(true)
  })

  it('wakes on a queued media, on nothing else, and on the tick as a backstop', async () => {
    const queue = queueOf()
    const { worker, bus } = build({ drainOne: queue.take })
    worker.start()
    await flush()
    const afterStart = queue.calls

    bus.publish({ type: 'photo.uploaded', eventId: asEventId('e') } as never)
    await flush()
    expect(queue.calls).toBe(afterStart)

    bus.publish({ type: 'channel.mediaQueued', eventId: asEventId('e') })
    await flush()
    expect(queue.calls).toBe(afterStart + 1)

    await vi.advanceTimersByTimeAsync(INTERVAL_MS)
    expect(queue.calls).toBe(afterStart + 2)
    worker.stop()
  })

  it('stops listening and ticking when stopped, and aborts the signal a download holds', async () => {
    const queue = queueOf()
    const { worker, bus } = build({ drainOne: queue.take })
    worker.start()
    await flush()
    const calls = queue.calls
    const signal = queue.signals[0]

    worker.stop()
    bus.publish({ type: 'channel.mediaQueued', eventId: asEventId('e') })
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3)

    expect(queue.calls).toBe(calls)
    expect(signal?.aborted).toBe(true)
  })

  it('sweeps the finished jobs at most once an hour', async () => {
    const { worker, clock, sweeps } = build()

    await worker.runOnce()
    await worker.runOnce()
    expect(sweeps.count).toBe(1)

    clock.advance(59 * 60_000)
    await worker.runOnce()
    expect(sweeps.count).toBe(1)

    clock.advance(2 * 60_000)
    await worker.runOnce()
    expect(sweeps.count).toBe(2)
  })

  it('is idempotent to start twice and to stop twice', async () => {
    const queue = queueOf()
    const { worker } = build({ drainOne: queue.take })

    worker.start()
    worker.start()
    await flush()
    worker.stop()
    worker.stop()

    expect(queue.calls).toBe(1)
  })

  it('survives a drain that throws, and says so', async () => {
    const { worker, logger } = build({
      drainOne: async () => {
        throw new Error('disk gone')
      },
    })

    const outcome = await worker.runOnce()

    expect(outcome.status).toBe('failed')
    expect(logger.lines.some((line) => line.message === 'channel drain failed')).toBe(true)
  })
})
