import { describe, expect, it } from 'vitest'
import { deferred } from './deferred'

describe('deferred', () => {
  it('stays pending until it is resolved, then yields the value', async () => {
    const held = deferred<string>()
    let seen: string | undefined
    void held.promise.then((value) => {
      seen = value
    })
    await Promise.resolve()
    expect(seen).toBeUndefined()

    held.resolve('answer')
    await expect(held.promise).resolves.toBe('answer')
    expect(seen).toBe('answer')
  })

  it('rejects with the given cause', async () => {
    const held = deferred<string>()
    const cause = new Error('network down')
    held.reject(cause)
    await expect(held.promise).rejects.toBe(cause)
  })

  it('settles once: the first outcome wins', async () => {
    const held = deferred<number>()
    held.resolve(1)
    held.resolve(2)
    held.reject(new Error('late'))
    await expect(held.promise).resolves.toBe(1)
  })

  it('can be resolved with no argument when it carries no value', async () => {
    const held = deferred()
    held.resolve()
    await expect(held.promise).resolves.toBeUndefined()
  })
})
