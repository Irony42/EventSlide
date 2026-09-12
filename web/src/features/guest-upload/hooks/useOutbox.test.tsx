import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { ApiProvider } from '../../../app/ApiProvider'
import { ApiError } from '../../../lib/http'
import { MemoryOutbox } from '../../../lib/offline/memoryOutbox'
import { fakeApi } from '../../../testing/renderWithProviders'
import { useOutbox } from './useOutbox'
import type { ReactNode } from 'react'
import type { Api } from '../../../lib/api/client'
import type { DrainReport } from '../../../lib/offline/drainOutbox'
import type { OutboxStore } from '../../../lib/offline/outbox'

/**
 * The photos the device is holding, and the moments it is worth trying again.
 *
 * Driven by the behaving in-memory store rather than by a stub: what matters here is
 * that the hook and the store agree about claims, counts and event scoping, and a stub
 * would agree with whatever the hook happened to do.
 */

const SLUG = 'camille-et-sacha'

const aPhotoFile = (name = 'confettis.jpg'): File =>
  new File([new Uint8Array([0xff, 0xd8, 0xff])], name, { type: 'image/jpeg' })

const accepted = () => ({
  results: [{ index: 0, status: 'accepted' as const, photoId: 'photo-1' }],
})

/** A photo left behind by an earlier visit, written straight into the store. */
const seed = (store: OutboxStore, fileName = 'hier.jpg') =>
  store.add(
    {
      slug: SLUG,
      bytes: new ArrayBuffer(3),
      fileName,
      fileType: 'image/jpeg',
      caption: null,
      csrfToken: null,
    },
    // Stamped now, not at a fixed instant: the outbox drops a photo whose event is
    // over, and a hard-coded epoch would make every one of these cases expired.
    Date.now(),
  )

interface MountOptions {
  readonly store?: OutboxStore
  readonly onDrained?: (report: DrainReport) => void
}

const wrapperFor = (api: Api) =>
  function Wrapper({ children }: { readonly children: ReactNode }) {
    return <ApiProvider api={api}>{children}</ApiProvider>
  }

const mount = (api: Api, options: MountOptions = {}) => {
  const store = options.store ?? new MemoryOutbox()
  const rendered = renderHook(
    () =>
      useOutbox({
        slug: SLUG,
        open: () => Promise.resolve(store),
        ...(options.onDrained ? { onDrained: options.onDrained } : {}),
      }),
    { wrapper: wrapperFor(api) },
  )
  return { ...rendered, store }
}

beforeEach(() => {
  localStorage.clear()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('useOutbox', () => {
  it('opens a store and reports itself ready', async () => {
    const { result } = mount(fakeApi())

    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.waiting).toBe(0)
  })

  it('keeps a photo, its caption and its name', async () => {
    const { result, store } = mount(fakeApi())
    await waitFor(() => expect(result.current.ready).toBe(true))

    await act(async () => {
      await result.current.enqueue(aPhotoFile(), 'Les confettis')
    })

    expect(result.current.waiting).toBe(1)
    const [held] = await store.list(SLUG)
    expect(held?.fileName).toBe('confettis.jpg')
    expect(held?.caption).toBe('Les confettis')
  })

  it('keeps the bytes, so the photo can actually be sent later', async () => {
    const { result, store } = mount(fakeApi())
    await waitFor(() => expect(result.current.ready).toBe(true))

    await act(async () => {
      await result.current.enqueue(aPhotoFile(), null)
    })

    const [held] = await store.list(SLUG)
    expect(new Uint8Array(held?.bytes ?? new ArrayBuffer(0))).toEqual(
      new Uint8Array([0xff, 0xd8, 0xff]),
    )
  })

  it('sends what a previous visit left behind, as soon as the screen opens', async () => {
    // The whole feature in one case: the guest closed the tab in the car park, and the
    // photos go up when they walk back into range.
    const store = new MemoryOutbox()
    await seed(store)
    const uploadPhotos = vi.fn(async () => accepted())

    const { result } = mount(fakeApi({ uploadPhotos }), { store })

    await waitFor(() => expect(uploadPhotos).toHaveBeenCalled())
    await waitFor(() => expect(result.current.waiting).toBe(0))
  })

  it('tells the screen which photos arrived, by id', async () => {
    const store = new MemoryOutbox()
    const stored = await seed(store)
    const onDrained = vi.fn()

    mount(fakeApi({ uploadPhotos: vi.fn(async () => accepted()) }), { store, onDrained })

    await waitFor(() => expect(onDrained).toHaveBeenCalled())
    expect(onDrained.mock.calls[0]?.[0]?.sent).toEqual([stored.entry.id])
  })

  it('keeps a photo the network refused, and says how many are waiting', async () => {
    const { result } = mount(
      fakeApi({
        uploadPhotos: vi.fn(async () => {
          throw ApiError.network()
        }),
      }),
    )
    await waitFor(() => expect(result.current.ready).toBe(true))

    await act(async () => {
      await result.current.enqueue(aPhotoFile(), null)
    })
    await act(async () => {
      result.current.drain()
    })

    await waitFor(() => expect(result.current.waiting).toBe(1))
  })

  it('tries again when the connection comes back', async () => {
    // `online` and a tab becoming visible are the two events that correlate with a
    // connection existing. A poll would wake a phone in a pocket all evening.
    const uploadPhotos = vi.fn(async () => accepted())
    const { result } = mount(fakeApi({ uploadPhotos }))
    await waitFor(() => expect(result.current.ready).toBe(true))
    await act(async () => {
      await result.current.enqueue(aPhotoFile(), null)
    })
    uploadPhotos.mockClear()

    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })

    await waitFor(() => expect(uploadPhotos).toHaveBeenCalled())
  })

  it('does not try while the browser says it is offline', async () => {
    const uploadPhotos = vi.fn(async () => accepted())
    const { result } = mount(fakeApi({ uploadPhotos }))
    await waitFor(() => expect(result.current.ready).toBe(true))
    await act(async () => {
      await result.current.enqueue(aPhotoFile(), null)
    })
    uploadPhotos.mockClear()
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)

    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })

    expect(uploadPhotos).not.toHaveBeenCalled()
  })

  it('forgets a photo the guest took back', async () => {
    // Without this, removing the row would hide the photo and upload it anyway ten
    // minutes later, with nothing on screen to explain where it came from.
    const { result, store } = mount(
      fakeApi({
        uploadPhotos: vi.fn(async () => {
          throw ApiError.network()
        }),
      }),
    )
    await waitFor(() => expect(result.current.ready).toBe(true))
    let id: string | null = null
    await act(async () => {
      id = await result.current.enqueue(aPhotoFile(), null)
    })

    await act(async () => {
      await result.current.discard(id ?? '')
    })

    expect(await store.list(SLUG)).toHaveLength(0)
    expect(result.current.waiting).toBe(0)
  })

  it('opens nothing at all when the kill switch is off', async () => {
    // Not a flag that merely stops new work: with no store, `enqueue` refuses and the
    // upload screen reports failures exactly as it did before this feature existed.
    localStorage.setItem('eventslide.offline', 'off')
    const open = vi.fn(async () => new MemoryOutbox())

    const { result } = renderHook(() => useOutbox({ slug: SLUG, open }), {
      wrapper: wrapperFor(fakeApi()),
    })

    await waitFor(() => expect(result.current.ready).toBe(false))
    expect(open).not.toHaveBeenCalled()
    expect(await result.current.enqueue(aPhotoFile(), null)).toBeNull()
  })

  it('comes back on its own after a photo the network would not take', async () => {
    // `online` fires once. Without a follow-up drain, a photo whose backoff had not
    // elapsed when that event arrived sat on the device for the rest of the evening,
    // reported as waiting and sent by nothing.
    const store = new MemoryOutbox()
    await seed(store)
    const uploadPhotos = vi
      .fn<Api['uploadPhotos']>()
      .mockRejectedValueOnce(ApiError.network())
      .mockResolvedValue(accepted())

    vi.useFakeTimers()
    try {
      const { result } = mount(fakeApi({ uploadPhotos }), { store })

      // Short of the shortest backoff, so this only lets the first drain finish and arm
      // its timer. Advancing the clock rather than waiting on a count keeps the two
      // steps from racing each other.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100)
      })
      expect(uploadPhotos).toHaveBeenCalledTimes(1)
      expect(result.current.waiting).toBe(1)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000)
      })

      expect(uploadPhotos.mock.calls.length).toBeGreaterThan(1)
      expect(result.current.waiting).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('says which photos the per-event cap had to drop', async () => {
    // Reported through the same channel a drain uses, because the screen's response is
    // the same: those rows must stop claiming to be waiting for the network.
    const store = new MemoryOutbox()
    const onDrained = vi.fn()
    const { result } = mount(fakeApi(), { store, onDrained })
    await waitFor(() => expect(result.current.ready).toBe(true))
    vi.spyOn(store, 'add').mockResolvedValue({
      entry: { ...(await seed(store)).entry, id: 'kept' },
      evicted: ['trop-vieille'],
    })

    await act(async () => {
      await result.current.enqueue(aPhotoFile(), null)
    })

    expect(onDrained).toHaveBeenCalledWith(
      expect.objectContaining({ sent: [], discarded: ['trop-vieille'] }),
    )
  })

  it('arms another attempt when the drain itself failed', async () => {
    // Only the store can throw here, and before this the timer was simply never
    // re-armed: the queue froze for the rest of the visit and the badge kept a stale
    // count, which is a far worse answer than trying again in a minute.
    const store = new MemoryOutbox()
    await seed(store)
    const list = vi.spyOn(store, 'list')
    list.mockRejectedValueOnce(new Error('the database went away'))

    vi.useFakeTimers()
    try {
      const uploadPhotos = vi.fn(async () => accepted())
      const { result } = mount(fakeApi({ uploadPhotos }), { store })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100)
      })
      expect(uploadPhotos).not.toHaveBeenCalled()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(61_000)
      })

      expect(uploadPhotos).toHaveBeenCalled()
      expect(result.current.waiting).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('refuses a photo the store will not take, rather than promising to send it', async () => {
    const store = new MemoryOutbox()
    vi.spyOn(store, 'add').mockRejectedValue(new Error('quota exceeded'))
    const { result } = mount(fakeApi(), { store })
    await waitFor(() => expect(result.current.ready).toBe(true))

    let outcome: string | null = 'not-set'
    await act(async () => {
      outcome = await result.current.enqueue(aPhotoFile(), null)
    })

    expect(outcome).toBeNull()
  })
})
