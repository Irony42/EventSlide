import { describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useArrivals } from './useArrivals'

/**
 * The half of roadmap 11.2 that decides how much of the console moves.
 *
 * Every test below is a case that *would* animate under the obvious implementation — a
 * plain entrance rule on the tile — and must not. The one test where something does move is
 * the last kind: a photo that was not there a moment ago, on a queue that was already on
 * screen.
 */
describe('useArrivals', () => {
  it('marks nothing on the first settled queue, however many photos it holds', () => {
    // Opening a console on a party that is already going is one screen, not thirty
    // arrivals. This is the case that makes an entrance rule on the tile wrong.
    const { result } = renderHook(({ list }) => useArrivals(list, true), {
      initialProps: { list: ['a', 'b', 'c'] },
    })

    expect([...result.current]).toEqual([])
  })

  it('marks a photo that arrived while the queue was already on screen', () => {
    const { result, rerender } = renderHook(({ list }) => useArrivals(list, true), {
      initialProps: { list: ['a', 'b'] as readonly string[] },
    })

    rerender({ list: ['c', 'a', 'b'] })

    expect([...result.current]).toEqual(['c'])
  })

  it('marks only what is new, not the whole refetched list', () => {
    // The stream carries an invalidation signal rather than a payload, so every signal
    // refetches the queue whole. A tile that came back unchanged did not arrive.
    const { result, rerender } = renderHook(({ list }) => useArrivals(list, true), {
      initialProps: { list: ['a'] as readonly string[] },
    })

    rerender({ list: ['c', 'b', 'a'] })

    expect([...result.current].sort()).toEqual(['b', 'c'])
  })

  it('marks the first photo of the evening, which arrives onto an empty queue', () => {
    // The nicest moment on this screen, and the one a "the list was empty, so seed it
    // silently" shortcut would throw away.
    const { result, rerender } = renderHook(({ list }) => useArrivals(list, true), {
      initialProps: { list: [] as readonly string[] },
    })

    rerender({ list: ['a'] })

    expect([...result.current]).toEqual(['a'])
  })

  it('keeps its answer across a render that changed nothing about the list', () => {
    // A selection, a keyboard move, a lightbox opening. If the mark were dropped here the
    // tile would lose its attribute mid-animation and the fade would be cut in half.
    const { result, rerender } = renderHook(({ list }) => useArrivals(list, true), {
      initialProps: { list: ['a'] as readonly string[] },
    })

    rerender({ list: ['b', 'a'] })
    expect([...result.current]).toEqual(['b'])

    rerender({ list: ['b', 'a'] })
    expect([...result.current]).toEqual(['b'])
  })

  it('marks nothing while the queue is loading, so a refetch has nothing to animate', () => {
    const { result } = renderHook(({ list }) => useArrivals(list, false), {
      initialProps: { list: ['a', 'b'] },
    })

    expect([...result.current]).toEqual([])
  })

  it('treats a filter change as a new screen rather than a queue full of arrivals', () => {
    // `setFilter` empties the list and reloads, so every photo under the new tab is
    // unseen — and none of them arrived. Without the unsettled step in between, switching
    // to "Publiées" would animate every tile in it.
    const { result, rerender } = renderHook(({ list, ready }) => useArrivals(list, ready), {
      initialProps: { list: ['a', 'b'] as readonly string[], ready: true },
    })

    rerender({ list: [], ready: false })
    rerender({ list: ['x', 'y', 'z'], ready: true })

    expect([...result.current]).toEqual([])
  })

  it('goes on marking arrivals after a filter change, rather than going quiet for good', () => {
    const { result, rerender } = renderHook(({ list, ready }) => useArrivals(list, ready), {
      initialProps: { list: ['a'] as readonly string[], ready: true },
    })

    rerender({ list: [], ready: false })
    rerender({ list: ['x'], ready: true })
    rerender({ list: ['y', 'x'], ready: true })

    expect([...result.current]).toEqual(['y'])
  })

  it('does not decide that nothing arrived when React renders twice', () => {
    // StrictMode renders every component twice in development, and the state here is a ref
    // written during render. A second pass has to find the key it just wrote and return the
    // same answer — not compare the list against itself and report an empty queue.
    const { result, rerender } = renderHook(({ list }) => useArrivals(list, true), {
      initialProps: { list: ['a'] as readonly string[] },
    })

    rerender({ list: ['b', 'a'] })
    rerender({ list: ['b', 'a'] })
    rerender({ list: ['b', 'a'] })

    expect([...result.current]).toEqual(['b'])
  })
})
