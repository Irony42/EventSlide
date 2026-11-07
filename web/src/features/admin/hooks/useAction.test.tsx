import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { deferred } from '../../../testing/deferred'
import { useAction } from './useAction'

describe('useAction', () => {
  it('keeps a row pending until its own write answers, whatever the other rows do (WEB-HOST-06)', async () => {
    const writes = new Map([
      ['a', deferred<string>()],
      ['b', deferred<string>()],
    ])
    const action = (key: string) =>
      writes.get(key)?.promise ?? Promise.reject(new Error('no write'))
    const { result } = renderHook(() => useAction(action))
    let runA: Promise<unknown> = Promise.resolve()
    let runB: Promise<unknown> = Promise.resolve()
    act(() => {
      runA = result.current.run('a', 'a')
      runB = result.current.run('b', 'b')
    })
    expect(result.current.isPending('a')).toBe(true)
    expect(result.current.isPending('b')).toBe(true)

    await act(async () => {
      writes.get('b')?.resolve('done')
      await runB
    })

    expect(result.current.isPending('a')).toBe(true)
    expect(result.current.isPending('b')).toBe(false)
    expect(result.current.busy).toBe(true)

    await act(async () => {
      writes.get('a')?.resolve('done')
      await runA
    })

    expect(result.current.isPending('a')).toBe(false)
    expect(result.current.busy).toBe(false)
  })

  it('answers with the value of a write that worked and the message of one that did not', async () => {
    const { result } = renderHook(() =>
      useAction((fail: boolean) => (fail ? Promise.reject(new Error('boom')) : Promise.resolve(7))),
    )

    let worked: Awaited<ReturnType<typeof result.current.run>> | undefined
    let failed: Awaited<ReturnType<typeof result.current.run>> | undefined
    await act(async () => {
      worked = await result.current.run('row', false)
      failed = await result.current.run('row', true)
    })

    expect(worked).toEqual({ ok: true, value: 7 })
    expect(failed?.ok).toBe(false)
    expect(result.current.busy).toBe(false)
  })
})
