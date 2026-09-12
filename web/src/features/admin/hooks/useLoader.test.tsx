import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useLoader } from './useLoader'
import { fr } from '../../../lib/i18n/fr'
import { ApiError } from '../../../lib/http'

/**
 * The one read behind every admin screen.
 *
 * The pages built on it assert what each of the four states looks like. What is left
 * here is which answer wins when two reads are in flight — a host pressing "Réessayer"
 * on a venue connection that then delivers both — because a stale answer landing last
 * is invisible in the markup and looks exactly like a server that lost the change.
 */

/** A promise the test settles by hand, to hold two reads open at once. */
const deferred = <T,>() => {
  let settle: (value: T) => void = () => {}
  let fail: (cause: unknown) => void = () => {}
  const promise = new Promise<T>((resolve, reject) => {
    settle = resolve
    fail = reject
  })
  return { promise, settle: (value: T) => settle(value), fail: (cause: unknown) => fail(cause) }
}

/**
 * A stable `load`, as every caller builds with `useCallback` over `useApi()`.
 *
 * Answers are thunks: a rejected promise built ahead of time is unhandled until the
 * loader reaches it, and vitest rightly fails the run for that.
 */
const loaderOf = (answers: readonly (() => Promise<string>)[]) => {
  const queue = [...answers]
  const calls: AbortSignal[] = []
  const load = (signal: AbortSignal) => {
    calls.push(signal)
    return (queue.shift() ?? (() => Promise.resolve('dernier')))()
  }
  return { load, calls }
}

describe('useLoader', () => {
  it('keeps absence and emptiness apart while the first answer is on its way', () => {
    const { result } = renderHook(() => useLoader(() => new Promise<string>(() => {})))

    expect(result.current.loading).toBe(true)
    expect(result.current.data).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('does not let a superseded read replace the current answer', async () => {
    // 1.0's admin page had no notion of which request an answer belonged to, so a slow
    // first read landing after a retry put the pre-retry event back on screen.
    const stale = deferred<string>()
    const fresh = deferred<string>()
    const { load } = loaderOf([() => stale.promise, () => fresh.promise])
    const { result } = renderHook(() => useLoader(load))

    act(() => result.current.reload())
    await act(async () => {
      fresh.settle('à jour')
      await fresh.promise
    })
    await act(async () => {
      stale.settle('périmé')
      await stale.promise
    })

    expect(result.current.data).toBe('à jour')
    expect(result.current.loading).toBe(false)
  })

  it('does not let a superseded read report a failure over the current answer', async () => {
    const stale = deferred<string>()
    const fresh = deferred<string>()
    const { load } = loaderOf([() => stale.promise, () => fresh.promise])
    const { result } = renderHook(() => useLoader(load))

    act(() => result.current.reload())
    await act(async () => {
      fresh.settle('à jour')
      await fresh.promise
    })
    await act(async () => {
      stale.fail(ApiError.network())
      await stale.promise.catch(() => undefined)
    })

    // "La connexion a échoué" over a page that just loaded successfully sends a host
    // hunting for a problem that is already over.
    expect(result.current.error).toBeNull()
    expect(result.current.data).toBe('à jour')
  })

  it('does not call an aborted read a failure', async () => {
    // The transport rethrows the browser's `AbortError` untouched. Reported as a
    // failure it would replace a page the host is reading with an error screen every
    // time a second read superseded the first.
    const aborted = deferred<string>()
    const { load } = loaderOf([() => aborted.promise])
    const { result } = renderHook(() => useLoader(load))

    await act(async () => {
      aborted.fail(new DOMException('The user aborted a request.', 'AbortError'))
      await aborted.promise.catch(() => undefined)
    })

    expect(result.current.error).toBeNull()
    expect(result.current.loading).toBe(true)
  })

  it('keeps the page the host is reading when a refresh fails', async () => {
    const { load } = loaderOf([
      () => Promise.resolve('chargé'),
      () => Promise.reject(ApiError.network()),
    ])
    const { result } = renderHook(() => useLoader(load))
    await waitFor(() => expect(result.current.data).toBe('chargé'))

    act(() => result.current.reload())

    await waitFor(() => expect(result.current.error).toBe(fr.errors.network))
    expect(result.current.data).toBe('chargé')
  })

  it('takes what a write returned, so the screen does not need a second round trip', async () => {
    const { load, calls } = loaderOf([() => Promise.resolve('chargé')])
    const { result } = renderHook(() => useLoader(load))
    await waitFor(() => expect(result.current.data).toBe('chargé'))

    act(() => result.current.replace('enregistré'))

    expect(result.current.data).toBe('enregistré')
    expect(calls).toHaveLength(1)
  })

  it('goes back to waiting when the request itself changes', async () => {
    // The identity of `load` is part of the tag: navigating from one event's settings
    // to another's must not show the first event's answer as though it were loaded.
    const { result, rerender } = renderHook(
      (load: (signal: AbortSignal) => Promise<string>) => useLoader(load),
      { initialProps: () => Promise.resolve('mariage') },
    )
    await waitFor(() => expect(result.current.data).toBe('mariage'))

    rerender(() => new Promise<string>(() => {}))

    expect(result.current.loading).toBe(true)
  })

  it('aborts the read it is abandoning, so the browser stops fetching it', async () => {
    const { load, calls } = loaderOf([() => new Promise<string>(() => {})])
    const { unmount } = renderHook(() => useLoader(load))

    unmount()

    expect(calls[0]?.aborted).toBe(true)
  })

  it('names a failure the transport did not describe with a sentence a host can read', async () => {
    const load = vi.fn(async () => {
      throw new TypeError('Cannot read properties of undefined')
    })
    const { result } = renderHook(() => useLoader(load))

    await waitFor(() => expect(result.current.error).toBe(fr.errors.unknown))
    expect(result.current.loading).toBe(false)
  })
})
