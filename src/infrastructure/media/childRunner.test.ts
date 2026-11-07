import { describe, expect, it } from 'vitest'
import { createChildRunner } from './childRunner'
import type { RunningProcess, RunProcessOptions, RunResult } from './runProcess'

const RESULT: RunResult = {
  ok: true,
  failure: null,
  code: 0,
  signal: null,
  stdout: '',
  stdoutTruncated: false,
  stderr: '',
}

const BOUNDS = { timeoutMs: 1_000, stallMs: 1_000 }

/** A starter that records what it was asked to run and lets the test finish each child. */
const fakeStarter = () => {
  const started: RunProcessOptions[] = []
  const children: Array<{ kills: number; finish: (result: RunResult) => void }> = []
  const start = (options: RunProcessOptions): RunningProcess => {
    started.push(options)
    let finish: (result: RunResult) => void = () => {}
    const finished = new Promise<RunResult>((resolve) => {
      finish = resolve
    })
    const child = {
      kills: 0,
      finish,
    }
    children.push(child)
    return {
      finished,
      kill: () => {
        child.kills += 1
        finish({ ...RESULT, ok: false, failure: 'cancelled', code: null })
      },
    }
  }
  return { start, started, children }
}

describe('createChildRunner', () => {
  it('starts the binary with the runner’s own environment, whatever the bounds say', async () => {
    const { start, started, children } = fakeStarter()
    const runner = createChildRunner({ A: '1' }, start)

    const pending = runner.run('/bin/tool', ['-x'], BOUNDS)
    children[0]?.finish(RESULT)

    expect(await pending).toEqual(RESULT)
    expect(started).toEqual([{ binary: '/bin/tool', args: ['-x'], env: { A: '1' }, ...BOUNDS }])
  })

  it('kills every child still running when it is closed, and answers them as cancelled', async () => {
    const { start, children } = fakeStarter()
    const runner = createChildRunner({}, start)

    const first = runner.run('/bin/tool', [], BOUNDS)
    const second = runner.run('/bin/tool', [], BOUNDS)
    runner.close()

    expect((await first).failure).toBe('cancelled')
    expect((await second).failure).toBe('cancelled')
    expect(children.map((child) => child.kills)).toEqual([1, 1])
  })

  it('does not kill a child that already finished', async () => {
    const { start, children } = fakeStarter()
    const runner = createChildRunner({}, start)

    const done = runner.run('/bin/tool', [], BOUNDS)
    children[0]?.finish(RESULT)
    await done
    runner.close()

    expect(children[0]?.kills).toBe(0)
  })

  it('refuses a run started after close: it answers cancelled and spawns nothing', async () => {
    const { start, started } = fakeStarter()
    const runner = createChildRunner({}, start)
    runner.close()

    const result = await runner.run('/bin/tool', [], BOUNDS)

    expect(result.ok).toBe(false)
    expect(result.failure).toBe('cancelled')
    expect(started).toEqual([])
    expect(runner.isClosed()).toBe(true)
  })
})
