import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAlbumExportWorker, type AlbumExportWorkerDeps } from './exportWorker'
import { FakeClock } from '../application/testing/fakeClock'
import { RecordingEventBus } from '../application/testing/recordingEventBus'
import { CapturingLogger } from '../application/testing/capturingLogger'
import { asEventId } from '../domain/shared/ids'
import type { BuildNextAlbumExportOutcome } from '../application/usecases/exports/buildNextAlbumExport'

const EVENT = asEventId('evt-wedding')
const sealed: BuildNextAlbumExportOutcome = {
  kind: 'sealed',
  eventId: EVENT,
  entries: 3,
  skipped: 0,
  bytes: 100,
}
const failed: BuildNextAlbumExportOutcome = { kind: 'failed', eventId: EVENT, code: 'noRoom' }

const queueOf = (...outcomes: BuildNextAlbumExportOutcome[]) => {
  const pending = [...outcomes]
  const state = {
    calls: 0,
    signals: [] as (AbortSignal | undefined)[],
    take: async (signal?: AbortSignal): Promise<BuildNextAlbumExportOutcome> => {
      state.calls += 1
      state.signals.push(signal)
      return pending.shift() ?? { kind: 'idle' }
    },
  }
  return state
}

const build = (overrides: Partial<AlbumExportWorkerDeps> = {}) => {
  const bus = new RecordingEventBus()
  const logger = new CapturingLogger()
  const counters = { recovered: 0, swept: 0 }
  const worker = createAlbumExportWorker({
    buildNext: async () => ({ kind: 'idle' }),
    recover: async () => {
      counters.recovered += 1
      return { requeued: 0 }
    },
    sweep: async () => {
      counters.swept += 1
      return { expired: 0, missing: 0, orphans: 0, temporaries: 0 }
    },
    bus,
    logger,
    clock: new FakeClock(new Date('2026-09-11T20:00:00.000Z')),
    intervalMs: 15_000,
    ...overrides,
  })
  return { worker, bus, counters, lines: logger.lines }
}

describe('exportWorker', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('drains the queue, counts sealed and failed archives, and sweeps after the drain', async () => {
    const queue = queueOf(sealed, failed, sealed)
    const { worker, counters } = build({ buildNext: queue.take })

    const outcome = await worker.runOnce()

    expect(outcome.status === 'completed' && outcome.report).toEqual({ sealed: 2, failed: 1 })
    expect(queue.calls).toBe(4)
    expect(counters.swept).toBe(1)
  })

  it('stops a drain at the bound', async () => {
    const queue = queueOf(sealed, sealed, sealed, sealed)
    const { worker } = build({ buildNext: queue.take, maxPerDrain: 2 })

    await worker.runOnce()

    expect(queue.calls).toBe(2)
  })

  it('yields when an archive waits behind a video transcode, leaving it to the next tick', async () => {
    const queue = queueOf({ kind: 'waiting' }, sealed)
    const { worker } = build({ buildNext: queue.take })

    await worker.runOnce()

    expect(queue.calls).toBe(1)
  })

  it('never runs two writes at once', async () => {
    let release: () => void = () => undefined
    const slow = vi.fn(
      () =>
        new Promise<BuildNextAlbumExportOutcome>(
          (resolve) => (release = () => resolve({ kind: 'idle' })),
        ),
    )
    const { worker } = build({ buildNext: slow })

    const first = worker.runOnce()
    const second = await worker.runOnce()
    release()
    await first

    expect(second.status).toBe('skipped')
    expect(slow).toHaveBeenCalledTimes(1)
  })

  it('answers a failing drain with a log line, never a rejection', async () => {
    const { worker, lines } = build({
      buildNext: async () => {
        throw new Error('database closed')
      },
    })

    const outcome = await worker.runOnce()

    expect(outcome.status).toBe('failed')
    expect(lines.some((line) => line.message === 'archive drain failed')).toBe(true)
  })

  it('recovers once at start, then drains at once, on an export.changed announcement and on the tick', async () => {
    const queue = queueOf()
    const { worker, bus, counters } = build({ buildNext: queue.take })

    worker.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(counters.recovered).toBe(1)
    expect(queue.calls).toBe(1)

    bus.publish({ type: 'export.changed', eventId: EVENT })
    await vi.advanceTimersByTimeAsync(0)
    expect(queue.calls).toBe(2)

    bus.publish({ type: 'photo.published', eventId: EVENT } as never)
    await vi.advanceTimersByTimeAsync(0)
    expect(queue.calls).toBe(2)

    await vi.advanceTimersByTimeAsync(15_000)
    expect(queue.calls).toBe(3)
    expect(counters.recovered).toBe(1)
    worker.stop()
  })

  it('starts the drain even when recovery throws', async () => {
    const queue = queueOf()
    const { worker, lines } = build({
      buildNext: queue.take,
      recover: async () => {
        throw new Error('locked')
      },
    })

    worker.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(queue.calls).toBe(1)
    expect(lines.some((line) => line.message.includes('could not recover'))).toBe(true)
    worker.stop()
  })

  it('on stop, raises the abort signal, unsubscribes and stops the timer', async () => {
    const queue = queueOf()
    const { worker, bus } = build({ buildNext: queue.take })
    worker.start()
    await vi.advanceTimersByTimeAsync(0)

    worker.stop()
    bus.publish({ type: 'export.changed', eventId: EVENT })
    await vi.advanceTimersByTimeAsync(60_000)

    expect(queue.signals[0]?.aborted).toBe(true)
    expect(queue.calls).toBe(1)
  })
})
