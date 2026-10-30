import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { ApiProvider } from '../../../app/ApiProvider'
import { MemoryOutbox } from '../../../lib/offline/memoryOutbox'
import { fakeApi } from '../../../testing/renderWithProviders'
import { useOutbox } from './useOutbox'
import { useUploadQueue } from './useUploadQueue'
import type { ReactNode } from 'react'
import type { Api, UploadInput } from '../../../lib/api/client'
import type { UploadResponse } from '../../../lib/api/dto'
import type { NewOutboxEntry, OutboxAddition } from '../../../lib/offline/outbox'

/**
 * A guest who leaves the upload screen while photos are on their way (INV-1).
 *
 * The screen is its two hooks wired as the page wires them, because the guarantee lives in how they
 * meet: the queue knows which photos are owed, the outbox owns the store, and the store has to stay
 * open until the photos are written. Unmounting used to abort every send and forget every photo that
 * had not arrived, and nothing told the guest.
 */

const SLUG = 'camille-et-sacha'

const aPhotoFile = (name: string): File =>
  new File([new Uint8Array([0xff, 0xd8, 0xff])], name, { type: 'image/jpeg' })

const accepted = (photoId: string): UploadResponse => ({
  results: [{ index: 0, status: 'accepted', photoId }],
})

/** A store that remembers what it was asked to keep, and how much of it was written when it closed. */
class RecordingOutbox extends MemoryOutbox {
  readonly written: NewOutboxEntry[] = []
  writtenWhenClosed: number | null = null

  override async add(entry: NewOutboxEntry, now: number): Promise<OutboxAddition> {
    // A beat per write, as a real database has: closing too early is only visible with one.
    await new Promise((resolve) => setTimeout(resolve, 5))
    const added = await super.add(entry, now)
    this.written.push(entry)
    return added
  }

  override close(): void {
    this.writtenWhenClosed ??= this.written.length
    super.close()
  }
}

/** A store whose first write does not land until the test opens the gate: the guest leaves in the middle of it. */
class GatedOutbox extends RecordingOutbox {
  started = false
  private open: () => void = () => {}
  private readonly gate = new Promise<void>((resolve) => {
    this.open = resolve
  })

  letWriteLand(): void {
    this.open()
  }

  override async add(entry: NewOutboxEntry, now: number): Promise<OutboxAddition> {
    this.started = true
    await this.gate
    return super.add(entry, now)
  }
}

/** An upload that stays in the air until the test says otherwise, and cannot be reached by an abort. */
const held = (): { api: Api; calls: string[] } => {
  const calls: string[] = []
  const api = fakeApi({
    uploadPhotos: vi.fn((_slug: string, input: UploadInput) => {
      calls.push(input.files[0]?.name ?? 'inconnue')
      return new Promise<UploadResponse>((_resolve, reject) => {
        input.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        )
      })
    }),
  })
  return { api, calls }
}

const mount = (api: Api, store: RecordingOutbox) => {
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <ApiProvider api={api}>{children}</ApiProvider>
  )
  return renderHook(
    () => {
      const outbox = useOutbox({ slug: SLUG, open: () => Promise.resolve(store) })
      // The shrink step is injected: jsdom has no canvas. The renamed file proves which bytes were kept.
      const queue = useUploadQueue({
        slug: SLUG,
        outbox,
        resize: (file) =>
          Promise.resolve(new File([file], `reduite-${file.name}`, { type: file.type })),
      })
      return { outbox, queue }
    },
    { wrapper },
  )
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('leaving the upload screen while photos are on their way', () => {
  it('hands every photo of the batch to the outbox, in the guest’s order, with the caption and the prompt', async () => {
    const store = new RecordingOutbox()
    const { api, calls } = held()
    const { result, unmount } = mount(api, store)
    await waitFor(() => expect(result.current.outbox.ready).toBe(true))

    act(() =>
      result.current.queue.add([
        aPhotoFile('un.jpg'),
        aPhotoFile('deux.jpg'),
        aPhotoFile('trois.jpg'),
      ]),
    )
    act(() => result.current.queue.send('Les confettis', 'mission-1'))
    await waitFor(() => expect(calls).toEqual(['reduite-un.jpg']))

    unmount()

    // The first was in the air and already shrunk; the other two had not been prepared yet and are
    // shrunk by the hand-over. All three keep their order, the caption and the prompt.
    await waitFor(() => expect(store.written).toHaveLength(3))
    expect(store.written.map((entry) => entry.fileName)).toEqual([
      'reduite-un.jpg',
      'reduite-deux.jpg',
      'reduite-trois.jpg',
    ])
    expect(store.written.every((entry) => entry.caption === 'Les confettis')).toBe(true)
    expect(store.written.every((entry) => entry.missionId === 'mission-1')).toBe(true)
    expect(store.written.every((entry) => entry.slug === SLUG)).toBe(true)
  })

  it('keeps the store open until the last photo is written', async () => {
    // The cleanup that closes the store runs in the same commit as the one that starts the writes.
    const store = new RecordingOutbox()
    const { api, calls } = held()
    const { result, unmount } = mount(api, store)
    await waitFor(() => expect(result.current.outbox.ready).toBe(true))
    act(() => result.current.queue.add([aPhotoFile('un.jpg'), aPhotoFile('deux.jpg')]))
    act(() => result.current.queue.send(null, null))
    await waitFor(() => expect(calls).toHaveLength(1))

    unmount()

    await waitFor(() => expect(store.writtenWhenClosed).not.toBeNull())
    expect(store.writtenWhenClosed).toBe(2)
  })

  it('does not hand over a photo the guest picked and never pressed "Envoyer" for', async () => {
    const store = new RecordingOutbox()
    const { api, calls } = held()
    const { result, unmount } = mount(api, store)
    await waitFor(() => expect(result.current.outbox.ready).toBe(true))
    act(() => result.current.queue.add([aPhotoFile('envoyee.jpg')]))
    act(() => result.current.queue.send(null, null))
    await waitFor(() => expect(calls).toHaveLength(1))
    // Picked while the first is in the air: pending, like the one being sent, and not owed to anybody.
    act(() => result.current.queue.add([aPhotoFile('choisie-seulement.jpg')]))

    unmount()

    await waitFor(() => expect(store.writtenWhenClosed).not.toBeNull())
    expect(store.written.map((entry) => entry.fileName)).toEqual(['reduite-envoyee.jpg'])
  })

  it('writes nothing for a screen that was left with nothing sent', async () => {
    const store = new RecordingOutbox()
    const { api } = held()
    const { result, unmount } = mount(api, store)
    await waitFor(() => expect(result.current.outbox.ready).toBe(true))
    act(() => result.current.queue.add([aPhotoFile('choisie.jpg')]))

    unmount()

    await waitFor(() => expect(store.writtenWhenClosed).not.toBeNull())
    expect(store.written).toEqual([])
  })

  it('does not hand over what already arrived, or what the outbox already holds', async () => {
    const store = new RecordingOutbox()
    let call = 0
    const api = fakeApi({
      uploadPhotos: vi.fn((_slug: string, input: UploadInput) => {
        call += 1
        if (call === 1) return Promise.resolve(accepted('photo-1'))
        return new Promise<UploadResponse>((_resolve, reject) => {
          input.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          )
        })
      }),
    })
    const { result, unmount } = mount(api, store)
    await waitFor(() => expect(result.current.outbox.ready).toBe(true))
    act(() => result.current.queue.add([aPhotoFile('arrivee.jpg'), aPhotoFile('en-vol.jpg')]))
    act(() => result.current.queue.send(null, null))
    await waitFor(() => expect(call).toBe(2))
    await waitFor(() => expect(result.current.queue.items[0]?.state).toBe('done'))

    unmount()

    await waitFor(() => expect(store.writtenWhenClosed).not.toBeNull())
    expect(store.written.map((entry) => entry.fileName)).toEqual(['reduite-en-vol.jpg'])
  })

  it('still lets an ordinary re-render of the screen go by without writing anything', async () => {
    // The hand-over belongs to the unmount alone: a dependency that changed must not be taken for a departure.
    const store = new RecordingOutbox()
    const { api, calls } = held()
    const { result, rerender, unmount } = mount(api, store)
    await waitFor(() => expect(result.current.outbox.ready).toBe(true))
    act(() => result.current.queue.add([aPhotoFile('un.jpg')]))
    act(() => result.current.queue.send(null, null))
    await waitFor(() => expect(calls).toHaveLength(1))

    rerender()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(store.written).toEqual([])

    unmount()
    await waitFor(() => expect(store.written).toHaveLength(1))
  })
})

describe('leaving the upload screen while a photo is being written to the outbox', () => {
  /** Offline, a photo goes straight to the outbox: its row stays `preparing` until that write lands. */
  const offline = () => vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)

  it('offline, leaving while the write is in flight writes the photo once', async () => {
    offline()
    const store = new GatedOutbox()
    const { api, calls } = held()
    const { result, unmount } = mount(api, store)
    await waitFor(() => expect(result.current.outbox.ready).toBe(true))
    act(() => result.current.queue.add([aPhotoFile('un.jpg')]))
    act(() => result.current.queue.send(null, null))
    await waitFor(() => expect(store.started).toBe(true))

    unmount()
    store.letWriteLand()

    await waitFor(() => expect(store.writtenWhenClosed).not.toBeNull())
    // Neither the enqueue in flight nor the hand-over is the second copy: one of them is enough.
    expect(store.written.map((entry) => entry.fileName)).toEqual(['reduite-un.jpg'])
    expect(calls).toEqual([])
  })

  it('offline, leaving while the write is in flight keeps the store open until it lands', async () => {
    // With the hand-over no longer repeating this photo, nothing else would hold the store open for it.
    offline()
    const store = new GatedOutbox()
    const { api } = held()
    const { result, unmount } = mount(api, store)
    await waitFor(() => expect(result.current.outbox.ready).toBe(true))
    act(() => result.current.queue.add([aPhotoFile('un.jpg')]))
    act(() => result.current.queue.send(null, null))
    await waitFor(() => expect(store.started).toBe(true))

    unmount()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(store.writtenWhenClosed).toBeNull()
    store.letWriteLand()

    await waitFor(() => expect(store.writtenWhenClosed).not.toBeNull())
    expect(store.writtenWhenClosed).toBe(1)
  })

  it('hands over the photos queued behind the one being written, and only those', async () => {
    offline()
    const store = new GatedOutbox()
    const { api } = held()
    const { result, unmount } = mount(api, store)
    await waitFor(() => expect(result.current.outbox.ready).toBe(true))
    act(() => result.current.queue.add([aPhotoFile('un.jpg'), aPhotoFile('deux.jpg')]))
    act(() => result.current.queue.send(null, null))
    await waitFor(() => expect(store.started).toBe(true))

    unmount()
    store.letWriteLand()

    await waitFor(() => expect(store.writtenWhenClosed).not.toBeNull())
    expect(store.written.map((entry) => entry.fileName)).toEqual([
      'reduite-un.jpg',
      'reduite-deux.jpg',
    ])
  })
})

describe('coming straight back to the upload screen during the hand-over', () => {
  /** What IndexedDB is: closing a connection forgets nothing, so the screen that comes back sees the writes. */
  class DurableOutbox extends RecordingOutbox {
    override close(): void {
      this.writtenWhenClosed ??= this.written.length
    }
  }

  it('lets the new screen see the photos as soon as the last one is written', async () => {
    const store = new DurableOutbox()
    const { api, calls } = held()
    const leaving = mount(api, store)
    await waitFor(() => expect(leaving.result.current.outbox.ready).toBe(true))
    act(() => leaving.result.current.queue.add([aPhotoFile('un.jpg'), aPhotoFile('deux.jpg')]))
    act(() => leaving.result.current.queue.send(null, null))
    await waitFor(() => expect(calls).toHaveLength(1))

    // Back at once: the new screen opens the store and looks, before the writes below have landed.
    const arriving = renderHook(
      () => useOutbox({ slug: SLUG, open: () => Promise.resolve(store) }),
      {
        wrapper: ({ children }: { readonly children: ReactNode }) => (
          <ApiProvider api={api}>{children}</ApiProvider>
        ),
      },
    )
    await waitFor(() => expect(arriving.result.current.ready).toBe(true))
    expect(arriving.result.current.waiting).toBe(0)
    leaving.unmount()

    await waitFor(() => expect(store.written).toHaveLength(2))
    await waitFor(() => expect(arriving.result.current.waiting).toBe(2))
  })
})
