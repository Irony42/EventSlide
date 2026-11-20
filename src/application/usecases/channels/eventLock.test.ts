import { describe, expect, it } from 'vitest'
import { makeEventLock } from './eventLock'

const gate = () => {
  let open: () => void = () => undefined
  const closed = new Promise<void>((resolve) => {
    open = resolve
  })
  return { closed, open }
}

describe('eventLock', () => {
  it('runs the tasks of one key one after the other, in order', async () => {
    const lock = makeEventLock()
    const order: string[] = []
    const first = gate()

    const a = lock.run('e1', async () => {
      order.push('a:start')
      await first.closed
      order.push('a:end')
    })
    const b = lock.run('e1', async () => {
      order.push('b')
    })
    await Promise.resolve()
    expect(order).toEqual(['a:start'])
    first.open()
    await Promise.all([a, b])

    expect(order).toEqual(['a:start', 'a:end', 'b'])
  })

  it('lets two keys run together', async () => {
    const lock = makeEventLock()
    const held = gate()
    let other = false

    const a = lock.run('e1', () => held.closed)
    await lock.run('e2', async () => {
      other = true
    })
    expect(other).toBe(true)
    held.open()
    await a
  })

  it('hands the result back, releases the key after a failure, and passes the failure on', async () => {
    const lock = makeEventLock()

    await expect(
      lock.run('e1', async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(await lock.run('e1', async () => 42)).toBe(42)
  })
})
