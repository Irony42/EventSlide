import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setBackgroundInterval, setBackgroundTimeout } from './backgroundTimers'

describe('background timers', () => {
  const started: NodeJS.Timeout[] = []

  afterEach(() => {
    for (const timer of started) {
      clearInterval(timer)
      clearTimeout(timer)
    }
    started.length = 0
  })

  it('does not hold the process open for a repeating timer, which a raw setInterval does', () => {
    // The contrast is the point of the helper: a bare `setInterval` is ref'd.
    const raw = setInterval(() => undefined, 60_000)
    started.push(raw)
    const background = setBackgroundInterval(() => undefined, 60_000)
    started.push(background)

    expect(raw.hasRef()).toBe(true)
    expect(background.hasRef()).toBe(false)
  })

  it('does not hold the process open for a one-shot timer, which a raw setTimeout does', () => {
    const raw = setTimeout(() => undefined, 60_000)
    started.push(raw)
    const background = setBackgroundTimeout(() => undefined, 60_000)
    started.push(background)

    expect(raw.hasRef()).toBe(true)
    expect(background.hasRef()).toBe(false)
  })

  describe('while they run', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('repeats a task at its interval until the handle is cleared', () => {
      const task = vi.fn()
      const timer = setBackgroundInterval(task, 1_000)

      vi.advanceTimersByTime(3_000)
      clearInterval(timer)
      vi.advanceTimersByTime(3_000)

      expect(task).toHaveBeenCalledTimes(3)
    })

    it('runs a one-shot task once, after its delay, and not when it is cleared first', () => {
      const ran = vi.fn()
      const cleared = vi.fn()
      setBackgroundTimeout(ran, 1_000)
      clearTimeout(setBackgroundTimeout(cleared, 1_000))

      vi.advanceTimersByTime(5_000)

      expect(ran).toHaveBeenCalledTimes(1)
      expect(cleared).not.toHaveBeenCalled()
    })

    it('hands back a handle that is already unref’d, with fake timers installed too', () => {
      // The tests of every module that starts a timer run under fake timers and assert on
      // the handle, so the helper must reach whichever `setInterval` is installed.
      expect(setBackgroundInterval(() => undefined, 1_000).hasRef()).toBe(false)
      expect(setBackgroundTimeout(() => undefined, 1_000).hasRef()).toBe(false)
    })
  })
})
