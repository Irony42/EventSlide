import { afterEach, describe, expect, it, vi } from 'vitest'
import { CallLog } from '../application/testing/callLog'
import type { LogContext, Logger } from '../application/ports/logger'
import type { Container } from './container'
import { createShutdownHandler, type ShutdownServer } from './shutdown'

/**
 * `src/main` is excluded from the coverage gates — it is wiring, and `index.ts` itself
 * cannot be imported at all without starting the real server (it calls `bootstrap()` at
 * module load). That is exactly why this file exists: the ordering P4-06 actually
 * promises — readiness flips, SSE drains, *then* the server stops accepting connections
 * (docs/ARCHITECTURE.md "Graceful shutdown") — was, before `shutdown.ts` was split out,
 * a rule stated only in a comment inside an unexported closure. Deleting the
 * `readiness.markShuttingDown()` call left every other test green; see the mutation
 * table in the PR body.
 *
 * Fakes rather than mocks, and `CallLog` (src/application/testing/callLog.ts) rather
 * than a bespoke spy per call, because the thing under test here **is** an ordering
 * rule — the committed state is identical whichever order the calls happen in, which
 * is exactly why only a recorded sequence, not an end-state assertion, can see it.
 */

const recordingLogger = (): Logger => {
  const logger: Logger = {
    debug: (): void => {},
    info: (): void => {},
    warn: (): void => {},
    error: (): void => {},
    child: (_bindings: LogContext): Logger => logger,
  }
  return logger
}

type FakeContainer = Pick<Container, 'logger' | 'readiness' | 'dispose'>

interface Rig {
  readonly handler: (signal: string) => void
  readonly calls: CallLog
  readonly exitCodes: number[]
  /** Resolves (or rejects) the `dispose()` promise `server.close`'s callback awaits. */
  readonly settleDispose: (outcome: 'resolve' | 'reject') => void
  /** Invokes `server.close`'s callback. Not called automatically, so a test can decide when. */
  readonly finishClose: () => void
  /**
   * Resolves the first time `exit()` is called. Driven by the real microtask queue
   * (never by a timer), so it is safe to await under `vi.useFakeTimers()` — unlike
   * `vi.waitFor`, which polls with `setTimeout` and would need the fake clock advanced
   * to ever settle.
   */
  readonly waitForExit: () => Promise<void>
}

const build = (grace = 15_000): Rig => {
  const calls = new CallLog()
  const exitCodes: number[] = []
  let resolveExit: (() => void) | null = null
  const exited = new Promise<void>((resolve) => {
    resolveExit = resolve
  })

  const readiness = calls.watch('readiness', { markShuttingDown: (): void => {} })
  const drain = calls.watch('drain', { run: (): void => {} })

  let closeCallback: (() => void) | null = null
  const server = calls.watch('server', {
    close: (callback: () => void): void => {
      closeCallback = callback
    },
  }) as unknown as ShutdownServer

  let settle: ((outcome: 'resolve' | 'reject') => void) | null = null
  const containerBase = {
    logger: recordingLogger(),
    readiness,
    dispose: (): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        settle = (outcome): void =>
          outcome === 'resolve' ? resolve() : reject(new Error('dispose failed'))
      }),
  }
  const container = calls.watch('container', containerBase) as unknown as FakeContainer

  const handler = createShutdownHandler({
    server,
    container,
    grace,
    exit: (code: number): void => {
      exitCodes.push(code)
      resolveExit?.()
    },
    drainStreams: drain.run,
  })

  return {
    handler,
    calls,
    exitCodes,
    settleDispose: (outcome) => settle?.(outcome),
    finishClose: () => closeCallback?.(),
    waitForExit: () => exited,
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('createShutdownHandler: ordering (P4-06)', () => {
  it('flips readiness, drains SSE, then stops accepting connections, in that order', () => {
    const { handler, calls } = build()

    handler('SIGTERM')

    expect(calls.sequenceOf('readiness.markShuttingDown', 'drain.run', 'server.close')).toEqual([
      'readiness.markShuttingDown',
      'drain.run',
      'server.close',
    ])
  })

  it('disposes the container and exits 0 once the server finishes closing', async () => {
    const { handler, calls, exitCodes, settleDispose, finishClose, waitForExit } = build()

    handler('SIGTERM')
    finishClose()
    settleDispose('resolve')
    await waitForExit()

    expect(exitCodes).toEqual([0])
    expect(calls.sequenceOf('server.close', 'container.dispose')).toEqual([
      'server.close',
      'container.dispose',
    ])
  })

  it('logs and exits 1 when dispose fails while the server is closing', async () => {
    const { handler, exitCodes, settleDispose, finishClose, waitForExit } = build()

    handler('SIGTERM')
    finishClose()
    settleDispose('reject')
    await waitForExit()

    expect(exitCodes).toEqual([1])
  })

  it('exits 1 immediately on a second signal, without draining or closing again', () => {
    const { handler, calls, exitCodes } = build()

    handler('SIGTERM')
    handler('SIGTERM')

    expect(exitCodes).toEqual([1])
    expect(calls.names.filter((name) => name === 'drain.run')).toHaveLength(1)
    expect(calls.names.filter((name) => name === 'server.close')).toHaveLength(1)
  })

  it('forces an exit once the grace period elapses, even if the server never finishes closing', async () => {
    vi.useFakeTimers()
    const { handler, exitCodes, settleDispose, waitForExit } = build(15_000)

    handler('SIGTERM')
    // `server.close`'s callback is never invoked — the stand-in for a client that never
    // disconnects, which is the whole reason the backstop exists.
    await vi.advanceTimersByTimeAsync(15_000)
    settleDispose('resolve')
    await waitForExit()

    expect(exitCodes).toEqual([0])
  })
})
