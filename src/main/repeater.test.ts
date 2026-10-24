import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRepeater } from './repeater'

describe('createRepeater', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('ticks at its interval once started, and not before the first interval', () => {
    const tick = vi.fn()
    const repeater = createRepeater({ everyMs: 1_000, tick })

    repeater.start()
    vi.advanceTimersByTime(999)
    expect(tick).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1 + 2_000)
    expect(tick).toHaveBeenCalledTimes(3)
    repeater.stop()
  })

  it('starts one timer however often it is asked to', () => {
    const tick = vi.fn()
    const repeater = createRepeater({ everyMs: 1_000, tick })

    repeater.start()
    repeater.start()
    repeater.start()
    vi.advanceTimersByTime(1_000)

    expect(tick).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(1)
    repeater.stop()
  })

  it('stops ticking when stopped, and stopping twice, or before starting, is nothing', () => {
    const tick = vi.fn()
    const repeater = createRepeater({ everyMs: 1_000, tick })

    repeater.stop()
    repeater.start()
    repeater.stop()
    repeater.stop()
    vi.advanceTimersByTime(5_000)

    expect(tick).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('can be started again after it was stopped', () => {
    const tick = vi.fn()
    const repeater = createRepeater({ everyMs: 1_000, tick })
    repeater.start()
    repeater.stop()

    repeater.start()
    vi.advanceTimersByTime(1_000)

    expect(tick).toHaveBeenCalledTimes(1)
    repeater.stop()
  })

  it('says it is active from start to stop', () => {
    const repeater = createRepeater({ everyMs: 1_000, tick: () => undefined })

    expect(repeater.active).toBe(false)
    repeater.start()
    expect(repeater.active).toBe(true)
    repeater.stop()
    expect(repeater.active).toBe(false)
  })

  it('never holds the process open: its interval is unref’d', () => {
    // `docker stop` waits out an interval that is still ref’d, and the retention sweep's is an hour.
    const interval = vi.spyOn(globalThis, 'setInterval')
    const repeater = createRepeater({ everyMs: 1_000, tick: () => undefined })

    repeater.start()

    expect(interval).toHaveBeenCalledTimes(1)
    expect(interval.mock.results[0]?.value.hasRef()).toBe(false)
    repeater.stop()
  })

  describe('with a first delay', () => {
    it('ticks once after the delay, then on the interval from there', () => {
      const tick = vi.fn()
      const repeater = createRepeater({ everyMs: 1_000, firstDelayMs: 250, tick })

      repeater.start()
      vi.advanceTimersByTime(249)
      expect(tick).not.toHaveBeenCalled()

      vi.advanceTimersByTime(1)
      expect(tick).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(999)
      expect(tick).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(1)
      expect(tick).toHaveBeenCalledTimes(2)
      repeater.stop()
    })

    it('never holds the process open: the wait and the interval after it are both unref’d', () => {
      const timeout = vi.spyOn(globalThis, 'setTimeout')
      const interval = vi.spyOn(globalThis, 'setInterval')
      const repeater = createRepeater({ everyMs: 1_000, firstDelayMs: 250, tick: () => undefined })

      repeater.start()
      vi.advanceTimersByTime(250)

      expect(timeout.mock.results[0]?.value.hasRef()).toBe(false)
      expect(interval.mock.results[0]?.value.hasRef()).toBe(false)
      repeater.stop()
    })

    it('is active while it waits for the first tick, and starts one timer however often it is asked', () => {
      const tick = vi.fn()
      const repeater = createRepeater({ everyMs: 1_000, firstDelayMs: 250, tick })

      repeater.start()
      repeater.start()

      expect(repeater.active).toBe(true)
      expect(vi.getTimerCount()).toBe(1)
      repeater.stop()
    })

    it('stopped during the wait, never ticks and leaves no timer behind', () => {
      const tick = vi.fn()
      const repeater = createRepeater({ everyMs: 1_000, firstDelayMs: 250, tick })
      repeater.start()

      repeater.stop()
      vi.advanceTimersByTime(10_000)

      expect(tick).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
      expect(repeater.active).toBe(false)
    })

    it('stopped after the first tick, ticks no more', () => {
      const tick = vi.fn()
      const repeater = createRepeater({ everyMs: 1_000, firstDelayMs: 250, tick })
      repeater.start()
      vi.advanceTimersByTime(250)

      repeater.stop()
      vi.advanceTimersByTime(10_000)

      expect(tick).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    })
  })
})
