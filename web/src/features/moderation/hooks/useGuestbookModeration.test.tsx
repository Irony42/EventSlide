import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { ApiProvider } from '../../../lib/ApiProvider'
import { ToastProvider } from '../../../design-system/components/ToastProvider'
import { ApiError } from '../../../lib/http'
import { fakeApi } from '../../../testing/renderWithProviders'
import { SIGNAL_DEBOUNCE_MS, useGuestbookModeration } from './useGuestbookModeration'
import { deferred } from '../../../testing/deferred'
import type { ReactNode } from 'react'
import type { Api } from '../../../lib/api/client'
import type { GuestbookQueueItemDto } from '../../../lib/api/dto'
import type { GuestbookModerationOptions } from './useGuestbookModeration'

const SLUG = 'camille-et-sacha'

const aMessage = (overrides: Partial<GuestbookQueueItemDto> = {}): GuestbookQueueItemDto => ({
  id: 'm1',
  text: 'Bravo',
  authorName: 'Léa',
  status: 'pending',
  createdAt: '2026-11-04T20:00:00.000Z',
  allowedDecisions: ['publish', 'reject'],
  ...overrides,
})

const oneMessage = vi.fn(async () => ({ items: [aMessage()], pendingCount: 1 }))

const mount = (api: Api, options: GuestbookModerationOptions = { active: true }) => {
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <ApiProvider api={api}>
      <ToastProvider>{children}</ToastProvider>
    </ApiProvider>
  )
  return renderHook(() => useGuestbookModeration(SLUG, options), { wrapper })
}

const changed = { type: 'guestbook.changed' }

describe('useGuestbookModeration', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('reads the guestbook queue and shows the messages as they come', async () => {
    const api = fakeApi({ guestbookQueue: vi.fn(oneMessage) })
    const { result } = mount(api)
    await waitFor(() => expect(result.current.items).toHaveLength(1))
    expect(result.current.pendingCount).toBe(1)
    expect(api.guestbookQueue).toHaveBeenCalledWith(SLUG, expect.anything(), {
      status: 'pending',
      limit: 500,
    })
  })

  it('reads only the badge, with limit 1, while its tab is not the active one', async () => {
    const api = fakeApi({
      guestbookQueue: vi.fn(async () => ({ items: [aMessage()], pendingCount: 4 })),
    })
    const { result } = mount(api, { active: false })
    await waitFor(() => expect(result.current.pendingCount).toBe(4))
    expect(api.guestbookQueue).toHaveBeenCalledWith(SLUG, expect.anything(), { limit: 1 })
    expect(result.current.items).toEqual([])
  })

  it('makes no call at all when the event has no guestbook', () => {
    const api = fakeApi()
    const { result } = mount(api, { active: true, enabled: false })
    expect(result.current.loading).toBe(false)
    expect(api.guestbookQueue).not.toHaveBeenCalled()
  })

  it('rereads on guestbook.changed and ignores every other signal', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const api = fakeApi()
    const { result } = mount(api)
    await waitFor(() => expect(api.guestbookQueue).toHaveBeenCalledTimes(1))
    act(() => result.current.onSignal({ type: 'photo.moderated' }))
    await act(() => vi.advanceTimersByTimeAsync(SIGNAL_DEBOUNCE_MS * 2))
    expect(api.guestbookQueue).toHaveBeenCalledTimes(1)
    act(() => result.current.onSignal(changed))
    await act(() => vi.advanceTimersByTimeAsync(SIGNAL_DEBOUNCE_MS))
    expect(api.guestbookQueue).toHaveBeenCalledTimes(2)
  })

  it('turns three signals within the debounce window into one reading', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const api = fakeApi()
    const { result } = mount(api)
    await waitFor(() => expect(api.guestbookQueue).toHaveBeenCalledTimes(1))
    for (let i = 0; i < 3; i += 1) {
      act(() => result.current.onSignal(changed))
      await act(() => vi.advanceTimersByTimeAsync(100))
    }
    await act(() => vi.advanceTimersByTimeAsync(SIGNAL_DEBOUNCE_MS))
    expect(api.guestbookQueue).toHaveBeenCalledTimes(2)
  })

  it('keeps the list on screen when a signal-driven reading fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const guestbookQueue = vi
      .fn()
      .mockResolvedValueOnce({ items: [aMessage()], pendingCount: 1 })
      .mockRejectedValue(new ApiError(500, 'unknown'))
    const { result } = mount(fakeApi({ guestbookQueue }))
    await waitFor(() => expect(result.current.items).toHaveLength(1))
    act(() => result.current.onSignal(changed))
    await act(() => vi.advanceTimersByTimeAsync(SIGNAL_DEBOUNCE_MS))
    expect(guestbookQueue).toHaveBeenCalledTimes(2)
    expect(result.current.error).toBeNull()
    expect(result.current.items).toHaveLength(1)
  })

  it('shows the failure of a loud first reading', async () => {
    const api = fakeApi({
      guestbookQueue: vi.fn(async () => {
        throw new ApiError(403, 'client.suspended')
      }),
    })
    const { result } = mount(api)
    await waitFor(() => expect(result.current.error).not.toBeNull())
  })

  it('does not bring a decided message back to pending on a reading that predates the decision', async () => {
    let release: (() => void) | undefined
    const decide = vi.fn(
      () =>
        new Promise<undefined>((resolve) => {
          release = () => resolve(undefined)
        }),
    )
    const api = fakeApi({ guestbookQueue: vi.fn(oneMessage), decideGuestbookEntry: decide })
    const { result } = mount(api)
    await waitFor(() => expect(result.current.items).toHaveLength(1))
    let sent: Promise<void> = Promise.resolve()
    act(() => {
      sent = result.current.decide('m1', 'publish')
    })
    expect(result.current.items).toHaveLength(0)
    expect(result.current.pendingCount).toBe(0)
    // A reading that still says "pending" answers while the request is out.
    act(() => result.current.refresh())
    await waitFor(() => expect(api.guestbookQueue).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.items).toHaveLength(0)
    expect(result.current.pendingCount).toBe(0)
    await act(async () => {
      release?.()
      await sent
    })
  })

  it('sends the decision to the server', async () => {
    const api = fakeApi({ guestbookQueue: vi.fn(oneMessage) })
    const { result } = mount(api)
    await waitFor(() => expect(result.current.items).toHaveLength(1))
    await act(() => result.current.decide('m1', 'publish'))
    expect(api.decideGuestbookEntry).toHaveBeenCalledWith(SLUG, 'm1', 'publish')
  })

  it('undoes a publication of a pending message by hiding it, once', async () => {
    const api = fakeApi({ guestbookQueue: vi.fn(oneMessage) })
    const { result } = mount(api)
    await waitFor(() => expect(result.current.items).toHaveLength(1))
    await act(() => result.current.decide('m1', 'publish'))
    expect(result.current.canUndo).toBe(true)
    await act(() => result.current.undo())
    expect(api.decideGuestbookEntry).toHaveBeenLastCalledWith(SLUG, 'm1', 'hide')
    expect(result.current.canUndo).toBe(false)
  })

  it('offers no undo for a refusal of a pending message', async () => {
    const api = fakeApi({ guestbookQueue: vi.fn(oneMessage) })
    const { result } = mount(api)
    await waitFor(() => expect(result.current.items).toHaveLength(1))
    await act(() => result.current.decide('m1', 'reject'))
    expect(result.current.canUndo).toBe(false)
  })

  it('puts the message back with a reading when the server refuses the decision', async () => {
    const api = fakeApi({
      guestbookQueue: vi.fn(oneMessage),
      decideGuestbookEntry: vi.fn(async () => {
        throw new ApiError(404, 'guestbook.notFound')
      }),
    })
    const { result } = mount(api)
    await waitFor(() => expect(result.current.items).toHaveLength(1))
    await act(() => result.current.decide('m1', 'publish'))
    expect(result.current.canUndo).toBe(false)
    await waitFor(() => expect(result.current.items).toHaveLength(1))
  })

  it('puts the message back when the decision and the re-read both fail (BUG-03)', async () => {
    // The network is down: the decision fails, and so does the quiet read that would have
    // corrected the list. The message is still pending on the server and must still be listed.
    let reads = 0
    const api = fakeApi({
      guestbookQueue: vi.fn(async () => {
        reads += 1
        if (reads > 1) throw new ApiError(503, 'unavailable')
        return { items: [aMessage()], pendingCount: 1 }
      }),
      decideGuestbookEntry: vi.fn(async () => {
        throw new ApiError(503, 'unavailable')
      }),
    })
    const { result } = mount(api)
    await waitFor(() => expect(result.current.items).toHaveLength(1))

    await act(() => result.current.decide('m1', 'publish'))
    await waitFor(() => expect(api.guestbookQueue).toHaveBeenCalledTimes(2))

    expect(result.current.items.map((row) => row.id)).toEqual(['m1'])
    expect(result.current.items[0]?.status).toBe('pending')
    expect(result.current.pendingCount).toBe(1)
  })

  it('puts a failed message back at its place in the list (BUG-03)', async () => {
    let reads = 0
    const api = fakeApi({
      guestbookQueue: vi.fn(async () => {
        reads += 1
        if (reads > 1) throw new ApiError(503, 'unavailable')
        return {
          items: [aMessage({ id: 'm1' }), aMessage({ id: 'm2' }), aMessage({ id: 'm3' })],
          pendingCount: 3,
        }
      }),
      decideGuestbookEntry: vi.fn(async () => {
        throw new ApiError(503, 'unavailable')
      }),
    })
    const { result } = mount(api)
    await waitFor(() => expect(result.current.items).toHaveLength(3))

    await act(() => result.current.decide('m2', 'reject'))

    expect(result.current.items.map((row) => row.id)).toEqual(['m1', 'm2', 'm3'])
    expect(result.current.pendingCount).toBe(3)
  })

  it('reads the book again when the stream reopens after a drop', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const api = fakeApi()
    const { result } = mount(api)
    await waitFor(() => expect(api.guestbookQueue).toHaveBeenCalledTimes(1))

    act(() => result.current.onReconnect())
    await act(() => vi.advanceTimersByTimeAsync(SIGNAL_DEBOUNCE_MS))

    expect(api.guestbookQueue).toHaveBeenCalledTimes(2)
  })

  it('does not restart a read that is in flight when a signal arrives', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const first = deferred<{ items: GuestbookQueueItemDto[]; pendingCount: number }>()
    const calls: AbortSignal[] = []
    const api = fakeApi({
      guestbookQueue: vi.fn(async (_slug: string, signal?: AbortSignal) => {
        calls.push(signal ?? new AbortController().signal)
        if (calls.length === 1) return first.promise
        return { items: [aMessage()], pendingCount: 1 }
      }),
    })
    const { result } = mount(api)
    await waitFor(() => expect(calls).toHaveLength(1))

    act(() => result.current.onSignal(changed))
    await act(() => vi.advanceTimersByTimeAsync(SIGNAL_DEBOUNCE_MS * 2))

    // The read on the wire is neither aborted nor doubled: the signal only marks it stale.
    expect(calls).toHaveLength(1)
    expect(calls[0]?.aborted).toBe(false)

    await act(async () => {
      first.resolve({ items: [aMessage()], pendingCount: 1 })
      await vi.advanceTimersByTimeAsync(SIGNAL_DEBOUNCE_MS)
    })
    // One replay once it has answered.
    expect(calls).toHaveLength(2)
  })

  it('reads again on a later signal after a read that failed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let reads = 0
    const api = fakeApi({
      guestbookQueue: vi.fn(async () => {
        reads += 1
        if (reads === 2) throw new ApiError(503, 'unavailable')
        return { items: [aMessage()], pendingCount: 1 }
      }),
    })
    const { result } = mount(api)
    await waitFor(() => expect(reads).toBe(1))

    act(() => result.current.onSignal(changed))
    await act(() => vi.advanceTimersByTimeAsync(SIGNAL_DEBOUNCE_MS))
    expect(reads).toBe(2)
    act(() => result.current.onSignal(changed))
    await act(() => vi.advanceTimersByTimeAsync(SIGNAL_DEBOUNCE_MS))

    expect(reads).toBe(3)
  })
})
