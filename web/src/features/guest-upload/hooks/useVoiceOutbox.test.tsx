import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { ApiProvider } from '../../../lib/ApiProvider'
import { ApiError } from '../../../lib/http'
import { MemoryOutbox } from '../../../lib/offline/memoryOutbox'
import { fakeApi } from '../../../testing/renderWithProviders'
import { useVoiceOutbox, type UseVoiceOutboxOptions } from './useVoiceOutbox'
import type { ReactNode } from 'react'
import type { Api } from '../../../lib/api/client'
import type { OutboxStore } from '../../../lib/offline/outbox'
import type { VoiceRecording } from './useVoiceRecorder'

/**
 * The voice recordings the phone is holding, and the moments it is worth trying again (spec 25).
 *
 * Driven by the behaving in-memory store, as `useOutbox.test.tsx` is: what matters is that the hook and
 * the store agree about claims, counts and blocked entries. The three-state reading of the server's
 * answers is `voicePolicy.test.ts`; here it is what the hook does about each.
 */

const SLUG = 'camille-et-sacha'

const aRecording = (): VoiceRecording => ({
  blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/webm;codecs=opus' }),
  mimeType: 'audio/webm;codecs=opus',
  durationMs: 4_000,
  interrupted: false,
})

const wrapperFor = (api: Api) =>
  function Wrapper({ children }: { readonly children: ReactNode }) {
    return <ApiProvider api={api}>{children}</ApiProvider>
  }

const seed = (store: OutboxStore, fileName = 'hier.webm') =>
  store.add(
    {
      slug: SLUG,
      bytes: new ArrayBuffer(3),
      fileName,
      fileType: 'audio/webm',
      caption: null,
      missionId: null,
    },
    Date.now(),
  )

const mount = (
  api: Api,
  options: Partial<UseVoiceOutboxOptions> = {},
  store: OutboxStore = new MemoryOutbox({ maxEntriesPerEvent: 3 }),
) => {
  const onSent = options.onSent ?? vi.fn()
  const rendered = renderHook(
    (props: Partial<UseVoiceOutboxOptions>) =>
      useVoiceOutbox({
        slug: SLUG,
        enabled: true,
        offered: true,
        heldOnServer: 0,
        onSent,
        open: () => Promise.resolve(store),
        ...props,
      }),
    { wrapper: wrapperFor(api), initialProps: options },
  )
  return { ...rendered, store, onSent }
}

const setOnline = (online: boolean): void => {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true })
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  Reflect.deleteProperty(navigator, 'onLine')
})

const ready = async (result: { current: { send: unknown } }) => {
  await waitFor(() => expect(result.current).toBeDefined())
  // The store opens asynchronously: one turn of the loop is enough for a memory store.
  await act(async () => {
    await Promise.resolve()
  })
}

describe('useVoiceOutbox, sending', () => {
  it('writes the recording to the store before it tries to send it', async () => {
    // The order is the feature: a network that fails a moment later must not take the recording.
    const store = new MemoryOutbox({ maxEntriesPerEvent: 3 })
    const added = vi.spyOn(store, 'add')
    const api = fakeApi({
      leaveVoiceMessage: vi.fn(async () => {
        // At the moment of the request, the recording is already on the phone.
        expect(await store.list(SLUG)).toHaveLength(1)
        return {
          entry: {
            id: 'v',
            text: null,
            status: 'pending' as const,
            createdAt: '',
            duplicate: false,
            voice: { state: 'queued' as const, durationMs: null, caption: null },
          },
        }
      }),
    })
    const { result } = mount(api, {}, store)
    await ready(result)

    let outcome: unknown
    await act(async () => {
      outcome = await result.current.send(aRecording(), 'Pour vous')
    })

    expect(added).toHaveBeenCalledTimes(1)
    expect(outcome).toEqual({ kind: 'sent' })
    expect(api.leaveVoiceMessage).toHaveBeenCalledTimes(1)
    // Sent, so forgotten, and the list of the guest's messages is read again.
    expect(await store.list(SLUG)).toHaveLength(0)
  })

  it('stores the caption and a name taken from the format, and sends the base type', async () => {
    const api = fakeApi()
    const { result, store } = mount(api)
    await ready(result)
    setOnline(false)

    await act(async () => {
      await result.current.send(aRecording(), 'Un mot')
    })

    const [held] = await store.list(SLUG)
    expect(held?.caption).toBe('Un mot')
    expect(held?.fileName).toBe('message-vocal.webm')
    expect(held?.fileType).toBe('audio/webm')
  })

  it('keeps it and says it is waiting when there is no network, without spending an attempt', async () => {
    setOnline(false)
    const api = fakeApi()
    const { result, store } = mount(api)
    await ready(result)

    let outcome: unknown
    await act(async () => {
      outcome = await result.current.send(aRecording(), null)
    })

    expect(outcome).toEqual({ kind: 'waiting' })
    expect(api.leaveVoiceMessage).not.toHaveBeenCalled()
    expect((await store.list(SLUG))[0]?.attempts).toBe(0)
    expect(result.current.waiting).toBe(1)
  })

  it('keeps it, waiting, when the server could not answer', async () => {
    const api = fakeApi({
      leaveVoiceMessage: vi.fn(async () => {
        throw new ApiError(502, 'unknown')
      }),
    })
    const { result, store } = mount(api)
    await ready(result)

    let outcome: unknown
    await act(async () => {
      outcome = await result.current.send(aRecording(), null)
    })

    expect(outcome).toEqual({ kind: 'waiting' })
    expect(await store.list(SLUG)).toHaveLength(1)
  })

  it('reports a refusal of the moment as blocked, and keeps the recording', async () => {
    const api = fakeApi({
      leaveVoiceMessage: vi.fn(async () => {
        throw new ApiError(409, 'guestbook.voiceDisabled')
      }),
    })
    const { result, store } = mount(api)
    await ready(result)

    let outcome: unknown
    await act(async () => {
      outcome = await result.current.send(aRecording(), null)
    })

    expect(outcome).toEqual({ kind: 'blocked', code: 'guestbook.voiceDisabled' })
    expect((await store.list(SLUG))[0]?.blockedCode).toBe('guestbook.voiceDisabled')
    // Blocked is not waiting: nothing is retrying it.
    expect(result.current.waiting).toBe(0)
    expect(result.current.entries).toHaveLength(1)
  })

  it('reports a refusal of the recording itself as rejected, and forgets it', async () => {
    const api = fakeApi({
      leaveVoiceMessage: vi.fn(async () => {
        throw new ApiError(400, 'voice.tooLong')
      }),
    })
    const { result, store } = mount(api)
    await ready(result)

    let outcome: unknown
    await act(async () => {
      outcome = await result.current.send(aRecording(), null)
    })

    expect(outcome).toEqual({ kind: 'rejected', code: 'voice.tooLong' })
    expect(await store.list(SLUG)).toHaveLength(0)
  })

  it('refuses to keep a recording the server would refuse for the ceiling, counting what it already holds', async () => {
    const api = fakeApi()
    const { result, store } = mount(api, { heldOnServer: 2 })
    await ready(result)
    setOnline(false)
    await act(async () => {
      expect(await result.current.send(aRecording(), null)).toEqual({ kind: 'waiting' })
    })
    expect(result.current.atLimit).toBe(true)

    let outcome: unknown
    await act(async () => {
      outcome = await result.current.send(aRecording(), null)
    })

    // Two on the server and one on the phone is three: the fourth is not put in the queue.
    expect(outcome).toEqual({ kind: 'blocked', code: 'guestbook.limitReached' })
    expect(await store.list(SLUG)).toHaveLength(1)
  })

  it('does not count a recording the server failed to process: the caller leaves it out of heldOnServer', async () => {
    const { result } = mount(fakeApi(), { heldOnServer: 2 })
    await ready(result)

    expect(result.current.atLimit).toBe(false)
  })

  it('says the phone could not keep it when the store refuses the write', async () => {
    const store = new MemoryOutbox({ maxEntriesPerEvent: 3 })
    vi.spyOn(store, 'add').mockRejectedValue(new Error('QuotaExceededError'))
    const { result } = mount(fakeApi(), {}, store)
    await ready(result)

    let outcome: unknown
    await act(async () => {
      outcome = await result.current.send(aRecording(), null)
    })

    // Nothing is promised that was not kept.
    expect(outcome).toEqual({ kind: 'failed' })
  })
})

describe('useVoiceOutbox, the moments it tries again', () => {
  it('sends what an earlier visit left in the store when the page opens', async () => {
    const store = new MemoryOutbox({ maxEntriesPerEvent: 3 })
    await seed(store)
    const api = fakeApi()
    const { onSent } = mount(api, {}, store)

    await waitFor(() => expect(api.leaveVoiceMessage).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(onSent).toHaveBeenCalled())
    expect(await store.list(SLUG)).toHaveLength(0)
  })

  it('tries a blocked recording again when the page opens: the host may have switched it back on', async () => {
    const store = new MemoryOutbox({ maxEntriesPerEvent: 3 })
    const { entry } = await seed(store)
    await store.block(entry.id, 'guestbook.voiceDisabled')
    const api = fakeApi()

    mount(api, {}, store)

    await waitFor(() => expect(api.leaveVoiceMessage).toHaveBeenCalledTimes(1))
  })

  it('does not ask a server that has nothing to be asked, when the event has no guestbook', async () => {
    const store = new MemoryOutbox({ maxEntriesPerEvent: 3 })
    await seed(store)
    const api = fakeApi()

    mount(api, { enabled: false }, store)
    await act(async () => {
      await Promise.resolve()
    })

    expect(api.leaveVoiceMessage).not.toHaveBeenCalled()
  })

  it('sends a blocked recording again when voices are switched back on', async () => {
    const store = new MemoryOutbox({ maxEntriesPerEvent: 3 })
    const api = fakeApi({
      leaveVoiceMessage: vi
        .fn()
        .mockRejectedValueOnce(new ApiError(409, 'guestbook.voiceDisabled'))
        .mockResolvedValue({
          entry: {
            id: 'v',
            text: null,
            status: 'pending',
            createdAt: '',
            duplicate: false,
            voice: { state: 'queued', durationMs: null, caption: null },
          },
        }),
    })
    const { result, rerender } = mount(api, { offered: false }, store)
    await ready(result)
    await act(async () => {
      await result.current.send(aRecording(), null)
    })
    expect((await store.list(SLUG))[0]?.blockedCode).toBe('guestbook.voiceDisabled')

    rerender({ offered: true })

    await waitFor(() => expect(api.leaveVoiceMessage).toHaveBeenCalledTimes(2))
    await waitFor(async () => expect(await store.list(SLUG)).toHaveLength(0))
  })

  it('leaves a blocked recording alone while voices stay switched off', async () => {
    const store = new MemoryOutbox({ maxEntriesPerEvent: 3 })
    const api = fakeApi({
      leaveVoiceMessage: vi.fn(async () => {
        throw new ApiError(409, 'guestbook.voiceDisabled')
      }),
    })
    const { result, rerender } = mount(api, { offered: false }, store)
    await ready(result)
    await act(async () => {
      await result.current.send(aRecording(), null)
    })

    rerender({ offered: false })
    act(() => window.dispatchEvent(new Event('online')))
    await act(async () => {
      await Promise.resolve()
    })

    expect(api.leaveVoiceMessage).toHaveBeenCalledTimes(1)
  })

  it('tries again when the network comes back', async () => {
    setOnline(false)
    const store = new MemoryOutbox({ maxEntriesPerEvent: 3 })
    await seed(store)
    const api = fakeApi()
    mount(api, {}, store)
    await act(async () => {
      await Promise.resolve()
    })
    expect(api.leaveVoiceMessage).not.toHaveBeenCalled()

    setOnline(true)
    act(() => window.dispatchEvent(new Event('online')))

    await waitFor(() => expect(api.leaveVoiceMessage).toHaveBeenCalledTimes(1))
  })

  it('forgets a recording the guest deleted', async () => {
    const store = new MemoryOutbox({ maxEntriesPerEvent: 3 })
    const { entry } = await seed(store)
    setOnline(false)
    const { result } = mount(fakeApi(), {}, store)
    await waitFor(() => expect(result.current.entries).toHaveLength(1))

    await act(async () => {
      await result.current.discard(entry.id)
    })

    expect(result.current.entries).toHaveLength(0)
    expect(await store.list(SLUG)).toHaveLength(0)
  })

  it('closes the store when the screen is left', async () => {
    const store = new MemoryOutbox({ maxEntriesPerEvent: 3 })
    const close = vi.spyOn(store, 'close')
    const { result, unmount } = mount(fakeApi(), {}, store)
    await ready(result)

    unmount()

    expect(close).toHaveBeenCalled()
  })

  it('reads a recording through a FileReader where the browser has no Blob.arrayBuffer', async () => {
    const { result, store } = mount(fakeApi())
    await ready(result)
    setOnline(false)
    const recording = aRecording()
    Object.defineProperty(recording.blob, 'arrayBuffer', { value: undefined })

    await act(async () => {
      await result.current.send(recording, null)
    })

    const [held] = await store.list(SLUG)
    expect(new Uint8Array(held?.bytes ?? new ArrayBuffer(0))).toEqual(new Uint8Array([1, 2, 3, 4]))
  })

  it('tries a deferred recording again once its backoff has passed, by one timer', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const api = fakeApi({
      leaveVoiceMessage: vi
        .fn()
        .mockRejectedValueOnce(new ApiError(503, 'unknown'))
        .mockResolvedValue({
          entry: {
            id: 'v',
            text: null,
            status: 'pending',
            createdAt: '',
            duplicate: false,
            voice: { state: 'queued', durationMs: null, caption: null },
          },
        }),
    })
    const { result, store } = mount(api)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      await result.current.send(aRecording(), null)
    })
    expect(api.leaveVoiceMessage).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })

    expect(api.leaveVoiceMessage).toHaveBeenCalledTimes(2)
    expect(await store.list(SLUG)).toHaveLength(0)
    vi.useRealTimers()
  })

  it('does not send a recording twice when a drain is asked for while one is running', async () => {
    const store = new MemoryOutbox({ maxEntriesPerEvent: 3 })
    await seed(store)
    let release: () => void = () => {}
    const api = fakeApi({
      leaveVoiceMessage: vi.fn(
        () =>
          new Promise((resolve) => {
            release = () =>
              resolve({
                entry: {
                  id: 'v',
                  text: null,
                  status: 'pending' as const,
                  createdAt: '',
                  duplicate: false,
                  voice: { state: 'queued' as const, durationMs: null, caption: null },
                },
              })
          }),
      ),
    })
    const { result } = mount(api, {}, store)
    await waitFor(() => expect(api.leaveVoiceMessage).toHaveBeenCalledTimes(1))

    act(() => result.current.drain())
    await act(async () => {
      release()
      await Promise.resolve()
    })

    await waitFor(async () => expect(await store.list(SLUG)).toHaveLength(0))
    expect(api.leaveVoiceMessage).toHaveBeenCalledTimes(1)
  })

  it('arms a retry in a minute when the store itself fails, instead of freezing the queue', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const store = new MemoryOutbox({ maxEntriesPerEvent: 3 })
    const list = vi.spyOn(store, 'list')
    const api = fakeApi({
      leaveVoiceMessage: vi.fn(async () => {
        throw new ApiError(503, 'unknown')
      }),
    })
    const { result } = mount(api, {}, store)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await seed(store)
    list.mockRejectedValueOnce(new Error('the database went away'))

    act(() => result.current.drain())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(console.warn).toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })

    expect(api.leaveVoiceMessage).toHaveBeenCalled()
    vi.useRealTimers()
  })
})
