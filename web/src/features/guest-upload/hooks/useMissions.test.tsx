import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { ApiProvider } from '../../../app/ApiProvider'
import { aGuestMission, fakeApi } from '../../../testing/renderWithProviders'
import { CHALLENGE_POLL_MS, useMissions } from './useMissions'
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
    // Still no loading flag and no error: the two this screen deliberately never reports.
    expect(Object.keys(result.current)).toEqual([
      'missions',
      'selected',
      'toggle',
      'select',
      'refresh',
      'challenge',
      'offsetMs',
    ])
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

/**
 * The phone side of the timed challenge (spec 10): it has no event stream, so it asks again.
 */
describe('useMissions: the timed challenge', () => {
  const running = (leftMs = 60_000) => ({
    id: 'c1',
    missionId: 'm1',
    prompt: 'un selfie',
    endsAt: new Date(Date.now() + leftMs).toISOString(),
    state: 'running' as const,
  })

  const setVisibility = (state: 'visible' | 'hidden'): void => {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  }

  const oneMission = () => vi.fn(async () => ({ items: [aGuestMission({ id: 'm1' })] }))

  beforeEach(() => {
    // Jitter pinned to its middle, so a poll is exactly twenty seconds.
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    vi.useFakeTimers({ shouldAdvanceTime: true })
    setVisibility('visible')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    setVisibility('visible')
  })

  it('exposes the challenge and the offset to the server clock', async () => {
    const api = fakeApi({
      myMissions: vi.fn(async () => ({
        items: [aGuestMission({ id: 'm1' })],
        serverNowMs: Date.now() - 180_000,
        challenge: running(),
      })),
    })

    const { result } = mount(api)

    await waitFor(() => expect(result.current.challenge?.id).toBe('c1'))
    expect(result.current.offsetMs).toBeLessThan(-170_000)
    expect(result.current.offsetMs).toBeGreaterThan(-190_000)
  })

  it('has no challenge for a server that does not send one', async () => {
    const { result } = mount(fakeApi({ myMissions: oneMission() }))

    await waitFor(() => expect(result.current.missions).toHaveLength(1))
    expect(result.current.challenge).toBeNull()
    expect(result.current.offsetMs).toBe(0)
  })

  it('reads again every twenty seconds while the host has prompts', async () => {
    const api = fakeApi({ myMissions: oneMission() })
    const { result } = mount(api)
    await waitFor(() => expect(result.current.missions).toHaveLength(1))
    expect(api.myMissions).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHALLENGE_POLL_MS)
    })
    await waitFor(() => expect(api.myMissions).toHaveBeenCalledTimes(2))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHALLENGE_POLL_MS)
    })
    await waitFor(() => expect(api.myMissions).toHaveBeenCalledTimes(3))
  })

  it('spreads the reads: the delay is jittered, not the same for every phone', async () => {
    vi.mocked(Math.random).mockReturnValue(0)
    const api = fakeApi({ myMissions: oneMission() })
    const { result } = mount(api)
    await waitFor(() => expect(result.current.missions).toHaveLength(1))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHALLENGE_POLL_MS * 0.85 + 50)
    })

    await waitFor(() => expect(api.myMissions).toHaveBeenCalledTimes(2))
  })

  it('never reads again on an event whose host set no prompts', async () => {
    const api = fakeApi({ myMissions: vi.fn(async () => ({ items: [] })) })
    const { result } = mount(api)
    await waitFor(() => expect(api.myMissions).toHaveBeenCalledTimes(1))
    expect(result.current.missions).toEqual([])

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHALLENGE_POLL_MS * 3)
    })

    expect(api.myMissions).toHaveBeenCalledTimes(1)
  })

  it('does not read while the page is hidden, and reads at once when it comes back', async () => {
    const api = fakeApi({ myMissions: oneMission() })
    const { result } = mount(api)
    await waitFor(() => expect(result.current.missions).toHaveLength(1))
    setVisibility('hidden')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHALLENGE_POLL_MS * 2)
    })
    expect(api.myMissions).toHaveBeenCalledTimes(1)

    setVisibility('visible')
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    await waitFor(() => expect(api.myMissions).toHaveBeenCalledTimes(2))
  })

  it('stops asking when the screen goes away', async () => {
    const api = fakeApi({ myMissions: oneMission() })
    const { result, unmount } = mount(api)
    await waitFor(() => expect(result.current.missions).toHaveLength(1))

    expect(vi.getTimerCount()).toBeGreaterThan(0)
    unmount()
    await vi.advanceTimersByTimeAsync(CHALLENGE_POLL_MS * 3)

    expect(vi.getTimerCount()).toBe(0)
    expect(api.myMissions).toHaveBeenCalledTimes(1)
  })

  it('chooses a mission without a second tap clearing it', async () => {
    const { result } = mount(fakeApi({ myMissions: oneMission() }))
    await waitFor(() => expect(result.current.missions).toHaveLength(1))

    act(() => result.current.select('m1'))
    act(() => result.current.select('m1'))

    expect(result.current.selected).toBe('m1')
  })
})
