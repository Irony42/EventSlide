import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { FRAME_WINDOW, MIN_FRAMES_PER_SECOND } from '../../../design-system/budget'
import { useFrameBudget } from './useFrameBudget'

/**
 * The wall measuring itself — roadmap 11.3.
 *
 * `budget.ts` decides what a window of frames means and what to give up when it means
 * trouble. This is the part that cannot be pure: a loop that runs for eight hours on a
 * machine nobody is standing next to, on the one surface where a mistake is visible to a
 * hundred people at once.
 *
 * So what is asserted here is the behaviour of the loop rather than the arithmetic — how
 * long it waits before it acts, that it acts once rather than every frame, that it stops
 * when there is nothing left to do, and that it does not mistake a browser which stopped
 * painting for a machine that cannot cope.
 */

/** `requestAnimationFrame`, driven by hand, because a real one is a real clock. */
const driveFrames = () => {
  let nextHandle = 1
  const scheduled = new Map<number, FrameRequestCallback>()

  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
    const handle = nextHandle
    nextHandle += 1
    scheduled.set(handle, callback)
    return handle
  })
  vi.stubGlobal('cancelAnimationFrame', (handle: number): void => {
    scheduled.delete(handle)
  })

  let now = 0

  return {
    /** How many callbacks are waiting. Zero means the loop has stopped. */
    pending: (): number => scheduled.size,
    /** Paint `count` frames, each `stepMs` after the last. */
    paint(count: number, stepMs: number): void {
      act(() => {
        for (let index = 0; index < count; index += 1) {
          now += stepMs
          const waiting = [...scheduled.values()]
          scheduled.clear()
          for (const callback of waiting) callback(now)
        }
      })
    },
  }
}

/**
 * A viewer who asked for no motion.
 *
 * The shared jsdom shim answers `false` to every query, which is the browser this file
 * otherwise tests against. This replaces it for the one case where the answer decides
 * whether the loop starts at all.
 */
const asksForNoMotion = (): void => {
  vi.stubGlobal('matchMedia', (media: string) => ({
    matches: media.includes('prefers-reduced-motion: reduce'),
    media,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

/** One interval more than a window, because the first frame only starts the clock. */
const A_WINDOW = FRAME_WINDOW + 1

/** Comfortably inside any cadence; 60 Hz. */
const SMOOTH_MS = 16

/**
 * A steady 16.7 frames a second, well under `MIN_FRAMES_PER_SECOND`.
 *
 * Read off the floor rather than beside it: a constant that happened to sit under the
 * threshold when it was written is one that stops meaning anything the day the threshold
 * moves, and this file has already carried a comment naming a constant `budget.ts` had
 * thrown away.
 */
const STRUGGLING_MS = Math.ceil(1_000 / MIN_FRAMES_PER_SECOND) + 20

describe('the wall watching its own frame rate', () => {
  it('starts where the ladder says the room starts, before it has measured anything', () => {
    const frames = driveFrames()
    const { result } = renderHook(() => useFrameBudget())

    // One rung down: the room never affords the blur, measurement or no measurement.
    expect(result.current).toBe(1)
    expect(frames.pending()).toBe(1)
  })

  it('gives nothing up while the machine is holding its frames', () => {
    const frames = driveFrames()
    const { result } = renderHook(() => useFrameBudget())

    frames.paint(A_WINDOW * 4, SMOOTH_MS)

    expect(result.current).toBe(1)
  })

  it('gives nothing up for one bad window, because one bad window is a decode', () => {
    const frames = driveFrames()
    const { result } = renderHook(() => useFrameBudget())

    frames.paint(A_WINDOW, STRUGGLING_MS)

    expect(result.current).toBe(1)
  })

  it('gives up the zoom after two bad windows in a row', () => {
    // The first thing the wall has left to give: the blur went before it rendered a frame.
    const frames = driveFrames()
    const { result } = renderHook(() => useFrameBudget())

    frames.paint(A_WINDOW * 2, STRUGGLING_MS)

    expect(result.current).toBe(2)
  })

  it('then gives up the crossfade, and then has nothing left to give', () => {
    const frames = driveFrames()
    const { result } = renderHook(() => useFrameBudget())

    frames.paint(A_WINDOW * 4, STRUGGLING_MS)
    expect(result.current).toBe(3)

    // And the loop is gone. A monitor that kept sampling for the remaining seven hours
    // would be a cost with nothing left to buy — on the machine it exists to protect.
    expect(frames.pending()).toBe(0)
  })

  it('forgets a bad window once a good one follows it', () => {
    const frames = driveFrames()
    const { result } = renderHook(() => useFrameBudget())

    frames.paint(A_WINDOW, STRUGGLING_MS)
    frames.paint(A_WINDOW, SMOOTH_MS)
    frames.paint(A_WINDOW, STRUGGLING_MS)

    // Two bad windows, but not two in a row — which is a wall that hitched twice in five
    // seconds, not a wall that cannot cope.
    expect(result.current).toBe(1)
  })

  it('does not read a browser that stopped painting as a machine that cannot cope', () => {
    // A hidden tab, a closed lid, a projector asleep between two courses of a dinner.
    // The interval that arrives when it resumes is minutes long and is not a frame anybody
    // waited for. It is clamped rather than discarded — discarding threw the window away
    // with it, which meant a wall that stalled often enough never finished a window and so
    // never degraded at all.
    const frames = driveFrames()
    const { result } = renderHook(() => useFrameBudget())

    for (let round = 0; round < 6; round += 1) {
      frames.paint(A_WINDOW - 1, SMOOTH_MS)
      frames.paint(1, 600_000)
    }

    expect(result.current).toBe(1)
  })

  it('does degrade on a wall that stalls past the ceiling over and over', () => {
    // The other side of the clamp, and the failure the discarding version had: this is a
    // machine freezing for a second and a half every few frames, which is exactly the wall
    // this whole item exists for, and it must not be invisible.
    const frames = driveFrames()
    const { result } = renderHook(() => useFrameBudget())

    for (let window = 0; window < 4; window += 1) {
      for (let frame = 0; frame < A_WINDOW; frame += 1) {
        frames.paint(1, frame % 5 === 0 ? 1_500 : SMOOTH_MS)
      }
    }

    expect(result.current).toBe(3)
  })

  it('measures nothing at all for a viewer who asked for no motion', () => {
    // There is nothing to give up: Ken Burns is never declared and `base.css` has already
    // collapsed the crossfade, so a loop here would be pure cost — and could only ever
    // take something away from a wall that was not spending it.
    asksForNoMotion()
    const frames = driveFrames()
    const { result } = renderHook(() => useFrameBudget())

    expect(frames.pending()).toBe(0)
    expect(result.current).toBe(1)
  })

  it('stops sampling when the wall goes away', () => {
    const frames = driveFrames()
    const { unmount } = renderHook(() => useFrameBudget())

    frames.paint(10, SMOOTH_MS)
    expect(frames.pending()).toBe(1)

    unmount()
    expect(frames.pending()).toBe(0)
  })

  it('renders the wall again only when a rung actually changes', () => {
    // The irony this has to avoid: a frame-rate monitor that re-renders a React tree every
    // second and a half, for eight hours, on the machine driving the projector. The count
    // is the assertion because the cost is invisible in the returned value.
    const frames = driveFrames()
    let renders = 0
    renderHook(() => {
      renders += 1
      return useFrameBudget()
    })

    const mounted = renders
    frames.paint(A_WINDOW * 6, SMOOTH_MS)
    expect(renders).toBe(mounted)

    frames.paint(A_WINDOW * 2, STRUGGLING_MS)
    expect(renders).toBe(mounted + 1)
  })
})
