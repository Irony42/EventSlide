import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ApiProvider } from '../../../app/ApiProvider'
import { readGuestSession } from '../../../lib/guestSession'
import { aJoinResponse, fakeApi } from '../../../testing/renderWithProviders'
import { useJoin } from './useJoin'
import type { ReactNode } from 'react'
import type { Api } from '../../../lib/api/client'
import type { JoinResponse } from '../../../lib/api/dto'

/**
 * Resolving a join code, as state.
 *
 * `JoinPage.test.tsx` covers the screen a guest sees. What is left here happens while a
 * guest is doing something a phone makes easy and a desktop does not — pressing twice,
 * and walking away from a page mid-request on venue Wi-Fi.
 */

/** A promise the test settles by hand, to hold the join open across another action. */
const deferred = <T,>() => {
  let settle: (value: T) => void = () => {}
  const promise = new Promise<T>((resolve) => {
    settle = resolve
  })
  return { promise, settle: (value: T) => settle(value) }
}

const mount = (api: Api) => {
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <MemoryRouter initialEntries={['/join/H7K2QM']}>
      <ApiProvider api={api}>{children}</ApiProvider>
    </MemoryRouter>
  )
  return renderHook(() => useJoin(), { wrapper })
}

describe('useJoin', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('creates one guest when a thumb presses “Rejoindre” twice', async () => {
    // Two guests for one person is not a cosmetic problem: the second device cookie
    // replaces the first, and the photos already sent under it stop being theirs to
    // delete.
    const pending = deferred<JoinResponse>()
    const api = fakeApi({ join: vi.fn(() => pending.promise) })
    const { result } = mount(api)

    act(() => result.current.join({ code: 'H7K2QM', displayName: null, advance: false }))
    act(() => result.current.join({ code: 'H7K2QM', displayName: null, advance: false }))

    expect(api.join).toHaveBeenCalledTimes(1)
    await act(async () => {
      pending.settle(aJoinResponse())
      await pending.promise
    })
  })

  it('accepts a second attempt once the first has answered', async () => {
    // The guard is a lock on one request, not on the screen: a guest who adds their
    // name after the code resolved is a second, legitimate call.
    const api = fakeApi()
    const { result } = mount(api)

    act(() => result.current.join({ code: 'H7K2QM', displayName: null, advance: false }))
    await waitFor(() => expect(result.current.phase).toBe('resolved'))
    act(() => result.current.join({ code: 'H7K2QM', displayName: 'Léa', advance: false }))

    expect(api.join).toHaveBeenCalledTimes(2)
  })

  it('remembers the event even when the guest has already left the join screen', async () => {
    // The upload screen cannot refetch the event — there is no public read by slug, by
    // design — so it depends entirely on this. Written before the liveness check for
    // exactly that reason: a guest whose phone finished loading the next screen first
    // would otherwise arrive there with nothing.
    const pending = deferred<JoinResponse>()
    const api = fakeApi({ join: vi.fn(() => pending.promise) })
    const { result, unmount } = mount(api)
    act(() => result.current.join({ code: 'H7K2QM', displayName: 'Léa', advance: true }))

    unmount()
    await act(async () => {
      pending.settle(aJoinResponse({ displayName: 'Léa' }))
      await pending.promise
    })

    expect(readGuestSession('camille-et-sacha')).toEqual({
      event: aJoinResponse().event,
      displayName: 'Léa',
    })
  })
})
