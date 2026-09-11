import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { isStreamSignalType, useEventStream, type StreamSignal } from './useEventStream'

/**
 * A controllable stand-in for `EventSource`.
 *
 * jsdom implements no `EventSource`, and a real one would need a server. This is the
 * same category of double as the `IntersectionObserver` stub in
 * `web/src/testing/setup.ts`: it stands in for a browser API and stubs no application
 * code, so what is under test — one connection, backoff, cleanup, frame parsing —
 * stays real.
 *
 * It extends `EventTarget`, so `addEventListener` and `dispatchEvent` are the
 * platform's own rather than a hand-rolled registry that could disagree with them.
 */
class FakeEventSource extends EventTarget {
  static instances: FakeEventSource[] = []

  readyState = 0
  closeCount = 0

  constructor(
    readonly url: string,
    readonly init?: EventSourceInit,
  ) {
    super()
    FakeEventSource.instances.push(this)
  }

  close(): void {
    this.closeCount += 1
    this.readyState = 2
  }

  /** The server answered and the stream is live. */
  emitOpen(): void {
    this.readyState = 1
    this.dispatchEvent(new Event('open'))
  }

  emitFrame(data: string): void {
    this.dispatchEvent(new MessageEvent('change', { data }))
  }

  emitSignal(type: string): void {
    this.emitFrame(JSON.stringify({ type }))
  }

  /** A dropped connection the browser is already retrying by itself. */
  emitDrop(): void {
    this.readyState = 0
    this.dispatchEvent(new Event('error'))
  }

  /** A refusal the browser will not retry: a 500, or the wrong content type. */
  emitRefusal(): void {
    this.readyState = 2
    this.dispatchEvent(new Event('error'))
  }
}

const latest = (): FakeEventSource => {
  const instance = FakeEventSource.instances[FakeEventSource.instances.length - 1]
  if (instance === undefined) throw new Error('no connection was opened')
  return instance
}

const URL_A = '/api/events/camille-et-sacha/stream'
const URL_B = '/api/events/gala/stream'

describe('useEventStream', () => {
  beforeEach(() => {
    FakeEventSource.instances = []
    vi.stubGlobal('EventSource', FakeEventSource)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('opens exactly one connection for the page', () => {
    renderHook(() => useEventStream({ url: URL_A, onSignal: vi.fn() }))

    expect(FakeEventSource.instances).toHaveLength(1)
    expect(latest().url).toBe(URL_A)
    expect(latest().init).toEqual({ withCredentials: true })
  })

  it('reports the connection as open once the server answers', () => {
    const { result } = renderHook(() => useEventStream({ url: URL_A, onSignal: vi.fn() }))

    expect(result.current.connected).toBe(false)

    act(() => latest().emitOpen())

    expect(result.current.connected).toBe(true)
  })

  it('hands each frame to the callback as an invalidation signal', () => {
    const onSignal = vi.fn()
    renderHook(() => useEventStream({ url: URL_A, onSignal }))

    act(() => latest().emitSignal('photo.moderated'))

    expect(onSignal).toHaveBeenCalledWith<[StreamSignal]>({ type: 'photo.moderated' })
  })

  it('delivers a signal type this build has never heard of, rather than dropping it', () => {
    // A newer server is expected to grow signals. An invalidation nobody acts on shows
    // up as a stale queue, which is worse than one redundant refetch.
    const onSignal = vi.fn()
    renderHook(() => useEventStream({ url: URL_A, onSignal }))

    act(() => latest().emitSignal('photo.somethingNew'))

    expect(onSignal).toHaveBeenCalledWith<[StreamSignal]>({ type: 'photo.somethingNew' })
    expect(isStreamSignalType('photo.somethingNew')).toBe(false)
  })

  it.each([
    ['a truncated frame', '{"type":'],
    ['a proxy error page', '<html>502</html>'],
    ['a JSON value that is not an object', '"photo.uploaded"'],
    ['an object with no type', '{"photoId":"photo-1"}'],
    ['an object whose type is not a string', '{"type":7}'],
  ])('ignores %s instead of throwing inside a listener', (_case, data) => {
    const onSignal = vi.fn()
    renderHook(() => useEventStream({ url: URL_A, onSignal }))

    act(() => latest().emitFrame(data))

    expect(onSignal).not.toHaveBeenCalled()
  })

  it('ignores a frame that carries no message at all', () => {
    // A listener can be woken by a plain `Event` — a synthetic dispatch, or a frame
    // shape a later browser introduces. There is no payload to act on, so there is no
    // signal to deliver.
    const onSignal = vi.fn()
    renderHook(() => useEventStream({ url: URL_A, onSignal }))

    act(() => void latest().dispatchEvent(new Event('change')))

    expect(onSignal).not.toHaveBeenCalled()
  })

  it('ignores a frame whose data is not text, even when its text form would parse', () => {
    // `JSON.parse` stringifies whatever it is handed, so a `data` that is not a string
    // but whose text form happens to be a valid frame would otherwise be delivered as
    // a signal. The frame contract is text; anything else is not a frame this build can
    // read, and guessing at one is how a wall acts on a payload nobody sent.
    const onSignal = vi.fn()
    renderHook(() => useEventStream({ url: URL_A, onSignal }))

    act(
      () =>
        void latest().dispatchEvent(
          new MessageEvent('change', { data: [JSON.stringify({ type: 'photo.uploaded' })] }),
        ),
    )

    expect(onSignal).not.toHaveBeenCalled()
  })

  it('leaves a browser-managed retry alone, so Last-Event-ID is resent', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useEventStream({ url: URL_A, onSignal: vi.fn() }))
    act(() => latest().emitOpen())

    act(() => latest().emitDrop())

    expect(result.current.connected).toBe(false)
    // A second connection here would be a fresh request with no Last-Event-ID, so the
    // photos published during the drop would never be replayed.
    act(() => void vi.advanceTimersByTime(60_000))
    expect(FakeEventSource.instances).toHaveLength(1)
  })

  it('reconnects itself when the browser gives up on the stream', () => {
    vi.useFakeTimers()
    renderHook(() => useEventStream({ url: URL_A, onSignal: vi.fn() }))

    act(() => latest().emitRefusal())

    expect(FakeEventSource.instances).toHaveLength(1)
    act(() => void vi.advanceTimersByTime(999))
    expect(FakeEventSource.instances).toHaveLength(1)

    act(() => void vi.advanceTimersByTime(1))
    expect(FakeEventSource.instances).toHaveLength(2)
    expect(latest().url).toBe(URL_A)
  })

  it('waits longer after each failed attempt', () => {
    vi.useFakeTimers()
    renderHook(() => useEventStream({ url: URL_A, onSignal: vi.fn() }))

    act(() => latest().emitRefusal())
    act(() => void vi.advanceTimersByTime(1_000))
    act(() => latest().emitRefusal())

    // The second wait is two seconds, so the delay that was enough last time is not.
    act(() => void vi.advanceTimersByTime(1_000))
    expect(FakeEventSource.instances).toHaveLength(2)

    act(() => void vi.advanceTimersByTime(1_000))
    expect(FakeEventSource.instances).toHaveLength(3)
  })

  it('caps the wait, so a projector rejoins a recovered server promptly', () => {
    vi.useFakeTimers()
    renderHook(() => useEventStream({ url: URL_A, onSignal: vi.fn() }))

    // Eight failures: uncapped doubling from one second would already ask for over two
    // minutes, and an unattended wall would sit stale for the rest of the evening.
    for (let failure = 0; failure < 8; failure += 1) {
      act(() => latest().emitRefusal())
      act(() => void vi.advanceTimersByTime(30_000))
    }

    expect(FakeEventSource.instances).toHaveLength(9)
  })

  it('resets the backoff once a connection succeeds', () => {
    vi.useFakeTimers()
    renderHook(() => useEventStream({ url: URL_A, onSignal: vi.fn() }))

    act(() => latest().emitRefusal())
    act(() => void vi.advanceTimersByTime(1_000))
    act(() => latest().emitOpen())
    act(() => latest().emitRefusal())

    // Back to the first delay: a flaky evening must not leave the wall waiting half a
    // minute for a drop it recovers from in one second.
    act(() => void vi.advanceTimersByTime(1_000))
    expect(FakeEventSource.instances).toHaveLength(3)
  })

  it('closes the connection when the page unmounts', () => {
    const { unmount } = renderHook(() => useEventStream({ url: URL_A, onSignal: vi.fn() }))
    const stream = latest()

    unmount()

    expect(stream.closeCount).toBe(1)
  })

  it('drops a pending reconnect when the page unmounts', () => {
    vi.useFakeTimers()
    const { unmount } = renderHook(() => useEventStream({ url: URL_A, onSignal: vi.fn() }))
    act(() => latest().emitRefusal())

    unmount()
    act(() => void vi.advanceTimersByTime(60_000))

    expect(FakeEventSource.instances).toHaveLength(1)
  })

  it('does not reconnect on a refusal that arrives after the page has gone', () => {
    // The console closes its stream as the host navigates away, and the pending error
    // callback can still run afterwards. Scheduling a reconnect from it would leave a
    // connection reopening against an unmounted screen for the rest of the evening.
    vi.useFakeTimers()
    const { unmount } = renderHook(() => useEventStream({ url: URL_A, onSignal: vi.fn() }))
    const stream = latest()

    unmount()
    act(() => stream.emitRefusal())
    act(() => void vi.advanceTimersByTime(60_000))

    expect(FakeEventSource.instances).toHaveLength(1)
  })

  it('opens nothing while it has no event to subscribe to', () => {
    const { result } = renderHook(() => useEventStream({ url: null, onSignal: vi.fn() }))

    expect(FakeEventSource.instances).toHaveLength(0)
    expect(result.current.connected).toBe(false)
  })

  it('opens nothing while disabled', () => {
    const { result } = renderHook(() =>
      useEventStream({ url: URL_A, onSignal: vi.fn(), enabled: false }),
    )

    expect(FakeEventSource.instances).toHaveLength(0)
    expect(result.current.connected).toBe(false)
  })

  it('moves to the new event when the page changes event', () => {
    const { rerender } = renderHook((url: string) => useEventStream({ url, onSignal: vi.fn() }), {
      initialProps: URL_A,
    })
    const first = latest()

    rerender(URL_B)

    expect(first.closeCount).toBe(1)
    expect(FakeEventSource.instances).toHaveLength(2)
    expect(latest().url).toBe(URL_B)
  })

  it('keeps the connection when only the callback changes identity', () => {
    // The moderation console refetches on a signal, so it re-renders on every signal
    // and hands over a fresh closure each time. Reconnecting there would drop
    // Last-Event-ID once per photo.
    const second = vi.fn()
    const { rerender } = renderHook(
      (onSignal: (signal: StreamSignal) => void) => useEventStream({ url: URL_A, onSignal }),
      { initialProps: vi.fn() },
    )
    const stream = latest()

    rerender(second)
    act(() => stream.emitSignal('photo.uploaded'))

    expect(FakeEventSource.instances).toHaveLength(1)
    expect(second).toHaveBeenCalledWith<[StreamSignal]>({ type: 'photo.uploaded' })
  })
})
