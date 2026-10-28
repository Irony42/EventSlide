import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { ApiProvider } from './ApiProvider'
import { SessionProvider } from './SessionProvider'
import { announceSessionExpired } from '../lib/sessionExpiry'
import { useForgetSession, useSession, useSessionExpired } from './useSession'
import { aSessionUser, fakeApi } from '../testing/renderWithProviders'
import type { ReactNode } from 'react'
import type { Api } from '../lib/api/client'
import type { SessionResponse } from '../lib/api/dto'

/**
 * `GET /api/auth/me`, as the state every reader under `SessionProvider` shares.
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
    <ApiProvider api={api}>
      <SessionProvider scope="test">{children}</SessionProvider>
    </ApiProvider>
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
  it('starts out waiting, and costs one pass for the request and none to say it is waiting', () => {
    // `loading: true` is the initial state, never something the effect sets. Setting it
    // in the effect body cost a cascading render on every mount of both admin gates,
    // and `react-hooks/set-state-in-effect` rejects that form for this reason. The one
    // pass is the provider noting that a reader has asked: nothing is read until then.
    const api = fakeApi({ session: vi.fn(() => new Promise<SessionResponse>(() => {})) })

    const { result, renders } = mount(api)

    expect(result.current.loading).toBe(true)
    expect(renders()).toBe(2)
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

describe('SessionProvider', () => {
  it('asks nothing until a reader mounts, so a page with no use for the session costs no request', () => {
    const api = fakeApi()

    renderHook(() => 1, {
      wrapper: ({ children }: { readonly children: ReactNode }) => (
        <ApiProvider api={api}>
          <SessionProvider scope="test">{children}</SessionProvider>
        </ApiProvider>
      ),
    })

    expect(api.session).not.toHaveBeenCalled()
  })

  it('asks once for however many readers there are', async () => {
    const api = fakeApi({ session: vi.fn(async () => signedIn()) })
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <ApiProvider api={api}>
        <SessionProvider scope="test">{children}</SessionProvider>
      </ApiProvider>
    )

    const { result } = renderHook(() => [useSession(), useSession(), useSession()], { wrapper })

    await waitFor(() => expect(result.current.every((state) => !state.loading)).toBe(true))
    expect(api.session).toHaveBeenCalledTimes(1)
    expect(result.current.map((state) => state.session)).toEqual(Array(3).fill(signedIn()))
  })

  it('reads again when the answer is forgotten while a reader is still mounted', async () => {
    let current = signedIn()
    const api = fakeApi({ session: vi.fn(async () => current) })
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <ApiProvider api={api}>
        <SessionProvider scope="test">{children}</SessionProvider>
      </ApiProvider>
    )
    const { result } = renderHook(() => ({ state: useSession(), forget: useForgetSession() }), {
      wrapper,
    })
    await waitFor(() => expect(result.current.state.loading).toBe(false))

    current = { authenticated: false }
    act(() => result.current.forget())

    // Waiting again, not the answer it held: a reader must not act on what was forgotten.
    expect(result.current.state.loading).toBe(true)
    await waitFor(() => expect(result.current.state.session).toEqual({ authenticated: false }))
    expect(api.session).toHaveBeenCalledTimes(2)
  })

  it('drops the answer the moment the scope changes, before any reader renders it', async () => {
    // The console reads this answer to decide whether to redirect. A reader that rendered the
    // old scope's "nobody" for one frame would act on it, so the reset happens in the render
    // that sees the new scope and not in an effect after it.
    let current: SessionResponse = { authenticated: false }
    const api = fakeApi({ session: vi.fn(async () => current) })
    let scope = 'open'
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <ApiProvider api={api}>
        <SessionProvider scope={scope}>{children}</SessionProvider>
      </ApiProvider>
    )
    const seen: (SessionResponse | null)[] = []
    const { result, rerender } = renderHook(
      () => {
        const state = useSession()
        seen.push(state.loading ? null : state.session)
        return state
      },
      { wrapper },
    )
    await waitFor(() => expect(result.current.session).toEqual({ authenticated: false }))

    current = signedIn()
    seen.length = 0
    scope = 'signed-in'
    rerender()

    // Never the old answer again: the first render of the new scope is already "waiting".
    expect(seen).not.toContainEqual({ authenticated: false })
    await waitFor(() => expect(result.current.session).toEqual(signedIn()))
    expect(api.session).toHaveBeenCalledTimes(2)
  })

  it('refuses a reader with no provider above it, and says which one is missing', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <ApiProvider api={fakeApi()}>{children}</ApiProvider>
    )

    expect(() => renderHook(() => useSession(), { wrapper })).toThrow(/SessionProvider/)
    quiet.mockRestore()
  })
})

/**
 * `useSessionExpired` (navigation pass, H2): the flag the expired-session banner reads. It is
 * raised by the transport's announcement and it is *only* a flag: the answer the provider holds
 * is left as it was, because dropping it would make `RequireAuth` redirect and lose the page.
 */
describe('useSessionExpired', () => {
  const mountExpired = (
    scope: string,
    api: Api = fakeApi({ session: vi.fn(async () => signedIn()) }),
  ) => {
    const wrapper =
      (current: string) =>
      ({ children }: { readonly children: ReactNode }) => (
        <ApiProvider api={api}>
          <SessionProvider scope={current}>{children}</SessionProvider>
        </ApiProvider>
      )
    const view = renderHook(
      () => ({ expired: useSessionExpired(), session: useSession(), forget: useForgetSession() }),
      { wrapper: wrapper(scope) },
    )
    return { ...view, api }
  }

  it('is false until a request is answered 401 auth.required', async () => {
    const { result } = mountExpired('signed-in')
    await waitFor(() => expect(result.current.session.loading).toBe(false))

    expect(result.current.expired).toBe(false)
  })

  it('turns true when the session ends, and keeps the answer it already held', async () => {
    const { result, api } = mountExpired('signed-in')
    await waitFor(() => expect(result.current.session.session?.authenticated).toBe(true))

    act(() => announceSessionExpired())

    expect(result.current.expired).toBe(true)
    expect(result.current.session.session?.authenticated).toBe(true)
    expect(api.session).toHaveBeenCalledTimes(1)
  })

  it('is dropped when somebody signs in or out (forget)', async () => {
    const { result } = mountExpired('signed-in')
    await waitFor(() => expect(result.current.session.loading).toBe(false))
    act(() => announceSessionExpired())

    act(() => result.current.forget())

    expect(result.current.expired).toBe(false)
  })

  it('is dropped when the host crosses the border of the signed-in area', async () => {
    const api = fakeApi({ session: vi.fn(async () => signedIn()) })
    let scope = 'signed-in'
    const { result, rerender } = renderHook(
      () => ({ expired: useSessionExpired(), session: useSession() }),
      {
        wrapper: ({ children }: { readonly children: ReactNode }) => (
          <ApiProvider api={api}>
            <SessionProvider scope={scope}>{children}</SessionProvider>
          </ApiProvider>
        ),
      },
    )
    await waitFor(() => expect(result.current.session.loading).toBe(false))
    act(() => announceSessionExpired())
    expect(result.current.expired).toBe(true)

    scope = 'open'
    rerender()

    expect(result.current.expired).toBe(false)
  })
})
