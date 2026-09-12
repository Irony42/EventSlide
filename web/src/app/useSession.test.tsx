import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { ApiProvider } from './ApiProvider'
import { useSession } from './useSession'
import { aSessionUser, fakeApi } from '../testing/renderWithProviders'
import type { ReactNode } from 'react'
import type { Api } from '../lib/api/client'
import type { SessionResponse } from '../lib/api/dto'

/**
 * `GET /api/auth/me`, as the state two gates read.
 *
 * `RequireAuth.test.tsx` and `MustChangePasswordGate.test.tsx` cover what each answer
 * means for a host trying to reach `/admin`. What is left here is the ordering: which
 * answer wins when two are in flight, and what the hook costs to mount — both invisible
 * from the rendered markup and both able to log a host out mid-event.
 */

const signedIn = (): SessionResponse => ({ authenticated: true, user: aSessionUser() })

/** A promise the test settles by hand, to hold two requests open at once. */
const deferred = <T,>() => {
  let settle: (value: T) => void = () => {}
  let fail: (cause: unknown) => void = () => {}
  const promise = new Promise<T>((resolve, reject) => {
    settle = resolve
    fail = reject
  })
  return { promise, settle: (value: T) => settle(value), fail: (cause: unknown) => fail(cause) }
}

interface Mounted {
  readonly result: { current: ReturnType<typeof useSession> }
  /** How many times the hook has produced a value. */
  readonly renders: () => number
}

const mount = (api: Api): Mounted => {
  let count = 0
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <ApiProvider api={api}>{children}</ApiProvider>
  )
  const { result } = renderHook(
    () => {
      count += 1
      return useSession()
    },
    { wrapper },
  )
  return { result, renders: () => count }
}

describe('useSession', () => {
  it('starts out waiting without a second render pass', () => {
    // `loading: true` is the initial state, never something the effect sets. Setting it
    // in the effect body cost a cascading render on every mount of both admin gates,
    // and `react-hooks/set-state-in-effect` rejects that form for this reason.
    const api = fakeApi({ session: vi.fn(() => new Promise<SessionResponse>(() => {})) })

    const { result, renders } = mount(api)

    expect(result.current.loading).toBe(true)
    expect(renders()).toBe(1)
  })

  it('does not let a superseded request answer for the current one', async () => {
    // The retry after a dropped connection: the first request is aborted but its
    // answer can still arrive. Allowed to land, a stale `{authenticated: false}` sends
    // a host who is perfectly well logged in back to the login form.
    const stale = deferred<SessionResponse>()
    const fresh = deferred<SessionResponse>()
    const answers = [stale.promise, fresh.promise]
    const api = fakeApi({ session: vi.fn(() => answers.shift() ?? Promise.resolve(signedIn())) })
    const { result } = mount(api)

    act(() => result.current.refresh())
    await act(async () => {
      fresh.settle(signedIn())
      await fresh.promise
    })
    await act(async () => {
      stale.settle({ authenticated: false })
      await stale.promise
    })

    expect(result.current.session).toEqual(signedIn())
  })

  it('does not let a superseded request report a failure for the current one', async () => {
    const stale = deferred<SessionResponse>()
    const fresh = deferred<SessionResponse>()
    const answers = [stale.promise, fresh.promise]
    const api = fakeApi({ session: vi.fn(() => answers.shift() ?? Promise.resolve(signedIn())) })
    const { result } = mount(api)

    act(() => result.current.refresh())
    await act(async () => {
      fresh.settle(signedIn())
      await fresh.promise
    })
    await act(async () => {
      stale.fail(new Error('network'))
      await stale.promise.catch(() => undefined)
    })

    // A failure to *ask* is not a failure to authenticate, and a failure to ask about a
    // request nobody is waiting for is not an event at all.
    expect(result.current.error).toBeNull()
    expect(result.current.session).toEqual(signedIn())
  })

  it('does not call an aborted session request a failure', async () => {
    // The transport rethrows the browser's `AbortError` untouched. Reported as a
    // failure it would put the crash screen in front of a host whose request was
    // merely superseded.
    const aborted = deferred<SessionResponse>()
    const api = fakeApi({ session: vi.fn(() => aborted.promise) })
    const { result } = mount(api)

    await act(async () => {
      aborted.fail(new DOMException('The user aborted a request.', 'AbortError'))
      await aborted.promise.catch(() => undefined)
    })

    expect(result.current.error).toBeNull()
    expect(result.current.loading).toBe(true)
  })

  it('still reports a failure the transport did not describe as an error', async () => {
    const api = fakeApi({
      session: vi.fn(async () => {
        // A transport that rejects with a bare value, not an Error: a proxy error
        // page, or a build older than this one. The branch exists for exactly that.
        throw 'réponse illisible'
      }),
    })

    const { result } = mount(api)

    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error))
    // Not "logged out": the gate above decides what an unreachable session means, and
    // it must be able to tell the two apart.
    expect(result.current.session).toBeNull()
  })
})
