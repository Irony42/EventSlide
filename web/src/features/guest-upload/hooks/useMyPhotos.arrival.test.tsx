import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ApiProvider } from '../../../app/ApiProvider'
import { aGuestPhoto, fakeApi } from '../../../testing/renderWithProviders'
import { useMyPhotos } from './useMyPhotos'
import type { Api } from '../../../lib/api/client'
import type { GuestPhotoDto, PhotoStatus } from '../../../lib/api/dto'

/**
 * "Levez les yeux", the phone's half: a photo waiting for the host is re-read while the guest
 * is looking, so the moment it is published can be told.
 *
 * Every case reads what the guest could observe: how many times the server was asked, what
 * the list says, and whether the phone buzzed. The poll is deliberately not a push
 * notification and not a stream (ROADMAP §2.1; the guests' public stream is capped per IP),
 * so what is pinned here is when it runs and, above all, when it does not.
 */

const SLUG = 'camille-et-sacha'
const POLL_MS = 9_000

const photo = (id: string, status: PhotoStatus): GuestPhotoDto => aGuestPhoto({ id, status })

let visibility: 'visible' | 'hidden' = 'visible'
const vibrate = vi.fn<(pattern: number) => boolean>(() => true)

const setVisibility = (next: 'visible' | 'hidden') => {
  visibility = next
  document.dispatchEvent(new Event('visibilitychange'))
}

/** Answers each read with the next list, repeating the last once they run out. */
const serving = (...lists: readonly (readonly GuestPhotoDto[])[]) => {
  let read = 0
  const myPhotos = vi.fn(async () => {
    const items = lists[Math.min(read, lists.length - 1)] ?? []
    read += 1
    return { items }
  })
  return { api: fakeApi({ myPhotos }), myPhotos }
}

const mount = (api: Api) => {
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <ApiProvider api={api}>{children}</ApiProvider>
  )
  return renderHook(() => useMyPhotos(SLUG), { wrapper })
}

/**
 * Time passing in one-second steps, each settled before the next: a long jump inside a single
 * `act` batches every state change in it, so the screen would see one read where a phone sees
 * thirty.
 */
const elapse = async (ms: number) => {
  for (let left = ms; left > 0; left -= 1_000) {
    await act(() => vi.advanceTimersByTimeAsync(Math.min(1_000, left)))
  }
  if (ms === 0) await act(() => vi.advanceTimersByTimeAsync(0))
}

/** Mounted, with the first read answered. */
const mounted = async (api: Api) => {
  const view = mount(api)
  await elapse(0)
  return view
}

describe('re-reading the list while a photo waits', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    visibility = 'visible'
    vibrate.mockClear()
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    })
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate })
  })

  afterEach(() => {
    vi.useRealTimers()
    Reflect.deleteProperty(document, 'visibilityState')
    Reflect.deleteProperty(navigator, 'vibrate')
  })

  it('reads again every few seconds while a photo is waiting and the tab is in view', async () => {
    const { api, myPhotos } = serving([photo('p1', 'pending')])
    await mounted(api)
    expect(myPhotos).toHaveBeenCalledTimes(1)

    await elapse(POLL_MS)
    await elapse(POLL_MS)

    expect(myPhotos).toHaveBeenCalledTimes(3)
  })

  it('does not start reading when the page opens in a tab nobody is looking at', async () => {
    visibility = 'hidden'
    const { api, myPhotos } = serving([photo('p1', 'pending')])
    await mounted(api)

    await elapse(10 * POLL_MS)

    expect(myPhotos).toHaveBeenCalledTimes(1)
  })

  it('never reads again when nothing is waiting', async () => {
    const { api, myPhotos } = serving([photo('p1', 'published'), photo('p2', 'rejected')])
    await mounted(api)

    await elapse(10 * POLL_MS)

    expect(myPhotos).toHaveBeenCalledTimes(1)
  })

  it('stops as soon as the last waiting photo is answered', async () => {
    const { api, myPhotos } = serving([photo('p1', 'pending')], [photo('p1', 'published')])
    await mounted(api)

    await elapse(POLL_MS)
    expect(myPhotos).toHaveBeenCalledTimes(2)
    await elapse(10 * POLL_MS)

    expect(myPhotos).toHaveBeenCalledTimes(2)
  })

  it('asks nothing while the tab is hidden, and reads once on coming back', async () => {
    const { api, myPhotos } = serving([photo('p1', 'pending')])
    await mounted(api)

    act(() => setVisibility('hidden'))
    await elapse(10 * POLL_MS)
    expect(myPhotos).toHaveBeenCalledTimes(1)

    act(() => setVisibility('visible'))
    await elapse(0)
    expect(myPhotos).toHaveBeenCalledTimes(2)
  })

  it('goes back to its rhythm once the tab is in view again', async () => {
    const { api, myPhotos } = serving([photo('p1', 'pending')])
    await mounted(api)
    act(() => setVisibility('hidden'))
    act(() => setVisibility('visible'))
    await elapse(0)
    expect(myPhotos).toHaveBeenCalledTimes(2)

    await elapse(POLL_MS)

    expect(myPhotos).toHaveBeenCalledTimes(3)
  })

  it('does not stack a read on one that has not come back', async () => {
    // On venue Wi-Fi an answer can take longer than the poll. Starting another read would
    // abort the first, and the list would never arrive.
    let settle: (value: { items: readonly GuestPhotoDto[] }) => void = () => {}
    const slow = new Promise<{ items: readonly GuestPhotoDto[] }>((resolve) => {
      settle = resolve
    })
    const answers = [async () => ({ items: [photo('p1', 'pending')] }), () => slow]
    const myPhotos = vi.fn(() => (answers.shift() ?? (async () => ({ items: [] })))())
    await mounted(fakeApi({ myPhotos }))

    await elapse(POLL_MS)
    expect(myPhotos).toHaveBeenCalledTimes(2)
    await elapse(3 * POLL_MS)
    expect(myPhotos).toHaveBeenCalledTimes(2)

    await act(async () => {
      settle({ items: [photo('p1', 'pending')] })
      await slow
    })
    await elapse(POLL_MS)
    expect(myPhotos).toHaveBeenCalledTimes(3)
  })

  it('slows down once the host has plainly left it for a while', async () => {
    const { api, myPhotos } = serving([photo('p1', 'pending')])
    await mounted(api)

    await elapse(300_000)
    const afterFiveMinutes = myPhotos.mock.calls.length
    await elapse(60_000)

    // Two reads in the next minute rather than six or seven.
    expect(myPhotos.mock.calls.length - afterFiveMinutes).toBeLessThanOrEqual(2)
    expect(myPhotos.mock.calls.length - afterFiveMinutes).toBeGreaterThanOrEqual(1)
  })

  it('does not show the spinner for a read nobody asked for', async () => {
    const { api } = serving([photo('p1', 'pending')])
    const { result } = await mounted(api)

    await elapse(POLL_MS - 1)
    expect(result.current.loading).toBe(false)
    await elapse(1)

    expect(result.current.loading).toBe(false)
  })
})

describe('telling the guest their photo is on its way to the screen', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    visibility = 'visible'
    vibrate.mockClear()
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    })
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate })
  })

  afterEach(() => {
    vi.useRealTimers()
    Reflect.deleteProperty(document, 'visibilityState')
    Reflect.deleteProperty(navigator, 'vibrate')
  })

  it('announces a photo that goes from waiting to published, and buzzes once', async () => {
    const { api } = serving([photo('p1', 'pending')], [photo('p1', 'published')])
    const { result } = await mounted(api)
    expect(result.current.arrival).toBeNull()

    await elapse(POLL_MS)

    expect(result.current.arrival).toEqual({ whileAway: false })
    expect(vibrate).toHaveBeenCalledTimes(1)
    expect(vibrate).toHaveBeenCalledWith(200)
  })

  it('says it went rather than that it is going when the guest finds it on coming back', async () => {
    const { api } = serving([photo('p1', 'pending')], [photo('p1', 'published')])
    const { result } = await mounted(api)

    act(() => setVisibility('hidden'))
    act(() => setVisibility('visible'))
    await elapse(0)

    expect(result.current.arrival).toEqual({ whileAway: true })
    // The moment to look up has gone, and the buzz would be about nothing.
    expect(vibrate).not.toHaveBeenCalled()
  })

  it('is not an arrival when the first read already finds the photo published', async () => {
    const { api } = serving([photo('p1', 'published')])
    const { result } = await mounted(api)

    // The list did load, so the silence is the rule's and not a read that never finished.
    expect(result.current.photos).toHaveLength(1)
    expect(result.current.arrival).toBeNull()
    expect(vibrate).not.toHaveBeenCalled()
  })

  it('is not an arrival when a photo comes in already published, as on an event that publishes by itself', async () => {
    const { api } = serving(
      [photo('p1', 'pending')],
      [photo('p1', 'pending'), photo('p2', 'published')],
    )
    const { result } = await mounted(api)

    await elapse(POLL_MS)

    expect(result.current.arrival).toBeNull()
  })

  it('is not an arrival for a photo that was refused', async () => {
    const { api } = serving([photo('p1', 'pending')], [photo('p1', 'rejected')])
    const { result } = await mounted(api)

    await elapse(POLL_MS)

    expect(result.current.arrival).toBeNull()
    expect(vibrate).not.toHaveBeenCalled()
  })

  it('leaves the announcement on screen for a while, then takes it down', async () => {
    const { api } = serving([photo('p1', 'pending')], [photo('p1', 'published')])
    const { result } = await mounted(api)
    await elapse(POLL_MS)
    expect(result.current.arrival).not.toBeNull()

    await elapse(14_000)
    expect(result.current.arrival).not.toBeNull()
    await elapse(1_000)

    expect(result.current.arrival).toBeNull()
  })

  it('works on a phone that cannot vibrate', async () => {
    Reflect.deleteProperty(navigator, 'vibrate')
    const { api } = serving([photo('p1', 'pending')], [photo('p1', 'published')])
    const { result } = await mounted(api)

    await elapse(POLL_MS)

    expect(result.current.arrival).toEqual({ whileAway: false })
  })
})
