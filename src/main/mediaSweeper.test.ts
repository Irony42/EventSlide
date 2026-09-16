import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMediaSweeper, isTooDangerousToSweep, type MediaSweeperDeps } from './mediaSweeper'
import { FakeClock } from '../application/testing/fakeClock'
import { asEventId } from '../domain/shared/ids'
import type { LogContext, Logger } from '../application/ports/logger'
import type {
  SweepOrphanedMedia,
  SweepOrphanedMediaReport,
} from '../application/usecases/media/sweepOrphanedMedia'

/**
 * The scheduling half of media reconciliation, and the predicate that guards the boot
 * sweep's recursive delete.
 *
 * `src/main` is excluded from the coverage gates, which is exactly why this file is
 * explicit: nothing else fails if the sweep stops firing or overlaps itself, and the
 * symptom is a disk that fills during an evening rather than after it. The predicate is
 * here rather than in `container.ts` for the same reason — it decides whether an
 * `rm -rf` happens, and a rule nothing can test is a rule nobody can trust.
 *
 * What the sweep collects and what it refuses to touch is its own test's business
 * (`src/application/usecases/media/sweepOrphanedMedia.test.ts`); this asserts only what
 * the composition root adds around it.
 */

const INTERVAL_MS = 3_600_000
const AT = new Date('2026-09-11T20:00:00.000Z')

const nothingCollected: SweepOrphanedMediaReport = {
  scanned: 0,
  collected: 0,
  bytes: 0,
  failed: [],
  skippedEvents: 0,
}

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

describe('isTooDangerousToSweep', () => {
  it('refuses a filesystem root', () => {
    // `MEDIA_ROOT=/` would make the boot sweep remove `/.uploads`.
    expect(isTooDangerousToSweep(resolve('/'))).toBe(true)
  })

  it('refuses the user’s home directory', () => {
    expect(isTooDangerousToSweep(homedir())).toBe(true)
  })

  it.each(['/home', '/root', '/var', '/mnt', '/media', '/srv', '/opt', '/Users'])(
    'refuses %s, where a .uploads is somebody else’s',
    (parent) => {
      // Compared as written rather than through `resolve`, which on Windows binds a POSIX
      // path to the current drive — so this list answered `D:\var` on a D: checkout and
      // the comparison could never fire.
      expect(isTooDangerousToSweep(parent)).toBe(true)
    },
  )

  it('refuses a shared parent whatever its case or separator', () => {
    expect(isTooDangerousToSweep('/USERS')).toBe(true)
    expect(isTooDangerousToSweep('/var/')).toBe(true)
  })

  it.each([
    ['C:\\users', 'a Windows-shaped path, on a POSIX box'],
    ['D:\\Users\\', 'the same with another drive and a trailing separator'],
    ['/var', 'a POSIX path, on Windows'],
    ['/Users', 'the other direction of the same question'],
  ])('refuses %s — %s — whichever platform is reading it', (parent) => {
    // **This is the one CI caught.** The guard used to judge `resolve(root)` alone, and
    // `resolve` is the platform-specific half: on Linux `resolve('C:\users')` is
    // `<cwd>/C:\users`, so the drive letter is no longer leading, nothing is stripped,
    // and the comparison against `/users` could not match. The assertion passed on
    // Windows and failed on the platform the product actually deploys on — which is the
    // worse way round for a guard in front of an `rm -rf`.
    //
    // A shape is a shape on both platforms, so the raw input is reduced too and the
    // answer no longer depends on who is asking.
    expect(isTooDangerousToSweep(parent)).toBe(true)
  })

  it('allows a directory of its own, which is what every deployment gives it', () => {
    expect(isTooDangerousToSweep(resolve('/srv/eventslide/media'))).toBe(false)
    expect(isTooDangerousToSweep(resolve(homedir(), 'eventslide-media'))).toBe(false)
  })
})

describe('createMediaSweeper', () => {
  let clock: FakeClock

  beforeEach(() => {
    vi.useFakeTimers()
    clock = new FakeClock(AT)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const build = (
    sweep: SweepOrphanedMedia,
    overrides: Partial<MediaSweeperDeps> = {},
  ): { sweeper: ReturnType<typeof createMediaSweeper>; lines: LoggedLine[] } => {
    const { logger, lines } = recordingLogger()
    const sweeper = createMediaSweeper({
      sweep,
      logger,
      clock,
      intervalMs: INTERVAL_MS,
      firstDelayMs: INTERVAL_MS,
      ...overrides,
    })
    return { sweeper, lines }
  }

  it('does not sweep at startup, only one interval later', async () => {
    // A boot is the worst moment to walk every shard directory on the disk: the worker
    // is recovering, and a container that has just restarted is the one most likely to
    // have a projector waiting on it.
    const sweep = vi.fn<SweepOrphanedMedia>(async () => nothingCollected)
    const { sweeper } = build(sweep)

    sweeper.start()
    expect(sweep).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(INTERVAL_MS)
    expect(sweep).toHaveBeenCalledTimes(1)
  })

  it('keeps sweeping on the interval', async () => {
    const sweep = vi.fn<SweepOrphanedMedia>(async () => nothingCollected)
    const { sweeper } = build(sweep)

    sweeper.start()
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3)

    expect(sweep).toHaveBeenCalledTimes(3)
  })

  it('starts once however often it is started', () => {
    const sweep = vi.fn<SweepOrphanedMedia>(async () => nothingCollected)
    const { sweeper } = build(sweep)

    sweeper.start()
    sweeper.start()

    expect(vi.getTimerCount()).toBe(1)
  })

  it('skips rather than overlapping a sweep that is still running', async () => {
    // Two concurrent walks of every shard directory on a disk that may be projecting an
    // event. Harmless to the data — `delete` is idempotent — and not harmless to the
    // disk.
    let release = (): void => {}
    const sweep = vi.fn<SweepOrphanedMedia>(
      async () =>
        new Promise<SweepOrphanedMediaReport>((resolvePromise) => {
          release = () => resolvePromise(nothingCollected)
        }),
    )
    const { sweeper, lines } = build(sweep)

    const first = sweeper.runOnce()
    const second = await sweeper.runOnce()

    expect(second).toEqual({ status: 'skipped' })
    expect(lines.some((line) => line.level === 'warn')).toBe(true)
    release()
    await first
  })

  it('sweeps again once the previous one has finished', async () => {
    const sweep = vi.fn<SweepOrphanedMedia>(async () => nothingCollected)
    const { sweeper } = build(sweep)

    await sweeper.runOnce()
    const second = await sweeper.runOnce()

    expect(second.status).toBe('completed')
  })

  it('reports what it collected, which is the figure an operator wants', async () => {
    const sweep = vi.fn<SweepOrphanedMedia>(async () => ({
      scanned: 40,
      collected: 2,
      bytes: 90_000_000,
      failed: [],
      skippedEvents: 0,
    }))
    const { sweeper, lines } = build(sweep)

    await sweeper.runOnce()

    const line = lines.find((entry) => entry.level === 'info')
    expect(line?.context).toMatchObject({ collected: 2, bytes: 90_000_000 })
  })

  it('stays quiet when a healthy installation collects nothing', async () => {
    const { sweeper, lines } = build(async () => nothingCollected)

    await sweeper.runOnce()

    expect(lines.every((line) => line.level === 'debug')).toBe(true)
  })

  it('warns about an event it could not read, and names it', async () => {
    const { sweeper, lines } = build(async () => ({
      ...nothingCollected,
      failed: [asEventId('evt-wedding')],
    }))

    await sweeper.runOnce()

    const line = lines.find((entry) => entry.level === 'warn')
    expect(line?.context).toMatchObject({ failedIds: 'evt-wedding' })
  })

  it('never rejects, because a timer callback that does is fatal', async () => {
    // `index.ts` treats an unhandled rejection as fatal. Losing the server because a
    // directory could not be listed would be far worse than one skipped sweep.
    const { sweeper, lines } = build(async () => {
      throw new Error('media root is gone')
    })

    const outcome = await sweeper.runOnce()

    expect(outcome.status).toBe('failed')
    expect(lines.some((line) => line.level === 'error')).toBe(true)
  })

  it('catches a sweep that throws synchronously rather than returning a rejection', async () => {
    const { sweeper } = build((): Promise<SweepOrphanedMediaReport> => {
      throw new Error('thrown, not rejected')
    })

    await expect(sweeper.runOnce()).resolves.toMatchObject({ status: 'failed' })
  })

  it('stops firing once stopped, and stopping twice is fine', async () => {
    const sweep = vi.fn<SweepOrphanedMedia>(async () => nothingCollected)
    const { sweeper } = build(sweep)

    sweeper.start()
    sweeper.stop()
    sweeper.stop()
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 2)

    expect(sweep).not.toHaveBeenCalled()
  })

  it('says so when it is shut down mid-sweep', async () => {
    let release = (): void => {}
    const { sweeper, lines } = build(
      async () =>
        new Promise<SweepOrphanedMediaReport>((resolvePromise) => {
          release = () => resolvePromise(nothingCollected)
        }),
    )

    const running = sweeper.runOnce()
    sweeper.stop()

    expect(lines.some((line) => line.level === 'warn')).toBe(true)
    release()
    await running
  })
})
