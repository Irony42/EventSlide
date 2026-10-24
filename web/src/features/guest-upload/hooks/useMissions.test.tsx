import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { ApiProvider } from '../../../app/ApiProvider'
import { aGuestMission, fakeApi } from '../../../testing/renderWithProviders'
import { useMissions } from './useMissions'
import type { ReactNode } from 'react'
import type { Api } from '../../../lib/api/client'

const SLUG = 'camille-et-sacha'

const mount = (api: Api) =>
  renderHook(() => useMissions(SLUG), {
    wrapper: ({ children }: { readonly children: ReactNode }) => (
      <ApiProvider api={api}>{children}</ApiProvider>
    ),
  })

describe('useMissions', () => {
  it('reads the guest checklist once, for their own event', async () => {
    const api = fakeApi({
      myMissions: vi.fn(async () => ({
        items: [aGuestMission({ id: 'm1', prompt: 'un selfie' })],
      })),
    })

    const { result } = mount(api)

    await waitFor(() => expect(result.current.missions).toHaveLength(1))
    expect(api.myMissions).toHaveBeenCalledWith(SLUG, expect.any(AbortSignal))
  })

  it('starts with nothing chosen', async () => {
    const api = fakeApi({
      myMissions: vi.fn(async () => ({ items: [aGuestMission({ id: 'm1' })] })),
    })

    const { result } = mount(api)

    await waitFor(() => expect(result.current.missions).toHaveLength(1))
    expect(result.current.selected).toBeNull()
  })

  it('chooses a prompt, and clears it on a second tap', async () => {
    const api = fakeApi({
      myMissions: vi.fn(async () => ({ items: [aGuestMission({ id: 'm1' })] })),
    })
    const { result } = mount(api)
    await waitFor(() => expect(result.current.missions).toHaveLength(1))

    act(() => result.current.toggle('m1'))
    expect(result.current.selected).toBe('m1')

    act(() => result.current.toggle('m1'))
    expect(result.current.selected).toBeNull()
  })

  it('moves the choice to another prompt rather than holding both', async () => {
    const api = fakeApi({
      myMissions: vi.fn(async () => ({
        items: [aGuestMission({ id: 'm1' }), aGuestMission({ id: 'm2' })],
      })),
    })
    const { result } = mount(api)
    await waitFor(() => expect(result.current.missions).toHaveLength(2))

    act(() => result.current.toggle('m1'))
    act(() => result.current.toggle('m2'))

    expect(result.current.selected).toBe('m2')
  })

  it('drops a choice the host has since deleted, so the next send is not refused', async () => {
    // `mission.notFound` refuses the whole batch, which on venue Wi-Fi costs the guest
    // every photograph they had queued. Sending them untagged is the better failure: the
    // photographs arrive, and the row they were meant for is gone anyway.
    let items = [aGuestMission({ id: 'm1' })]
    const api = fakeApi({ myMissions: vi.fn(async () => ({ items })) })
    const { result } = mount(api)
    await waitFor(() => expect(result.current.missions).toHaveLength(1))
    act(() => result.current.toggle('m1'))

    items = []
    act(() => result.current.refresh())

    await waitFor(() => expect(result.current.selected).toBeNull())
  })

  it('keeps a choice the refetch still knows about', async () => {
    const api = fakeApi({
      myMissions: vi.fn(async () => ({ items: [aGuestMission({ id: 'm1', done: true })] })),
    })
    const { result } = mount(api)
    await waitFor(() => expect(result.current.missions).toHaveLength(1))
    act(() => result.current.toggle('m1'))

    act(() => result.current.refresh())

    await waitFor(() => expect(result.current.missions[0]?.done).toBe(true))
    expect(result.current.selected).toBe('m1')
  })

  it('says nothing and shows nothing when the read fails', async () => {
    // The checklist is an invitation, not a report. A guest whose network dropped while
    // it was loading still has to be able to send their photographs, and a red sentence
    // above the picker would be this feature getting in the way of the product.
    const api = fakeApi({ myMissions: vi.fn(async () => Promise.reject(new Error('offline'))) })

    const { result } = mount(api)

    await waitFor(() => expect(api.myMissions).toHaveBeenCalled())
    expect(result.current.missions).toEqual([])
    expect(Object.keys(result.current)).toEqual(['missions', 'selected', 'toggle', 'refresh'])
  })
})

/**
 * The read underneath is `useLoader`'s. What the checklist relies on from it is pinned here, at
 * the screen's own surface: which answer wins, what a failure leaves behind, and what happens
 * when the guest leaves.
 */
describe('useMissions: its read', () => {
  /** A promise the test settles by hand, to hold two reads open at once. */
  const deferred = <T,>() => {
    let settle: (value: T) => void = () => {}
    const promise = new Promise<T>((resolve) => {
      settle = resolve
    })
    return { promise, settle: (value: T) => settle(value) }
  }

  type Mine = { readonly items: readonly ReturnType<typeof aGuestMission>[] }

  it('does not let a superseded read replace the current checklist', async () => {
    // The checklist refetches after every settled upload, and on venue Wi-Fi two of those can
    // be in flight at once. The slow first one landing last would put back a prompt the guest
    // has just answered.
    const stale = deferred<Mine>()
    const fresh = deferred<Mine>()
    const answers = [() => stale.promise, () => fresh.promise]
    const api = fakeApi({
      myMissions: vi.fn(() => (answers.shift() ?? (() => Promise.resolve({ items: [] })))()),
    })
    const { result } = mount(api)

    act(() => result.current.refresh())
    await act(async () => {
      fresh.settle({ items: [aGuestMission({ id: 'm2', done: true })] })
      await fresh.promise
    })
    await act(async () => {
      stale.settle({ items: [aGuestMission({ id: 'm1' })] })
      await stale.promise
    })

    expect(result.current.missions.map((mission) => mission.id)).toEqual(['m2'])
  })

  it('leaves the checklist as it was when a refresh fails', async () => {
    const api = fakeApi({
      myMissions: vi
        .fn<Api['myMissions']>()
        .mockResolvedValueOnce({ items: [aGuestMission({ id: 'm1' })] })
        .mockRejectedValue(new Error('offline')),
    })
    const { result } = mount(api)
    await waitFor(() => expect(result.current.missions).toHaveLength(1))

    act(() => result.current.refresh())

    await waitFor(() => expect(api.myMissions).toHaveBeenCalledTimes(2))
    expect(result.current.missions.map((mission) => mission.id)).toEqual(['m1'])
  })

  it('is filled by the next refresh after a first read that failed', async () => {
    // "The next settled upload retries it": the guest who started offline gets their checklist
    // as soon as a photo goes through, without reloading the page.
    const api = fakeApi({
      myMissions: vi
        .fn<Api['myMissions']>()
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValue({ items: [aGuestMission({ id: 'm1' })] }),
    })
    const { result } = mount(api)
    await waitFor(() => expect(api.myMissions).toHaveBeenCalledTimes(1))
    expect(result.current.missions).toEqual([])

    act(() => result.current.refresh())

    await waitFor(() => expect(result.current.missions).toHaveLength(1))
  })

  it('gives up its read when the guest leaves the screen', async () => {
    const signals: AbortSignal[] = []
    const api = fakeApi({
      myMissions: vi.fn((_slug: string, signal?: AbortSignal) => {
        if (signal !== undefined) signals.push(signal)
        return new Promise<Mine>(() => {})
      }),
    })
    const { unmount } = mount(api)
    await waitFor(() => expect(signals).toHaveLength(1))

    unmount()

    expect(signals[0]?.aborted).toBe(true)
  })
})
