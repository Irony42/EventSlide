import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { ApiProvider } from '../../../app/ApiProvider'
import { readGuestSession, rememberGuestSession } from '../../../lib/guestSession'
import { ApiError } from '../../../lib/http'
import {
  aPrivacyNotice,
  aPrivacyNoticeState,
  aPublicEvent,
  fakeApi,
} from '../../../testing/renderWithProviders'
import { usePrivacyNotice } from './usePrivacyNotice'
import type { ReactNode } from 'react'
import type { Api } from '../../../lib/api/client'
import type { PrivacyNoticeState } from '../../../lib/api/dto'

const SLUG = 'camille-et-sacha'

const UNREAD = aPrivacyNoticeState({ acknowledgement: 'none' })
const READ = aPrivacyNoticeState({ acknowledgement: 'current' })

/** A promise a test settles by hand, to order a read against a tap. */
const deferred = <T,>() => {
  let settle: (value: T) => void = () => {}
  const promise = new Promise<T>((resolve) => {
    settle = resolve
  })
  return { promise, settle }
}

const mount = (api: Api, initial: PrivacyNoticeState | null) =>
  renderHook(() => usePrivacyNotice(SLUG, initial), {
    wrapper: ({ children }: { readonly children: ReactNode }) => (
      <ApiProvider api={api}>{children}</ApiProvider>
    ),
  })

const comeBackIntoView = (): void => {
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

describe('usePrivacyNotice', () => {
  beforeEach(() => {
    sessionStorage.clear()
    rememberGuestSession({ event: aPublicEvent(), displayName: 'Léa', privacyNotice: UNREAD })
  })

  it('starts from what the join left, before any request has answered', () => {
    const api = fakeApi({ privacyNotice: vi.fn(() => new Promise<PrivacyNoticeState>(() => {})) })

    const { result } = mount(api, UNREAD)

    expect(result.current.mustAcknowledge).toBe(true)
  })

  it('takes the server’s fresh answer over the snapshot, and keeps it for a reload', async () => {
    const api = fakeApi({ privacyNotice: vi.fn(async () => READ) })

    const { result } = mount(api, UNREAD)

    await waitFor(() => expect(result.current.mustAcknowledge).toBe(false))
    expect(readGuestSession(SLUG)?.privacyNotice).toEqual(READ)
  })

  it('asks again whenever the page comes back into view', async () => {
    const privacyNotice = vi.fn(async () => READ)
    mount(fakeApi({ privacyNotice }), READ)
    await waitFor(() => expect(privacyNotice).toHaveBeenCalledTimes(1))

    comeBackIntoView()

    await waitFor(() => expect(privacyNotice).toHaveBeenCalledTimes(2))
  })

  it('stands aside while nothing is known, for a tab that joined before notices existed', () => {
    const api = fakeApi({ privacyNotice: vi.fn(() => new Promise<PrivacyNoticeState>(() => {})) })

    const { result } = mount(api, null)

    expect(result.current.state).toBeNull()
    expect(result.current.mustAcknowledge).toBe(false)
  })

  it('hands over the picker at the tap, without waiting on the network', async () => {
    const api = fakeApi({
      privacyNotice: vi.fn(async () => UNREAD),
      acknowledgePrivacyNotice: vi.fn(() => new Promise<PrivacyNoticeState>(() => {})),
    })
    const { result } = mount(api, UNREAD)
    await waitFor(() => expect(api.privacyNotice).toHaveBeenCalled())

    act(() => result.current.acknowledge())

    expect(result.current.mustAcknowledge).toBe(false)
  })

  it('does not let a read that set off before the tap put the notice back', async () => {
    const read = deferred<PrivacyNoticeState>()
    const api = fakeApi({
      privacyNotice: vi.fn(() => read.promise),
      acknowledgePrivacyNotice: vi.fn(() => new Promise<PrivacyNoticeState>(() => {})),
    })
    const { result } = mount(api, UNREAD)

    act(() => result.current.acknowledge())
    await act(async () => {
      read.settle(UNREAD)
      await read.promise
    })

    expect(result.current.mustAcknowledge).toBe(false)
  })

  it('writes the server’s confirmation to the session, so a reload does not ask again', async () => {
    const api = fakeApi({
      privacyNotice: vi.fn(async () => UNREAD),
      acknowledgePrivacyNotice: vi.fn(async () => READ),
    })
    const { result } = mount(api, UNREAD)
    await waitFor(() => expect(api.privacyNotice).toHaveBeenCalled())

    act(() => result.current.acknowledge())

    await waitFor(() =>
      expect(readGuestSession(SLUG)?.privacyNotice?.acknowledgement).toBe('current'),
    )
  })

  it('does not write a tap the server never confirmed, so a reload asks rather than pretends', async () => {
    const api = fakeApi({
      privacyNotice: vi.fn(async () => UNREAD),
      acknowledgePrivacyNotice: vi.fn(async () => Promise.reject(ApiError.network())),
    })
    const { result } = mount(api, UNREAD)
    await waitFor(() => expect(api.privacyNotice).toHaveBeenCalled())

    act(() => result.current.acknowledge())
    await waitFor(() => expect(api.acknowledgePrivacyNotice).toHaveBeenCalled())

    expect(readGuestSession(SLUG)?.privacyNotice?.acknowledgement).toBe('none')
  })

  it('sends a lost tap again once a read says the same notice is still unread', async () => {
    // Acknowledged offline: the guest has read it, and asking them twice because the
    // request did not land would charge them for the venue's Wi-Fi.
    const acknowledgePrivacyNotice = vi
      .fn<Api['acknowledgePrivacyNotice']>()
      .mockRejectedValueOnce(ApiError.network())
      .mockResolvedValue(READ)
    const api = fakeApi({ privacyNotice: vi.fn(async () => UNREAD), acknowledgePrivacyNotice })
    const { result } = mount(api, UNREAD)
    await waitFor(() => expect(api.privacyNotice).toHaveBeenCalledTimes(1))
    act(() => result.current.acknowledge())
    await waitFor(() => expect(acknowledgePrivacyNotice).toHaveBeenCalledTimes(1))

    comeBackIntoView()

    await waitFor(() => expect(acknowledgePrivacyNotice).toHaveBeenCalledTimes(2))
    expect(acknowledgePrivacyNotice).toHaveBeenLastCalledWith(SLUG, UNREAD.notice.revision)
    expect(result.current.mustAcknowledge).toBe(false)
  })

  it('does not replay a lost tap for a notice the host has since changed', async () => {
    const changed = aPrivacyNoticeState({
      notice: aPrivacyNotice({ revision: 'r2', retentionDays: 7 }),
      acknowledgement: 'none',
    })
    const privacyNotice = vi
      .fn<Api['privacyNotice']>()
      .mockResolvedValueOnce(UNREAD)
      .mockResolvedValue(changed)
    const api = fakeApi({
      privacyNotice,
      acknowledgePrivacyNotice: vi.fn(async () => Promise.reject(ApiError.network())),
    })
    const { result } = mount(api, UNREAD)
    await waitFor(() => expect(privacyNotice).toHaveBeenCalledTimes(1))
    act(() => result.current.acknowledge())
    await waitFor(() => expect(api.acknowledgePrivacyNotice).toHaveBeenCalledTimes(1))

    comeBackIntoView()

    await waitFor(() => expect(result.current.state?.notice.revision).toBe('r2'))
    expect(result.current.mustAcknowledge).toBe(true)
    expect(api.acknowledgePrivacyNotice).toHaveBeenCalledTimes(1)
  })

  it('does nothing on a tap while no notice is known', () => {
    const api = fakeApi({ privacyNotice: vi.fn(() => new Promise<PrivacyNoticeState>(() => {})) })
    const { result } = mount(api, null)

    act(() => result.current.acknowledge())

    expect(api.acknowledgePrivacyNotice).not.toHaveBeenCalled()
  })
})
