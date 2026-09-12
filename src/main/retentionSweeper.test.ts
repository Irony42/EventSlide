import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRetentionSweeper, type RetentionSweeperDeps } from './retentionSweeper'
import { FakeClock } from '../application/testing/fakeClock'
import { asEventId } from '../domain/shared/ids'
import type { LogContext, Logger } from '../application/ports/logger'
import type {
  PurgeExpiredEvents,
  PurgeExpiredEventsReport,
} from '../application/usecases/events/purgeExpiredEvents'

/**
 * The scheduling half of retention, driven from a test.
 *
 * `src/main` is excluded from the coverage gates — it is wiring, and the gate would only
 * measure how much of `container.ts` a test happened to execute. That exclusion is
 * exactly why this file is explicit: nothing else fails if the sweep stops firing,
 * overlaps itself, or holds the process open at `docker stop`, and the symptom of the
 * first of those is that photographs a host promised to delete quietly stay on disk.
 *
 * The sweep itself is a function here. What `purgeExpiredEvents` deletes, in what order,
 * and what a per-event failure means are its own tests' business
 * (`src/application/usecases/events/purgeExpiredEvents.test.ts`); this asserts only what
 * the composition root adds around it.
 */

const INTERVAL_MS = 3_600_000
const AT = new Date('2026-09-11T20:00:00.000Z')

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')

const nothingPurged: PurgeExpiredEventsReport = { purged: [], failed: [] }

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

const at = (lines: readonly LoggedLine[], level: LoggedLine['level']): readonly LoggedLine[] =>
  lines.filter((line) => line.level === level)

/** A sweep whose completion the test decides, for everything about overlap. */
const controllableSweep = (): {
  purge: PurgeExpiredEvents
  started: number
  finish: (report?: PurgeExpiredEventsReport) => Promise<void>
} => {
  let release: ((report: PurgeExpiredEventsReport) => void) | null = null
  const state = {
    purge: (): Promise<PurgeExpiredEventsReport> => {
      state.started += 1
      return new Promise<PurgeExpiredEventsReport>((resolve) => {
        release = resolve
      })
    },
    started: 0,
    finish: async (report: PurgeExpiredEventsReport = nothingPurged): Promise<void> => {
      if (release === null) throw new Error('no sweep is in flight to finish')
      release(report)
      release = null
      // Let the sweeper's own continuation run before the test asserts on it.
      await vi.advanceTimersByTimeAsync(0)
    },
  }
  return state
}

const build = (overrides: Partial<RetentionSweeperDeps> = {}) => {
  const { logger, lines } = recordingLogger()
  const clock = new FakeClock(AT)
  const sweeper = createRetentionSweeper({
    purge: async () => nothingPurged,
    logger,
    clock,
    intervalMs: INTERVAL_MS,
    ...overrides,
  })
  return { sweeper, lines, clock }
}

describe('createRetentionSweeper', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('the schedule', () => {
    it('does not sweep at startup, so a restart mid-event does not begin deleting albums', async () => {
      // Restarts cluster around the busiest moments — a crash during the party, a
      // redeploy. Retention is measured in days, so an hour of lag costs nothing and
      // `npm run purge` is there for an operator who wants it now.
      let swept = 0
      const { sweeper } = build({
        purge: async () => {
          swept += 1
          return nothingPurged
        },
      })

      sweeper.start()
      await vi.advanceTimersByTimeAsync(INTERVAL_MS - 1)

      expect(swept).toBe(0)
    })

    it('sweeps once per interval', async () => {
      let swept = 0
      const { sweeper } = build({
        purge: async () => {
          swept += 1
          return nothingPurged
        },
      })

      sweeper.start()
      await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3)

      expect(swept).toBe(3)
      sweeper.stop()
    })

    it('starts one timer however many times it is started', async () => {
      let swept = 0
      const { sweeper } = build({
        purge: async () => {
          swept += 1
          return nothingPurged
        },
      })

      sweeper.start()
      sweeper.start()
      await vi.advanceTimersByTimeAsync(INTERVAL_MS)

      expect(swept).toBe(1)
      sweeper.stop()
    })

    it('stops sweeping once stopped', async () => {
      let swept = 0
      const { sweeper } = build({
        purge: async () => {
          swept += 1
          return nothingPurged
        },
      })

      sweeper.start()
      await vi.advanceTimersByTimeAsync(INTERVAL_MS)
      sweeper.stop()
      await vi.advanceTimersByTimeAsync(INTERVAL_MS * 5)

      expect(swept).toBe(1)
    })

    it('survives being stopped before it was ever started', () => {
      const { sweeper } = build()

      expect(() => sweeper.stop()).not.toThrow()
    })
  })

  describe('never two sweeps at once', () => {
    it('skips a tick that arrives while the previous sweep is still running', async () => {
      // Two concurrent recursive directory removals over the same event is how a media
      // root ends up half deleted with both runs reporting failure.
      const sweep = controllableSweep()
      const { sweeper, lines } = build({ purge: sweep.purge })

      sweeper.start()
      await vi.advanceTimersByTimeAsync(INTERVAL_MS)
      expect(sweep.started).toBe(1)

      await vi.advanceTimersByTimeAsync(INTERVAL_MS * 4)

      expect(sweep.started).toBe(1)
      expect(at(lines, 'warn')).toHaveLength(4)
      expect(at(lines, 'warn')[0]?.message).toContain('skipped')

      sweeper.stop()
      await sweep.finish()
    })

    it('sweeps again on the next tick once the slow one has finished', async () => {
      const sweep = controllableSweep()
      const { sweeper } = build({ purge: sweep.purge })

      sweeper.start()
      await vi.advanceTimersByTimeAsync(INTERVAL_MS)
      await vi.advanceTimersByTimeAsync(INTERVAL_MS)
      expect(sweep.started).toBe(1)

      await sweep.finish()
      await vi.advanceTimersByTimeAsync(INTERVAL_MS)

      expect(sweep.started).toBe(2)
      sweeper.stop()
      await sweep.finish()
    })

    it('reports the skip to its caller rather than pretending a sweep happened', async () => {
      const sweep = controllableSweep()
      const { sweeper } = build({ purge: sweep.purge })

      const first = sweeper.runOnce()
      const second = await sweeper.runOnce()

      expect(second).toEqual({ status: 'skipped' })
      await sweep.finish()
      expect(await first).toEqual({ status: 'completed', report: nothingPurged })
    })

    it('releases the guard after a sweep that threw, so one bad run does not wedge it forever', async () => {
      let swept = 0
      const { sweeper } = build({
        purge: async () => {
          swept += 1
          throw new Error('database is closed')
        },
      })

      expect((await sweeper.runOnce()).status).toBe('failed')
      expect((await sweeper.runOnce()).status).toBe('failed')
      expect(swept).toBe(2)
    })
  })

  describe('the report reaches the operator', () => {
    it('logs the purged ids, which are the last record those albums existed', async () => {
      const { sweeper, lines } = build({
        purge: async () => ({ purged: [WEDDING, GALA], failed: [] }),
      })

      await sweeper.runOnce()

      const info = at(lines, 'info')
      expect(info).toHaveLength(1)
      expect(info[0]?.context).toMatchObject({
        purged: 2,
        purgedIds: 'evt-wedding evt-gala',
      })
    })

    it('logs failed ids at error level, the only signal an operator gets that a disk is wedged', async () => {
      const { sweeper, lines } = build({
        purge: async () => ({ purged: [], failed: [GALA] }),
      })

      await sweeper.runOnce()

      const errors = at(lines, 'error')
      expect(errors).toHaveLength(1)
      expect(errors[0]?.context).toMatchObject({ failed: 1, failedIds: 'evt-gala' })
    })

    it('reports both halves of a mixed run', async () => {
      const { sweeper, lines } = build({
        purge: async () => ({ purged: [WEDDING], failed: [GALA] }),
      })

      await sweeper.runOnce()

      expect(at(lines, 'info')).toHaveLength(1)
      expect(at(lines, 'error')).toHaveLength(1)
    })

    it('keeps an empty sweep at debug, so an hourly timer does not become the log file', async () => {
      const { sweeper, lines } = build()

      await sweeper.runOnce()

      expect(at(lines, 'debug')).toHaveLength(1)
      expect(at(lines, 'info')).toHaveLength(0)
      expect(at(lines, 'error')).toHaveLength(0)
    })

    it('times the sweep with the injected clock', async () => {
      const clock = new FakeClock(AT)
      const { sweeper, lines } = build({
        clock,
        purge: async () => {
          clock.advance(4_000)
          return { purged: [WEDDING], failed: [] }
        },
      })

      await sweeper.runOnce()

      expect(at(lines, 'info')[0]?.context).toMatchObject({ durationMs: 4_000 })
    })

    it('announces the schedule when it starts, so a boot log proves retention is armed', () => {
      const { sweeper, lines } = build()

      sweeper.start()

      expect(at(lines, 'info')[0]).toMatchObject({
        message: 'retention sweep scheduled',
        context: { intervalMs: INTERVAL_MS },
      })
      sweeper.stop()
    })
  })

  describe('a sweep that throws', () => {
    it('never rejects, because an unhandled rejection from a timer kills the server', async () => {
      // index.ts exits the process on an unhandledRejection. A purge that cannot read
      // the database must cost one sweep, not the party's photo wall.
      const { sweeper } = build({
        purge: () => Promise.reject(new Error('SQLITE_BUSY')),
      })

      const outcome = await sweeper.runOnce()

      expect(outcome).toMatchObject({ status: 'failed' })
    })

    it('catches a synchronous throw too, not only a rejected promise', async () => {
      // A `purge` that threw before returning its promise would escape a try block
      // opened after the call, and the timer's `void runOnce()` would become the
      // unhandled rejection that takes the process down.
      const { sweeper } = build({
        purge: () => {
          throw new Error('the media root is gone')
        },
      })

      const outcome = await sweeper.runOnce()

      expect(outcome).toMatchObject({ status: 'failed' })
      // And the guard is released, so the next tick still sweeps.
      expect((await sweeper.runOnce()).status).toBe('failed')
    })

    it('logs why', async () => {
      const { sweeper, lines } = build({
        purge: () => Promise.reject(new Error('SQLITE_BUSY')),
      })

      await sweeper.runOnce()

      expect(at(lines, 'error')[0]?.context).toMatchObject({ error: 'SQLITE_BUSY' })
    })

    it('does not take the process down when the timer is what called it', async () => {
      const rejections: unknown[] = []
      const onRejection = (reason: unknown): void => void rejections.push(reason)
      process.on('unhandledRejection', onRejection)

      const { sweeper } = build({ purge: () => Promise.reject(new Error('SQLITE_BUSY')) })
      sweeper.start()
      await vi.advanceTimersByTimeAsync(INTERVAL_MS)
      sweeper.stop()

      process.off('unhandledRejection', onRejection)
      expect(rejections).toEqual([])
    })
  })

  describe('shutdown', () => {
    it('returns immediately rather than waiting out an in-flight sweep', async () => {
      // `docker stop` gives ten seconds. Forty recursive deletions do not fit in it, and
      // the sweep is resumable — an interrupted event still has its row, so the next run
      // picks it up and the idempotent deleteEvent finishes the directory.
      const sweep = controllableSweep()
      const { sweeper, lines } = build({ purge: sweep.purge })

      sweeper.start()
      await vi.advanceTimersByTimeAsync(INTERVAL_MS)
      sweeper.stop()

      expect(at(lines, 'warn')[0]?.message).toContain('shutting down during a retention sweep')
      await sweep.finish()
    })

    it('says nothing about an in-flight sweep when none is running', async () => {
      const { sweeper, lines } = build()

      sweeper.start()
      await vi.advanceTimersByTimeAsync(INTERVAL_MS)
      sweeper.stop()

      expect(at(lines, 'warn')).toHaveLength(0)
    })
  })
})

describe('createRetentionSweeper, against real timers', () => {
  it('unrefs its interval, so a pending sweep never holds `docker stop` open', () => {
    // Asserted on the handle itself rather than on `unref` having been called: what
    // matters is that the timer has stopped keeping the event loop alive. Without it,
    // shutdown waits out the whole interval — up to a day — and the 15 s backstop in
    // index.ts never runs, because the process was never trying to exit.
    const created = vi.spyOn(globalThis, 'setInterval')
    const { logger } = recordingLogger()
    const sweeper = createRetentionSweeper({
      purge: async () => nothingPurged,
      logger,
      clock: new FakeClock(AT),
      intervalMs: INTERVAL_MS,
    })

    sweeper.start()

    const handle = created.mock.results[0]?.value
    sweeper.stop()
    created.mockRestore()

    expect(handle).toBeDefined()
    expect(handle?.hasRef()).toBe(false)
  })
})
