import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { deferred } from '../../../testing/deferred'
import { StepUpContext } from '../stepUpContext'
import { useOperatorAction } from './useOperatorAction'

const wrapper = ({ children }: { readonly children: ReactNode }) => (
  <StepUpContext.Provider value={{ confirm: async () => true }}>{children}</StepUpContext.Provider>
)

describe('useOperatorAction', () => {
  it('keeps a row pending until its own write answers, whatever the other rows do (WEB-HOST-06)', async () => {
    const writes = new Map([
      ['a', deferred<string>()],
      ['b', deferred<string>()],
    ])
    const action = (key: string) =>
      writes.get(key)?.promise ?? Promise.reject(new Error('no write'))
    const { result } = renderHook(() => useOperatorAction(action), { wrapper })
    let runA: Promise<unknown> = Promise.resolve()
    let runB: Promise<unknown> = Promise.resolve()
    act(() => {
      runA = result.current.run('a', 'a')
      runB = result.current.run('b', 'b')
    })

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

    expect(result.current.busy).toBe(false)
  })
})
