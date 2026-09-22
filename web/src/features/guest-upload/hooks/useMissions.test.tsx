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
