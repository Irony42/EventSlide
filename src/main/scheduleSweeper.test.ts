import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createScheduleSweeper, type ScheduleSweeperDeps } from './scheduleSweeper'
import { FakeClock } from '../application/testing/fakeClock'
import { asEventId } from '../domain/shared/ids'
import type { LogContext, Logger } from '../application/ports/logger'
import type { ApplyEventSchedulesReport } from '../application/usecases/events/applyEventSchedules'

/**
 * The scheduling half of "opens at 18:00, closes at 02:00", driven from a test.
 *
 * `src/main` is excluded from the coverage gates — it is wiring — which is exactly why
 * this file is explicit: nothing else fails if the sweep stops firing, overlaps itself,
 * or holds the process open at `docker stop`, and the symptom of the first is that a
 * party a host scheduled simply never opens.
 *
 * What the sweep decides is its own test's business
 * (`src/application/usecases/events/applyEventSchedules.test.ts`); this asserts only
 * what the composition root adds around it.
 */

const INTERVAL_MS = 300_000
const AT = new Date('2026-06-20T17:55:00.000Z')

const WEDDING = asEventId('evt-wedding')
const GALA = asEventId('evt-gala')

const nothingDue: ApplyEventSchedulesReport = { opened: [], closed: [], refused: [], failed: [] }

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
  apply: () => Promise<ApplyEventSchedulesReport>
  started: number
  finish: (report?: ApplyEventSchedulesReport) => Promise<void>
} => {
  let release: ((report: ApplyEventSchedulesReport) => void) | null = null
  const state = {
    apply: (): Promise<ApplyEventSchedulesReport> => {
      state.started += 1
      return new Promise<ApplyEventSchedulesReport>((resolve) => {
        release = resolve
      })
    },
    started: 0,
    finish: async (report: ApplyEventSchedulesReport = nothingDue): Promise<void> => {
      if (release === null) throw new Error('no sweep is in flight to finish')
      release(report)
      release = null
      // Let the sweeper's own continuation run before the test asserts on it.
      await vi.advanceTimersByTimeAsync(0)
    },
  }
  return state
}

const build = (overrides: Partial<ScheduleSweeperDeps> = {}) => {
  const { logger, lines } = recordingLogger()
  const clock = new FakeClock(AT)
  const sweeper = createScheduleSweeper({
    apply: async () => nothingDue,
    logger,
    clock,
    intervalMs: INTERVAL_MS,
    ...overrides,
  })
  return { sweeper, lines, clock }
}

describe('createScheduleSweeper', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('the schedule', () => {
    it('does not sweep at startup', async () => {
      let swept = 0
      const { sweeper } = build({
        apply: async () => {
          swept += 1
          return nothingDue
        },
      })

      sweeper.start()
      await vi.advanceTimersByTimeAsync(INTERVAL_MS - 1)

      expect(swept).toBe(0)
    })

    it('sweeps once per interval, which is what a missed window depends on', async () => {
      let swept = 0
      const { sweeper } = build({
        apply: async () => {
          swept += 1
          return nothingDue
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
        apply: async () => {
          swept += 1
          return nothingDue
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
        apply: async () => {
          swept += 1
          return nothingDue
        },
      })

      sweeper.start()
      sweeper.stop()
      await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3)

      expect(swept).toBe(0)
    })

    it('survives being stopped before it was ever started', () => {
      const { sweeper } = build()

      expect(() => sweeper.stop()).not.toThrow()
    })

    it('announces the schedule when it starts, so a boot log proves it is armed', () => {
      const { sweeper, lines } = build()

      sweeper.start()

      expect(at(lines, 'info')).toEqual([
        {
          level: 'info',
          message: 'schedule sweep scheduled',
          context: { intervalMs: INTERVAL_MS },
        },
      ])
      sweeper.stop()
    })
  })

  describe('never two sweeps at once', () => {
    it('skips a tick that arrives while the previous sweep is still running', async () => {
      const sweep = controllableSweep()
      const { sweeper } = build({ apply: sweep.apply })

      sweeper.start()
      await vi.advanceTimersByTimeAsync(INTERVAL_MS * 2)

      expect(sweep.started).toBe(1)
      await sweep.finish()
      sweeper.stop()
    })

    it('reports the skip to its caller rather than pretending a sweep happened', async () => {
      const sweep = controllableSweep()
      const { sweeper, lines } = build({ apply: sweep.apply })

      const first = sweeper.runOnce()
      const second = await sweeper.runOnce()

      expect(second).toEqual({ status: 'skipped' })
      expect(at(lines, 'warn')).toHaveLength(1)
      await sweep.finish()
      await first
    })

    it('releases the guard after a sweep that threw, so one bad run does not wedge it', async () => {
      let attempt = 0
      const { sweeper } = build({
        apply: async () => {
          attempt += 1
          if (attempt === 1) throw new Error('database is locked')
          return nothingDue
        },
      })

      await sweeper.runOnce()
      const second = await sweeper.runOnce()

      expect(second.status).toBe('completed')
    })
  })

  describe('the report reaches the operator', () => {
    it('logs what it opened and closed, which is why the wall changed', async () => {
      const { sweeper, lines } = build({
        apply: async () => ({ opened: [WEDDING], closed: [GALA], refused: [], failed: [] }),
      })

      await sweeper.runOnce()

      expect(at(lines, 'info')[0]?.message).toBe('schedule sweep moved events')
      expect(at(lines, 'info')[0]?.context).toMatchObject({
        openedIds: 'evt-wedding',
        closedIds: 'evt-gala',
      })
    })

    it('warns about a transition the lifecycle refused, the only record it existed', async () => {
      const { sweeper, lines } = build({
        apply: async () => ({ opened: [], closed: [], refused: [WEDDING], failed: [] }),
      })

      await sweeper.runOnce()

      expect(at(lines, 'warn')[0]?.message).toBe(
        'schedule sweep discarded a transition the lifecycle refused',
      )
    })

    it('logs an unwritable event at error level: a promised opening did not happen', async () => {
      const { sweeper, lines } = build({
        apply: async () => ({ opened: [], closed: [], refused: [], failed: [WEDDING] }),
      })

      await sweeper.runOnce()

      expect(at(lines, 'error')[0]?.message).toBe('schedule sweep could not write every event')
    })

    it('keeps an empty sweep at debug, so a five-minute timer does not become the log', async () => {
      const { sweeper, lines } = build()

      await sweeper.runOnce()

      expect(at(lines, 'info')).toEqual([])
      expect(at(lines, 'debug')[0]?.message).toBe('schedule sweep found nothing due')
    })

    it('times the sweep with the injected clock', async () => {
      const clock = new FakeClock(AT)
      const { sweeper, lines } = build({
        clock,
        apply: async () => {
          clock.advance(1_500)
          return nothingDue
        },
      })

      await sweeper.runOnce()

      expect(at(lines, 'debug')[0]?.context).toMatchObject({ durationMs: 1_500 })
    })
  })

  describe('a sweep that throws', () => {
    it('never rejects, because an unhandled rejection from a timer kills the server', async () => {
      const { sweeper } = build({
        apply: async () => {
          throw new Error('database is closed')
        },
      })

      await expect(sweeper.runOnce()).resolves.toMatchObject({ status: 'failed' })
    })

    it('catches a synchronous throw too, not only a rejected promise', async () => {
      const { sweeper } = build({
        apply: (): Promise<ApplyEventSchedulesReport> => {
          throw new Error('thrown before the promise')
        },
      })

      await expect(sweeper.runOnce()).resolves.toMatchObject({ status: 'failed' })
    })

    it('logs why', async () => {
      const { sweeper, lines } = build({
        apply: async () => {
          throw new Error('database is closed')
        },
      })

      await sweeper.runOnce()

      expect(at(lines, 'error')[0]?.message).toBe('schedule sweep failed')
      expect(at(lines, 'error')[0]?.context).toMatchObject({ error: 'database is closed' })
    })
  })

  describe('shutdown', () => {
    it('returns immediately rather than waiting out an in-flight sweep', async () => {
      const sweep = controllableSweep()
      const { sweeper, lines } = build({ apply: sweep.apply })

      const running = sweeper.runOnce()
      sweeper.stop()

      expect(at(lines, 'warn')[0]?.message).toBe(
        'shutting down during a schedule sweep, the rest is left to the next run',
      )
      await sweep.finish()
      await running
    })

    it('says nothing about an in-flight sweep when none is running', async () => {
      const { sweeper, lines } = build()

      await sweeper.runOnce()
      sweeper.stop()

      expect(at(lines, 'warn')).toEqual([])
    })
  })
})

describe('createScheduleSweeper, against real timers', () => {
  it('unrefs its interval, so a pending sweep never holds `docker stop` open', () => {
    const created = vi.spyOn(globalThis, 'setInterval')
    const { logger } = recordingLogger()
    const sweeper = createScheduleSweeper({
      apply: async () => nothingDue,
      logger,
      clock: new FakeClock(AT),
      intervalMs: INTERVAL_MS,
    })

    sweeper.start()

    const handle = created.mock.results[0]?.value
    sweeper.stop()
    created.mockRestore()

    expect(handle).toBeDefined()
    expect((handle as NodeJS.Timeout).hasRef()).toBe(false)
  })
})
