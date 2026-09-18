import { StrictMode } from 'react'
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

  it('marks nothing when a decision refills the page from the photos still waiting', () => {
    // The case every other test in this file was too short to reach, and the one that would
    // have shipped: the console asks for no `limit`, so the server's default of 60 applies,
    // and the pending tab is oldest-first. On a queue 72 deep the host publishes the twelve
    // they are looking at, the page refills from row 61 with photos that have been waiting
    // all evening, and none of those ids were on the previous page. Marking "new id" there
    // fades and rises twelve tiles at once, on the screen §7 says must stay readable.
    const queue = Array.from({ length: 72 }, (_, at) => `p${String(at).padStart(3, '0')}`)
    const page = queue.slice(0, 60)

    const { result, rerender } = renderHook(({ list }) => useArrivals(list, true), {
      initialProps: { list: page as readonly string[] },
    })

    // Twelve published off the front; the cap backfills p060–p071, all of them older than
    // anything a guest has sent since the console opened.
    rerender({ list: queue.slice(12) })

    expect([...result.current]).toEqual([])
  })

  it('still marks a real arrival on a queue long enough to be paged', () => {
    // The other half, so the fix above is a rule and not a way of switching the feature off:
    // a page that kept every photo it was showing and gained one has genuinely gained one.
    const page = Array.from({ length: 60 }, (_, at) => `p${String(at).padStart(3, '0')}`)

    const { result, rerender } = renderHook(({ list }) => useArrivals(list, true), {
      initialProps: { list: page as readonly string[] },
    })

    rerender({ list: [...page, 'p060'] })

    expect([...result.current]).toEqual(['p060'])
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

  it('holds its answer while the same list is rendered again and again', () => {
    // The hook adjusts state during render, so the render that follows has to recognise the
    // list it just recorded and return the same set rather than comparing the list against
    // itself and reporting an empty queue. That is what keeps a tile's animation from being
    // cancelled mid-flight by a selection, a keyboard move or a lightbox opening.
    //
    // Renamed from "when React renders twice": it said the state was "a ref written during
    // render", which it is not — `useArrivals` uses `useState`, and its own comment records
    // that a ref was the rejected first draft. Repeated `rerender` calls are also not
    // StrictMode's double-invoke; the case below is the one this actually pins.
    const { result, rerender } = renderHook(({ list }) => useArrivals(list, true), {
      initialProps: { list: ['a'] as readonly string[] },
    })

    rerender({ list: ['b', 'a'] })
    rerender({ list: ['b', 'a'] })
    rerender({ list: ['b', 'a'] })

    expect([...result.current]).toEqual(['b'])
  })

  it('survives the double render StrictMode does in development', () => {
    // The real thing, which the test above was named for and did not do: StrictMode invokes
    // the render function twice for the same commit. A hook that adjusts state during render
    // has to converge — the second invocation must not see its own write as a list change
    // and clear the marks out from under an animation that has not started yet.
    const { result, rerender } = renderHook(({ list }) => useArrivals(list, true), {
      initialProps: { list: ['a'] as readonly string[] },
      wrapper: ({ children }) => <StrictMode>{children}</StrictMode>,
    })

    rerender({ list: ['b', 'a'] })

    expect([...result.current]).toEqual(['b'])
  })
})
