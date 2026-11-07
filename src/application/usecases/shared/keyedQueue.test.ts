import { describe, expect, it } from 'vitest'
import { createKeyedQueue } from './keyedQueue'

const deferred = (): {
  promise: Promise<void>
  resolve: () => void
  reject: (e: Error) => void
} => {
  let resolve!: () => void
  let reject!: (e: Error) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// A macrotask turn: every pending promise hop has run, however many the queue chains.
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

describe('createKeyedQueue', () => {
  it('runs tasks of one key one after another', async () => {
    const queue = createKeyedQueue()
    const log: string[] = []
    const gate = deferred()
    const first = queue.run('a', async () => {
      log.push('first:start')
      await gate.promise
      log.push('first:end')
    })
    const second = queue.run('a', async () => {
      log.push('second:start')
    })
    await settle()
    expect(log).toEqual(['first:start'])
    gate.resolve()
    await Promise.all([first, second])
    expect(log).toEqual(['first:start', 'first:end', 'second:start'])
  })

  it('does not make another key wait', async () => {
    const queue = createKeyedQueue()
    const gate = deferred()
    const slow = queue.run('a', () => gate.promise)
    await expect(queue.run('b', async () => 'done')).resolves.toBe('done')
    gate.resolve()
    await slow
  })

  it('forgets a key once its tasks settled, so the map does not grow for ever', async () => {
    const queue = createKeyedQueue()
    const gate = deferred()
    const pending = queue.run('a', () => gate.promise)
    const behind = queue.run('a', async () => undefined)
    expect(queue.size).toBe(1)
    gate.resolve()
    await Promise.all([pending, behind])
    await settle()
    expect(queue.size).toBe(0)
  })

  it('keeps the key while a later task is still queued behind a settled one', async () => {
    const queue = createKeyedQueue()
    const g1 = deferred()
    const g2 = deferred()
    const first = queue.run('a', () => g1.promise)
    const second = queue.run('a', () => g2.promise)
    g1.resolve()
    await first
    await settle()
    expect(queue.size).toBe(1)
    g2.resolve()
    await second
    await settle()
    expect(queue.size).toBe(0)
  })

  it('hands a rejection to its own caller only, and still runs the task behind it', async () => {
    const queue = createKeyedQueue()
    const gate = deferred()
    const failing = queue.run('a', async () => {
      await gate.promise
    })
    const behind = queue.run('a', async () => 'ran')
    gate.reject(new Error('boom'))
    await expect(failing).rejects.toThrow('boom')
    await expect(behind).resolves.toBe('ran')
    await settle()
    expect(queue.size).toBe(0)
  })
})
