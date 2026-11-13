import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deferred } from '../../testing/deferred'
import { createReadScheduler } from './readScheduler'

/** Ring 5 in spirit: pure timing logic, driven with fake timers and reads held open by hand. */
describe('createReadScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('coalesces a burst of requests into one read', () => {
    const start = vi.fn()
    const scheduler = createReadScheduler({ start, debounceMs: 250 })

    for (let i = 0; i < 20; i += 1) scheduler.request()
    expect(start).not.toHaveBeenCalled()
    vi.advanceTimersByTime(250)

    expect(start).toHaveBeenCalledTimes(1)
  })

  it('does not push the window back when requests keep arriving, so a drizzle still gets read', () => {
    const start = vi.fn(() => undefined)
    const scheduler = createReadScheduler({ start, debounceMs: 250, tracksSettlement: false })

    for (let elapsed = 0; elapsed < 1_000; elapsed += 100) {
      scheduler.request()
      vi.advanceTimersByTime(100)
    }

    expect(start.mock.calls.length).toBeGreaterThanOrEqual(3)
  })

  it('never starts a second read while one is in flight', async () => {
    const first = deferred()
    const start = vi.fn().mockReturnValueOnce(first.promise).mockReturnValue(Promise.resolve())
    const scheduler = createReadScheduler({ start, debounceMs: 250 })
    scheduler.request()
    vi.advanceTimersByTime(250)
    expect(start).toHaveBeenCalledTimes(1)

    scheduler.request()
    vi.advanceTimersByTime(5_000)

    expect(start).toHaveBeenCalledTimes(1)
  })

  it('replays exactly one read when the one in flight settles after several requests', async () => {
    const first = deferred()
    const start = vi.fn().mockReturnValueOnce(first.promise).mockReturnValue(Promise.resolve())
    const scheduler = createReadScheduler({ start, debounceMs: 250 })
    scheduler.request()
    vi.advanceTimersByTime(250)
    scheduler.request()
    scheduler.request()
    scheduler.request()

    first.resolve()
    await vi.advanceTimersByTimeAsync(250)

    expect(start).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(start).toHaveBeenCalledTimes(2)
  })

  it('replays nothing when no request arrived while the read was in flight', async () => {
    const first = deferred()
    const start = vi.fn().mockReturnValue(first.promise)
    const scheduler = createReadScheduler({ start, debounceMs: 250 })
    scheduler.request()
    vi.advanceTimersByTime(250)

    first.resolve()
    await vi.advanceTimersByTimeAsync(5_000)

    expect(start).toHaveBeenCalledTimes(1)
  })

  it('replays after a read that failed, too', async () => {
    const first = deferred()
    const start = vi.fn().mockReturnValueOnce(first.promise).mockReturnValue(Promise.resolve())
    const scheduler = createReadScheduler({ start, debounceMs: 250 })
    scheduler.request()
    vi.advanceTimersByTime(250)
    scheduler.request()

    first.reject(new Error('network'))
    await vi.advanceTimersByTimeAsync(250)

    expect(start).toHaveBeenCalledTimes(2)
  })

  it('follows a read the owner reports by hand', () => {
    const start = vi.fn()
    const scheduler = createReadScheduler({ start, debounceMs: 250 })
    scheduler.began()

    scheduler.request()
    vi.advanceTimersByTime(1_000)
    expect(start).not.toHaveBeenCalled()

    scheduler.settled()
    vi.advanceTimersByTime(250)
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('forgets a request that a newly begun read already covers', () => {
    const start = vi.fn()
    const scheduler = createReadScheduler({ start, debounceMs: 250 })
    scheduler.began()
    scheduler.request()

    scheduler.began()
    scheduler.settled()
    vi.advanceTimersByTime(1_000)

    expect(start).not.toHaveBeenCalled()
  })

  it('starts nothing after cancel, and ignores the end of a read that was cancelled', async () => {
    const first = deferred()
    const start = vi.fn().mockReturnValue(first.promise)
    const scheduler = createReadScheduler({ start, debounceMs: 250 })
    scheduler.request()
    vi.advanceTimersByTime(250)
    scheduler.request()
    scheduler.cancel()

    first.resolve()
    await vi.advanceTimersByTimeAsync(5_000)

    expect(start).toHaveBeenCalledTimes(1)
  })

  it('can be used again after cancel', () => {
    const start = vi.fn()
    const scheduler = createReadScheduler({ start, debounceMs: 250, tracksSettlement: false })
    scheduler.cancel()

    scheduler.request()
    vi.advanceTimersByTime(250)

    expect(start).toHaveBeenCalledTimes(1)
  })

  it('starts at once when the window is zero', () => {
    const start = vi.fn()
    const scheduler = createReadScheduler({ start, debounceMs: 0, tracksSettlement: false })

    scheduler.request()

    expect(start).toHaveBeenCalledTimes(1)
  })

  it('does not wait for earlier reads when it cannot follow them', () => {
    const start = vi.fn()
    const scheduler = createReadScheduler({ start, debounceMs: 250, tracksSettlement: false })
    scheduler.request()
    vi.advanceTimersByTime(250)

    scheduler.request()
    vi.advanceTimersByTime(250)

    expect(start).toHaveBeenCalledTimes(2)
  })

  it('starts an immediate request without waiting for the window, and absorbs the pending one', async () => {
    const start = vi.fn().mockResolvedValue(undefined)
    const scheduler = createReadScheduler({ start, debounceMs: 250 })
    scheduler.request()

    scheduler.request({ immediate: true })
    expect(start).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5_000)

    expect(start).toHaveBeenCalledTimes(1)
  })

  it('does not overlap a read in flight for an immediate request either', async () => {
    const first = deferred()
    const start = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined)
    const scheduler = createReadScheduler({ start, debounceMs: 250 })
    scheduler.request({ immediate: true })

    scheduler.request({ immediate: true })
    expect(start).toHaveBeenCalledTimes(1)
    first.resolve()
    await vi.advanceTimersByTimeAsync(250)

    expect(start).toHaveBeenCalledTimes(2)
  })

  it('starts whatever it was last retargeted to', () => {
    const old = vi.fn()
    const current = vi.fn()
    const scheduler = createReadScheduler({ start: old, debounceMs: 0, tracksSettlement: false })
    scheduler.retarget(current)

    scheduler.request()

    expect(old).not.toHaveBeenCalled()
    expect(current).toHaveBeenCalledTimes(1)
  })

  it('does not start a read when one began on its own while the window was open', () => {
    const start = vi.fn()
    const scheduler = createReadScheduler({ start, debounceMs: 250 })
    scheduler.request()

    scheduler.began()
    vi.advanceTimersByTime(250)

    expect(start).not.toHaveBeenCalled()
    scheduler.settled()
    vi.advanceTimersByTime(250)
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('does not let the end of a cancelled read free the slot of the read that replaced it', async () => {
    const first = deferred()
    const second = deferred()
    const start = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const scheduler = createReadScheduler({ start, debounceMs: 0 })
    scheduler.request()
    scheduler.cancel()
    scheduler.request()
    expect(start).toHaveBeenCalledTimes(2)

    first.resolve()
    await vi.advanceTimersByTimeAsync(0)
    scheduler.request()

    expect(start).toHaveBeenCalledTimes(2)
  })
})
