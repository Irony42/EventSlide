import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createReservationReaper, type ReservationReaperDeps } from './reservationReaper'
import { FakeClipJobRepository } from '../application/testing/fakeClipJobRepository'
import { FakeClock } from '../application/testing/fakeClock'
import { aClipJob } from '../application/testing/builders'
import { makeReapStaleReservations } from '../application/usecases/clips/reapStaleReservations'
import type {
  ReapStaleReservations,
  ReapStaleReservationsReport,
} from '../application/usecases/clips/reapStaleReservations'
import { asClipJobId, asEventId } from '../domain/shared/ids'
import type { LogContext, Logger } from '../application/ports/logger'

/**
 * The schedule behind the reservation reaper — which is the whole of the defect it was
 * written for.
 *
 * The use case was correct and had one caller: crash recovery, which runs **once, at
 * process start**. So a box OOM-killed mid-upload came back seconds later, asked for
 * reservations older than five minutes, found a ten-second-old one, skipped it — and
 * never asked again. That row then charged its event for bytes that do not exist, held a
 * global queue slot, and answered its guest `202` about a job that would never move, for
 * the rest of the evening.
 *
 * `src/main` is excluded from the coverage gates, which is exactly why this file is
 * explicit: nothing else fails when a timer is missing.
 */

const AT = new Date('2026-09-11T20:00:00.000Z')
const TIMEOUT_MS = 5 * 60 * 1000
const EVENT = asEventId('event-1')

const nothingReaped: ReapStaleReservationsReport = { reaped: 0 }

interface LoggedLine {
  readonly level: 'debug' | 'info' | 'warn' | 'error'
  readonly message: string
  readonly context: LogContext | undefined
}

const recordingLogger = (): { logger: Logger; lines: LoggedLine[] } => {
  const lines: LoggedLine[] = []
  const record =
    (level: LoggedLine['level']) =>
    (message: string, context?: LogContext): void =>
      void lines.push({ level, message, context })

  const logger: Logger = {
    debug: record('debug'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    child: () => logger,
  }
  return { logger, lines }
}

describe('createReservationReaper', () => {
  let clock: FakeClock

  beforeEach(() => {
    vi.useFakeTimers()
    clock = new FakeClock(AT)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const build = (
    reap: ReapStaleReservations,
    overrides: Partial<ReservationReaperDeps> = {},
  ): { reaper: ReturnType<typeof createReservationReaper>; lines: LoggedLine[] } => {
    const { logger, lines } = recordingLogger()
    const reaper = createReservationReaper({
      reap,
      logger,
      clock,
      intervalMs: TIMEOUT_MS,
      ...overrides,
    })
    return { reaper, lines }
  }

  it('reaps a reservation stranded seconds before a restart, five minutes later', async () => {
    // **The gap, end to end, through the real use case.** Ten seconds old at boot, so the
    // pass at startup correctly leaves it — the window is there for a `--force-recreate`
    // overlap. What was missing is everything after that: nothing asked again.
    const clips = new FakeClipJobRepository()
    clock.set(new Date(AT.getTime() + 10_000))
    clips.seed(aClipJob({ id: 'job-1', eventId: 'event-1', status: 'reserved', createdAt: AT }))

    const { logger } = recordingLogger()
    const reap = makeReapStaleReservations({
      clips,
      clock,
      logger,
      policy: { reservationTimeoutMs: TIMEOUT_MS },
    })
    const { reaper } = build(reap)

    reaper.start()
    await vi.advanceTimersByTimeAsync(0)
    // The boot pass leaves it: it is ten seconds old, not five minutes.
    expect(await clips.findById(EVENT, asClipJobId('job-1'))).not.toBeNull()

    // The evening carries on, and the next pass is the one that matters.
    clock.set(new Date(AT.getTime() + TIMEOUT_MS + 10_000))
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS)

    expect(await clips.findById(EVENT, asClipJobId('job-1'))).toBeNull()
  })

  it('reaps at startup as well, because a restart is when wreckage is likeliest', async () => {
    const reap = vi.fn<ReapStaleReservations>(async () => nothingReaped)
    const { reaper } = build(reap)

    reaper.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(reap).toHaveBeenCalledTimes(1)
  })

  it('keeps reaping on the interval', async () => {
    const reap = vi.fn<ReapStaleReservations>(async () => nothingReaped)
    const { reaper } = build(reap)

    reaper.start()
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS * 3)

    // One at startup, three on the interval.
    expect(reap).toHaveBeenCalledTimes(4)
  })

  it('starts once however often it is started', () => {
    const { reaper } = build(async () => nothingReaped)

    reaper.start()
    reaper.start()

    expect(vi.getTimerCount()).toBe(1)
  })

  it('skips rather than overlapping a pass that is still running', async () => {
    let release = (): void => {}
    const reap = vi.fn<ReapStaleReservations>(
      async () =>
        new Promise<ReapStaleReservationsReport>((resolvePromise) => {
          release = () => resolvePromise(nothingReaped)
        }),
    )
    const { reaper } = build(reap)

    const first = reaper.runOnce()
    const second = await reaper.runOnce()

    expect(second).toEqual({ status: 'skipped' })
    release()
    await first
  })

  it('reports what it reaped', async () => {
    const { reaper, lines } = build(async () => ({ reaped: 2 }))

    await reaper.runOnce()

    expect(lines.find((line) => line.level === 'info')?.context).toMatchObject({ reaped: 2 })
  })

  it('stays quiet when a healthy box reaps nothing', async () => {
    const { reaper, lines } = build(async () => nothingReaped)

    await reaper.runOnce()

    expect(lines.every((line) => line.level === 'debug')).toBe(true)
  })

  it('never rejects, because a timer callback that does is fatal', async () => {
    const { reaper, lines } = build(async () => {
      throw new Error('database is locked')
    })

    const outcome = await reaper.runOnce()

    expect(outcome.status).toBe('failed')
    expect(lines.some((line) => line.level === 'error')).toBe(true)
  })

  it('catches a pass that throws synchronously rather than returning a rejection', async () => {
    const { reaper } = build((): Promise<ReapStaleReservationsReport> => {
      throw new Error('thrown, not rejected')
    })

    await expect(reaper.runOnce()).resolves.toMatchObject({ status: 'failed' })
  })

  it('stops firing once stopped, and stopping twice is fine', async () => {
    const reap = vi.fn<ReapStaleReservations>(async () => nothingReaped)
    const { reaper } = build(reap)

    reaper.start()
    await vi.advanceTimersByTimeAsync(0)
    reaper.stop()
    reaper.stop()
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS * 2)

    expect(reap).toHaveBeenCalledTimes(1)
  })
})
