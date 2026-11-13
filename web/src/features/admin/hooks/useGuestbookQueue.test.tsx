import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ApiProvider } from '../../../lib/ApiProvider'
import type { GuestbookQueueDto } from '../../../lib/api/dto'
import { fakeApi } from '../../../testing/renderWithProviders'
import { FakeEventSource } from '../../../testing/fakeEventSource'
import { useGuestbookQueue } from './useGuestbookQueue'
import type { Api } from '../../../lib/api/client'

const SLUG = 'camille-et-sacha'
const empty: GuestbookQueueDto = { items: [], pendingCount: 0 }

const mount = (api: Api) =>
  renderHook(() => useGuestbookQueue(SLUG), {
    wrapper: ({ children }: { readonly children: ReactNode }) => (
      <ApiProvider api={api}>{children}</ApiProvider>
    ),
  })

const stream = () => FakeEventSource.latest('the guestbook queue')

describe('useGuestbookQueue', () => {
  beforeEach(() => {
    FakeEventSource.reset()
    vi.stubGlobal('EventSource', FakeEventSource)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('coalesces a burst of guestbook signals into one read', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const guestbookQueue = vi.fn(async () => empty)
    mount(fakeApi({ guestbookQueue }))
    await waitFor(() => expect(guestbookQueue).toHaveBeenCalledTimes(1))

    for (let i = 0; i < 10; i += 1) act(() => stream().emitSignal('guestbook.changed'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    expect(guestbookQueue).toHaveBeenCalledTimes(2)
  })

  it('reads nothing for a signal that is not about the guestbook', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const guestbookQueue = vi.fn(async () => empty)
    mount(fakeApi({ guestbookQueue }))
    await waitFor(() => expect(guestbookQueue).toHaveBeenCalledTimes(1))

    act(() => stream().emitSignal('photo.uploaded'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })

    expect(guestbookQueue).toHaveBeenCalledTimes(1)
  })

  it('reads the queue again when the stream reopens after a drop', async () => {
    const guestbookQueue = vi.fn(async () => empty)
    mount(fakeApi({ guestbookQueue }))
    await waitFor(() => expect(guestbookQueue).toHaveBeenCalledTimes(1))
    act(() => stream().emitOpen())
    act(() => stream().emitDrop())

    act(() => stream().emitOpen())

    await waitFor(() => expect(guestbookQueue).toHaveBeenCalledTimes(2))
  })
})
