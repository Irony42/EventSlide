import { render, screen } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { describe, expect, it } from 'vitest'
import { deferred } from './deferred'
import { flushPromises } from './flushPromises'

describe('flushPromises', () => {
  it('runs a chain of awaited steps to its end', async () => {
    const log: number[] = []
    const chain = async (): Promise<void> => {
      for (let step = 0; step < 200; step += 1) {
        await Promise.resolve()
        log.push(step)
      }
    }
    void chain()
    expect(log).toEqual([])

    await flushPromises()

    expect(log).toHaveLength(200)
  })

  it('applies the React update a settled promise caused', async () => {
    const held = deferred<string>()
    const Probe = () => {
      const [text, setText] = useState('waiting')
      useEffect(() => {
        void held.promise.then(setText)
      }, [])
      return <p>{text}</p>
    }
    render(<Probe />)
    held.resolve('arrived')

    await flushPromises()

    expect(screen.getByText('arrived')).toBeVisible()
  })

  it('does not wait for a promise that is still held', async () => {
    const held = deferred<string>()
    let seen = false
    void held.promise.then(() => {
      seen = true
    })

    await flushPromises()

    expect(seen).toBe(false)
  })
})
