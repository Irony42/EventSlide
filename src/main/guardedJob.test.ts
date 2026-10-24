import { describe, expect, it, vi } from 'vitest'
import { CapturingLogger } from '../application/testing/capturingLogger'
import { FakeClock } from '../application/testing/fakeClock'
import { createGuardedJob, type GuardedJobDeps } from './guardedJob'

/** A pass a test holds open until it says so, to look at the world while it is running. */
const gate = (): { open: () => void; wait: Promise<void> } => {
  let open = (): void => undefined
  const wait = new Promise<void>((resolve) => {
    open = resolve
  })
  return { open, wait }
}

const build = (over: Partial<GuardedJobDeps<number>> = {}) => {
  const logger = new CapturingLogger()
  const clock = new FakeClock()
  const describe = vi.fn()
  const onSkipped = vi.fn()
  const job = createGuardedJob<number>({
    logger,
    clock,
    run: async () => 7,
    describe,
    onSkipped,
    failedMessage: 'the pass failed',
    ...over,
  })
  return { job, logger, clock, describe, onSkipped }
}

describe('createGuardedJob', () => {
  it('runs the pass and reports what it found, with how long it took', async () => {
    const clock = new FakeClock()
    const { job, describe } = build({
      clock,
      run: async () => {
        clock.advance(1_500)
        return 42
      },
    })

    const outcome = await job.runOnce()

    expect(outcome).toEqual({ status: 'completed', report: 42 })
    expect(describe).toHaveBeenCalledWith(42, 1_500)
  })

  it('skips a pass asked for while one is running, says so, and does not run it', async () => {
    const held = gate()
    const run = vi.fn(async () => {
      await held.wait
      return 1
    })
    const { job, onSkipped } = build({ run })

    const first = job.runOnce()
    const second = await job.runOnce()
    held.open()
    await first

    expect(second).toEqual({ status: 'skipped' })
    expect(onSkipped).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('says it is running for exactly as long as a pass is', async () => {
    const held = gate()
    const { job } = build({ run: async () => (await held.wait, 1) })

    expect(job.running).toBe(false)
    const pass = job.runOnce()
    expect(job.running).toBe(true)
    held.open()
    await pass

    expect(job.running).toBe(false)
  })

  it('raises the guard before the pass is called, so a second tick on the same stack sees it', async () => {
    // A pass that starts another from inside itself is the tightest case of an overlap: the
    // guard has to be up before `run` is entered, not after it returns a promise.
    let inner: Awaited<ReturnType<ReturnType<typeof build>['job']['runOnce']>> | undefined
    const ref: { job?: ReturnType<typeof build>['job'] } = {}
    const { job } = build({
      run: async () => {
        inner = await ref.job?.runOnce()
        return 1
      },
    })
    ref.job = job

    await job.runOnce()

    expect(inner).toEqual({ status: 'skipped' })
  })

  it.each([
    ['rejects', async (): Promise<number> => Promise.reject(new Error('database is locked'))],
    [
      'throws before it returns a promise',
      (): Promise<number> => {
        throw new Error('database is locked')
      },
    ],
  ])('answers failed, and logs why, when the pass %s', async (_name, run) => {
    // Never a rejection: from a timer callback it would be an unhandled one, which is fatal
    // in `index.ts`, and one failed pass is not worth the server.
    const { job, logger, describe } = build({ run })

    const outcome = await job.runOnce()

    expect(outcome.status).toBe('failed')
    expect(logger.find('the pass failed')).toEqual({
      level: 'error',
      message: 'the pass failed',
      context: { error: 'database is locked' },
    })
    expect(describe).not.toHaveBeenCalled()
  })

  it('logs a thrown value that is not an Error as text, since `undefined` is how a broken job stays broken', async () => {
    const { job, logger } = build({ run: async () => Promise.reject('plain string') })

    await job.runOnce()

    expect(logger.find('the pass failed')?.context).toEqual({ error: 'plain string' })
  })

  it('counts a report callback that throws as a failed pass, not as a rejection', async () => {
    const { job, logger } = build({
      describe: () => {
        throw new Error('cannot format')
      },
    })

    const outcome = await job.runOnce()

    expect(outcome.status).toBe('failed')
    expect(logger.find('the pass failed')?.context).toEqual({ error: 'cannot format' })
  })

  it.each([
    ['completes', async (): Promise<number> => 1],
    ['rejects', async (): Promise<number> => Promise.reject(new Error('x'))],
    [
      'throws before it returns a promise',
      (): Promise<number> => {
        throw new Error('x')
      },
    ],
  ])('lowers the guard when the pass %s, so the next tick runs', async (_name, run) => {
    const { job } = build({ run })

    await job.runOnce()

    expect(job.running).toBe(false)
    expect((await job.runOnce()).status).not.toBe('skipped')
  })

  describe('the work after the pass', () => {
    it('runs it after the pass, whatever became of it, before the guard is lowered', async () => {
      const order: string[] = []
      const { job } = build({
        run: async () => {
          order.push('pass')
          return Promise.reject(new Error('x'))
        },
        afterwards: async () => {
          order.push(`afterwards, running=${String(job.running)}`)
        },
      })

      await job.runOnce()

      expect(order).toEqual(['pass', 'afterwards, running=true'])
      expect(job.running).toBe(false)
    })

    it('keeps a tick that arrives while it runs from starting another pass', async () => {
      // The retention sweep prunes the audit log here, and a second sweep must not begin
      // while that is still going.
      const held = gate()
      const { job } = build({ afterwards: async () => held.wait })

      const first = job.runOnce()
      await Promise.resolve()
      await Promise.resolve()
      const second = await job.runOnce()
      held.open()
      await first

      expect(second).toEqual({ status: 'skipped' })
    })

    it('is not awaited when there is none, which would cost every job a microtask', async () => {
      const { job } = build()
      const settled: string[] = []

      const pass = job.runOnce().then(() => settled.push('pass'))
      await Promise.resolve().then(() => settled.push('tick 1'))
      await Promise.resolve().then(() => settled.push('tick 2'))
      await pass

      expect(settled.indexOf('pass')).toBeLessThanOrEqual(settled.indexOf('tick 2'))
    })
  })
})
