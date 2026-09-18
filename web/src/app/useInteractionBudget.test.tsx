import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { INTERACTION_BUDGET_MS } from '../design-system/budget'
import type { GlassSurface } from '../design-system/glass'
import { useInteractionBudget } from './useInteractionBudget'

/**
 * The guest's half of the budget — roadmap 11.3.
 *
 * "A mid-range Android phone on saturated wifi, mid-upload. Blur is GPU work competing with
 * an encode and a request. The upload screen staying responsive outranks how it looks."
 *
 * A frame rate is the wrong measurement for that sentence. The upload screen is still
 * between taps, so its frames are perfect right up to the moment somebody touches it — what
 * a guest actually meets is the tap that takes a second to do anything. That is what the
 * browser's own event timing measures, and this is the loop that reads it.
 */

interface ObservedEntry {
  readonly duration: number
}

/** `PerformanceObserverInit` plus the field the DOM library does not carry. */
interface EventTimingInit extends PerformanceObserverInit {
  readonly durationThreshold?: number
}

/**
 * The browser's own default when an observer does not ask for anything lower.
 *
 * It is the number that made the missing `durationThreshold` a real defect rather than an
 * omission, so it is spelled here and honoured below.
 */
const BROWSER_DEFAULT_THRESHOLD_MS = 104

/**
 * `PerformanceObserver`, which jsdom does not have, driven by hand — **and filtering the way
 * the real one does.**
 *
 * That last part is not politeness. The version of this fake that delivered whatever a test
 * handed it let the production code ship with no `durationThreshold` at all: every fast tap
 * in these tests reached the callback and cleared a strike, while in a browser none of them
 * would have, because the default hides everything under 104 ms. So "two consecutive bad
 * verdicts" was green here and was really "two bad verdicts ever" on a phone.
 *
 * A fake that accepts what the real one drops is a fake that will lie again, and this
 * repository has shipped a critical defect through exactly that gap before. So this one
 * refuses an entry below the threshold it was configured with, which turns the tests about
 * clearing a strike into the guard for the threshold.
 */
const observeInteractions = () => {
  const callbacks: ((entries: readonly ObservedEntry[]) => void)[] = []
  const options: EventTimingInit[] = []
  let threshold = BROWSER_DEFAULT_THRESHOLD_MS
  let disconnects = 0

  class FakeObserver {
    constructor(
      private readonly callback: (list: { getEntries(): readonly ObservedEntry[] }) => void,
    ) {}

    observe(init: EventTimingInit): void {
      options.push(init)
      threshold = init.durationThreshold ?? BROWSER_DEFAULT_THRESHOLD_MS
      callbacks.push((entries) => this.callback({ getEntries: () => entries }))
    }

    disconnect(): void {
      disconnects += 1
    }
  }

  vi.stubGlobal('PerformanceObserver', FakeObserver)

  return {
    observing: (): readonly EventTimingInit[] => options,
    disconnects: (): number => disconnects,
    deliver(...durations: readonly number[]): void {
      // No entry, no callback — a browser does not wake an observer up to tell it nothing.
      const reported = durations.filter((duration) => duration >= threshold)
      if (reported.length === 0) return
      act(() => {
        for (const callback of callbacks) callback(reported.map((duration) => ({ duration })))
      })
    },
  }
}

/** A browser with no event timing at all: the observer refuses the entry type. */
const withoutEventTiming = (): void => {
  class RefusingObserver {
    observe(): void {
      throw new TypeError('event is not a valid entry type')
    }
    disconnect(): void {}
  }
  vi.stubGlobal('PerformanceObserver', RefusingObserver)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

const SLOW = INTERACTION_BUDGET_MS + 8
const QUICK = 24

describe('the guest surface watching how fast it answers a thumb', () => {
  it('starts with nothing given up, because a phone is innocent until measured', () => {
    observeInteractions()
    const { result } = renderHook(() => useInteractionBudget('guest'))

    expect(result.current).toBe(0)
  })

  it('asks the browser for interactions rather than for frames, fast ones included', () => {
    // The threshold is the load-bearing half and it was missing. Without it the browser
    // reports only interactions already over budget, so a quick tap never arrives to clear a
    // strike and the two-strike rule this surface is built on silently stops existing.
    const observer = observeInteractions()
    renderHook(() => useInteractionBudget('guest'))

    expect(observer.observing()).toEqual([{ type: 'event', durationThreshold: 16 }])
  })

  it('judges this screen and not the one before it', () => {
    // No `buffered`. The entry buffer belongs to the page rather than to the route, so a
    // guest's slow tap on the join screen was being replayed into the upload screen's first
    // verdict — a strike against a surface that had not been touched yet.
    const observer = observeInteractions()
    renderHook(() => useInteractionBudget('guest'))

    expect(observer.observing()[0]?.buffered).toBeUndefined()
  })

  it('keeps the blur while the screen is answering quickly', () => {
    const observer = observeInteractions()
    const { result } = renderHook(() => useInteractionBudget('guest'))

    observer.deliver(QUICK, QUICK, QUICK)

    expect(result.current).toBe(0)
  })

  it('keeps it through a single slow tap, which is one decode', () => {
    // A phone choosing a photograph out of a library and producing a preview for it. That
    // is the slowest thing on this screen and it happens once.
    const observer = observeInteractions()
    const { result } = renderHook(() => useInteractionBudget('guest'))

    observer.deliver(SLOW)

    expect(result.current).toBe(0)
  })

  it('gives up the blur after two slow batches in a row', () => {
    const observer = observeInteractions()
    const { result } = renderHook(() => useInteractionBudget('guest'))

    observer.deliver(SLOW)
    observer.deliver(QUICK, SLOW)

    // One rung: the blur. There is nothing under it on this surface, because the rest of
    // the ladder is the wall's and the guest's critical path is not on it at all.
    expect(result.current).toBe(1)
  })

  it('forgets a slow batch once a quick one follows it', () => {
    const observer = observeInteractions()
    const { result } = renderHook(() => useInteractionBudget('guest'))

    observer.deliver(SLOW)
    observer.deliver(QUICK)
    observer.deliver(SLOW)

    expect(result.current).toBe(0)
  })

  it('stops watching once the blur is gone', () => {
    // Everything below that rung belongs to the wall, so there is nothing further this
    // surface could decide — and an observer left running on a phone mid-upload is exactly
    // the kind of cost this whole item exists to refuse.
    const observer = observeInteractions()
    renderHook(() => useInteractionBudget('guest'))

    observer.deliver(SLOW)
    observer.deliver(SLOW)

    expect(observer.disconnects()).toBe(1)
  })

  it('never measures the room, which answers no thumb at all', () => {
    // The wall has no pointer and no glass; it reports its own frames instead. An observer
    // there would be a listener that can never fire, kept alive for eight hours.
    const observer = observeInteractions()
    const { result } = renderHook(() => useInteractionBudget('wall'))

    expect(observer.observing()).toEqual([])
    // Still one rung down, which is where the room starts and stays.
    expect(result.current).toBe(1)
  })

  it('starts again from the new floor when a shell changes which surface it is', () => {
    // Latent today — `router.tsx` gives each of the three layouts an `AppShell` with a
    // constant surface — and asserted because the alternative is a rule that holds by
    // accident. The floor was read once at mount and the effect did not depend on it, so the
    // day one shell renders two surfaces, a verdict measured on somebody's phone would have
    // followed the projector onto a screen that never had a blur to lose.
    const observer = observeInteractions()
    const { result, rerender } = renderHook(
      ({ surface }: { surface: GlassSurface }) => useInteractionBudget(surface),
      { initialProps: { surface: 'guest' as GlassSurface } },
    )

    observer.deliver(SLOW)
    observer.deliver(SLOW)
    expect(result.current).toBe(1)

    rerender({ surface: 'wall' })

    // The room's floor, not the phone's verdict: still one rung down, because that is where
    // the room starts and not because a phone was slow.
    expect(result.current).toBe(1)

    rerender({ surface: 'guest' })
    expect(result.current).toBe(0)
  })

  it('keeps the material on a browser that cannot report an interaction', () => {
    // Event timing is not everywhere. The safe direction is to leave the interface as
    // designed rather than to strip a phone nobody has measured: an unmeasured machine is
    // not a slow one, and the capability fallbacks in `tokens.css` already cover the
    // browsers that genuinely cannot paint the material.
    withoutEventTiming()
    const { result } = renderHook(() => useInteractionBudget('guest'))

    expect(result.current).toBe(0)
  })

  it('keeps it on a browser with no PerformanceObserver at all', () => {
    vi.stubGlobal('PerformanceObserver', undefined)
    const { result } = renderHook(() => useInteractionBudget('guest'))

    expect(result.current).toBe(0)
  })
})
