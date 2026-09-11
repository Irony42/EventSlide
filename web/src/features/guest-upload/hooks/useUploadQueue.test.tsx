import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { ApiProvider } from '../../../app/ApiProvider'
import { ApiError } from '../../../lib/http'
import { fr } from '../../../lib/i18n/fr'
import { fakeApi } from '../../../testing/renderWithProviders'
import { useUploadQueue } from './useUploadQueue'
import type { ReactNode } from 'react'
import type { Api, UploadInput } from '../../../lib/api/client'
import type { UploadResponse } from '../../../lib/api/dto'

/**
 * The queue is where a guest's photos are won or lost, so it is tested directly
 * rather than only through the screen: sequencing, retries and the object URLs are
 * hard to observe from rendered markup and easy to get wrong.
 */

const SLUG = 'camille-et-sacha'

const aPhotoFile = (name: string): File =>
  new File([new Uint8Array([0xff, 0xd8, 0xff])], name, { type: 'image/jpeg' })

const accepted = (photoId: string): UploadResponse => ({
  results: [{ index: 0, status: 'accepted', photoId }],
})

const duplicated = (photoId: string): UploadResponse => ({
  results: [{ index: 0, status: 'duplicate', photoId }],
})

const refused = (code: string): UploadResponse => ({
  results: [{ index: 0, status: 'rejected', code }],
})

/** A promise the test releases by hand, to hold an upload open mid-flight. */
const deferred = () => {
  let release = (): void => {}
  const promise = new Promise<void>((resolve) => {
    release = () => resolve()
  })
  return { promise, release: () => release() }
}

interface MountOptions {
  readonly resize?: (file: File) => Promise<File>
  readonly onSettled?: () => void
}

const mount = (api: Api, options: MountOptions = {}) => {
  // The resize step is injected: jsdom has no canvas, and the real one has its own
  // test. That injection point is the only reason this hook is testable at all.
  const resize = options.resize ?? ((file: File) => Promise.resolve(file))
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <ApiProvider api={api}>{children}</ApiProvider>
  )

  return renderHook(
    () =>
      useUploadQueue({
        slug: SLUG,
        resize,
        ...(options.onSettled ? { onSettled: options.onSettled } : {}),
      }),
    { wrapper },
  )
}

describe('useUploadQueue', () => {
  it('sends the photos one after another, never side by side', async () => {
    // Four parallel uploads on a saturated venue Wi-Fi finish later than four in a
    // row, and they make the progress bars meaningless while they do it.
    const log: string[] = []
    const api = fakeApi({
      uploadPhotos: vi.fn(async (_slug: string, input: UploadInput) => {
        const name = input.files[0]?.name ?? 'inconnue'
        log.push(`début ${name}`)
        await Promise.resolve()
        await Promise.resolve()
        log.push(`fin ${name}`)
        return accepted(`photo-${name}`)
      }),
    })
    const { result } = mount(api)

    act(() => result.current.add([aPhotoFile('un.jpg'), aPhotoFile('deux.jpg')]))
    act(() => result.current.send(null))

    await waitFor(() =>
      expect(result.current.items.map((item) => item.state)).toEqual(['done', 'done']),
    )
    expect(log).toEqual(['début un.jpg', 'fin un.jpg', 'début deux.jpg', 'fin deux.jpg'])
    expect(result.current.items[0]?.photoId).toBe('photo-un.jpg')
  })

  it('shrinks a photo before it goes up', async () => {
    const sent: string[] = []
    const api = fakeApi({
      uploadPhotos: vi.fn(async (_slug: string, input: UploadInput) => {
        sent.push(input.files[0]?.name ?? 'inconnue')
        return accepted('photo-1')
      }),
    })
    const { result } = mount(api, { resize: () => Promise.resolve(aPhotoFile('reduite.jpg')) })

    act(() => result.current.add([aPhotoFile('originale.jpg')]))
    act(() => result.current.send(null))

    await waitFor(() => expect(result.current.items[0]?.state).toBe('done'))
    expect(sent).toEqual(['reduite.jpg'])
  })

  it('sends the original when shrinking fails, rather than losing the photo', async () => {
    const sent: string[] = []
    const api = fakeApi({
      uploadPhotos: vi.fn(async (_slug: string, input: UploadInput) => {
        sent.push(input.files[0]?.name ?? 'inconnue')
        return accepted('photo-1')
      }),
    })
    const { result } = mount(api, { resize: () => Promise.reject(new Error('codec')) })

    act(() => result.current.add([aPhotoFile('originale.jpg')]))
    act(() => result.current.send(null))

    await waitFor(() => expect(result.current.items[0]?.state).toBe('done'))
    expect(sent).toEqual(['originale.jpg'])
  })

  it('reports the bytes actually leaving the phone', async () => {
    const gate = deferred()
    const api = fakeApi({
      uploadPhotos: vi.fn(async (_slug: string, input: UploadInput) => {
        input.onProgress?.({ loaded: 30, total: 100, percent: 30 })
        await gate.promise
        return accepted('photo-1')
      }),
    })
    const { result } = mount(api)

    act(() => result.current.add([aPhotoFile('confettis.jpg')]))
    act(() => result.current.send(null))

    await waitFor(() => expect(result.current.items[0]?.progress).toBe(30))
    expect(result.current.items[0]?.state).toBe('uploading')

    await act(async () => {
      gate.release()
    })
    await waitFor(() => expect(result.current.items[0]?.state).toBe('done'))
  })

  it('carries the batch caption to the server', async () => {
    const api = fakeApi({ uploadPhotos: vi.fn(async () => accepted('photo-1')) })
    const { result } = mount(api)

    act(() => result.current.add([aPhotoFile('confettis.jpg')]))
    act(() => result.current.send('Les confettis'))

    await waitFor(() => expect(result.current.items[0]?.state).toBe('done'))
    expect(api.uploadPhotos).toHaveBeenCalledWith(
      SLUG,
      expect.objectContaining({ caption: 'Les confettis' }),
    )
  })

  it('offers a retry after a dropped connection, and keeps the file for it', async () => {
    let attempt = 0
    const api = fakeApi({
      uploadPhotos: vi.fn(async () => {
        attempt += 1
        if (attempt === 1) throw ApiError.network()
        return accepted('photo-1')
      }),
    })
    const { result } = mount(api)

    act(() => result.current.add([aPhotoFile('confettis.jpg')]))
    act(() => result.current.send(null))

    await waitFor(() => expect(result.current.items[0]?.state).toBe('failed'))
    expect(result.current.items[0]?.retryable).toBe(true)
    expect(result.current.items[0]?.error).toBe(fr.errors.network)
    // The file is still there, which is the whole point of retrying rather than
    // asking the guest to find the photo again.
    expect(result.current.items[0]?.file.name).toBe('confettis.jpg')

    act(() => result.current.retry(result.current.items[0]?.id ?? ''))

    await waitFor(() => expect(result.current.items[0]?.state).toBe('done'))
  })

  it('offers no retry for a request the server refused on its merits', async () => {
    // An unsupported format fails identically the second time, and a button that
    // cannot work is worse than no button.
    const api = fakeApi({
      uploadPhotos: vi.fn(async () => {
        throw new ApiError(415, 'image.unsupportedFormat')
      }),
    })
    const { result } = mount(api)

    act(() => result.current.add([aPhotoFile('film.mov')]))
    act(() => result.current.send(null))

    await waitFor(() => expect(result.current.items[0]?.state).toBe('failed'))
    expect(result.current.items[0]?.retryable).toBe(false)
    expect(result.current.items[0]?.error).toBe(fr.errors['image.unsupportedFormat'])
  })

  it('offers no retry for a photo the server judged one file at a time', async () => {
    const api = fakeApi({ uploadPhotos: vi.fn(async () => refused('image.tooManyPixels')) })
    const { result } = mount(api)

    act(() => result.current.add([aPhotoFile('bombe.png')]))
    act(() => result.current.send(null))

    await waitFor(() => expect(result.current.items[0]?.state).toBe('failed'))
    expect(result.current.items[0]?.retryable).toBe(false)
    expect(result.current.items[0]?.error).toBe(fr.errors['image.tooManyPixels'])
  })

  it('treats a photo already in the event as reassurance, not as an error', async () => {
    const api = fakeApi({ uploadPhotos: vi.fn(async () => duplicated('photo-1')) })
    const { result } = mount(api)

    act(() => result.current.add([aPhotoFile('confettis.jpg')]))
    act(() => result.current.send(null))

    await waitFor(() => expect(result.current.items[0]?.state).toBe('duplicate'))
    expect(result.current.items[0]?.error).toBeNull()
    expect(result.current.items[0]?.photoId).toBe('photo-1')
  })

  it('releases the preview of a photo the guest takes back', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    const { result } = mount(fakeApi())

    act(() => result.current.add([aPhotoFile('confettis.jpg')]))
    const preview = result.current.items[0]?.previewUrl ?? ''
    act(() => result.current.remove(result.current.items[0]?.id ?? ''))

    expect(result.current.items).toHaveLength(0)
    expect(revoke).toHaveBeenCalledWith(preview)
  })

  it('takes a row back only once, however many times the guest taps', () => {
    // A thumb on a phone double-taps, and the second tap can carry the id of a row
    // that is already gone. Revoking its preview again would be revoking a URL the
    // next selection may already have been handed.
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    const { result } = mount(fakeApi())
    act(() => result.current.add([aPhotoFile('confettis.jpg')]))
    const id = result.current.items[0]?.id ?? ''
    act(() => result.current.remove(id))

    act(() => result.current.remove(id))

    expect(result.current.items).toHaveLength(0)
    expect(revoke).toHaveBeenCalledTimes(1)
  })

  it('releases every preview when the screen goes away', () => {
    // Thirty photos selected is thirty full-resolution bitmaps pinned in memory.
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    const { result, unmount } = mount(fakeApi())

    act(() => result.current.add([aPhotoFile('un.jpg'), aPhotoFile('deux.jpg')]))
    const previews = result.current.items.map((item) => item.previewUrl)
    unmount()

    expect(revoke).toHaveBeenCalledWith(previews[0])
    expect(revoke).toHaveBeenCalledWith(previews[1])
  })

  it('stops an upload the guest takes back mid-flight', async () => {
    const signals: AbortSignal[] = []
    const gate = deferred()
    const api = fakeApi({
      uploadPhotos: vi.fn(async (_slug: string, input: UploadInput) => {
        if (input.signal) signals.push(input.signal)
        await gate.promise
        return accepted('photo-1')
      }),
    })
    const { result } = mount(api)

    act(() => result.current.add([aPhotoFile('confettis.jpg')]))
    act(() => result.current.send(null))
    await waitFor(() => expect(signals).toHaveLength(1))

    act(() => result.current.remove(result.current.items[0]?.id ?? ''))

    // Left running, the request would spend the guest's remaining bandwidth on a
    // photo they have already taken back.
    expect(signals[0]?.aborted).toBe(true)
    expect(result.current.items).toHaveLength(0)
  })

  it('lets a photo that arrived leave the queue when the next selection arrives', async () => {
    // `upload-item-<n>` is positional, and it is the contract the e2e suite reads: a
    // photo that has arrived must not hold index 0 against the next selection.
    const api = fakeApi({ uploadPhotos: vi.fn(async () => accepted('photo-1')) })
    const { result } = mount(api)

    act(() => result.current.add([aPhotoFile('un.jpg')]))
    act(() => result.current.send(null))
    await waitFor(() => expect(result.current.items[0]?.state).toBe('done'))

    act(() => result.current.add([aPhotoFile('deux.jpg')]))

    expect(result.current.items.map((item) => item.file.name)).toEqual(['deux.jpg'])
    expect(result.current.sendableCount).toBe(1)
  })

  it('tells the screen when a batch has settled, so the guest’s own list refreshes', async () => {
    const onSettled = vi.fn()
    const api = fakeApi({ uploadPhotos: vi.fn(async () => accepted('photo-1')) })
    const { result } = mount(api, { onSettled })

    act(() => result.current.add([aPhotoFile('confettis.jpg')]))
    act(() => result.current.send(null))

    await waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1))
  })

  it('reports each photo of a batch on its own, so one refusal does not take the rest', async () => {
    // Eight photos on venue Wi-Fi: partial success is the normal outcome here, not an
    // error. A batch that failed as a unit would make a guest re-send the seven that
    // arrived to get the eighth through.
    const api = fakeApi({
      uploadPhotos: vi.fn(async (_slug: string, input: UploadInput) =>
        input.files[0]?.name === 'film.mov'
          ? refused('image.unsupportedFormat')
          : accepted(`photo-${input.files[0]?.name ?? ''}`),
      ),
    })
    const { result } = mount(api)

    act(() =>
      result.current.add([aPhotoFile('un.jpg'), aPhotoFile('film.mov'), aPhotoFile('trois.jpg')]),
    )
    act(() => result.current.send(null))

    await waitFor(() => expect(result.current.sending).toBe(false))
    expect(result.current.items.map((item) => item.state)).toEqual(['done', 'failed', 'done'])
  })

  it('retries only the photo that failed', async () => {
    const sent: string[] = []
    let firstAttempt = true
    const api = fakeApi({
      uploadPhotos: vi.fn(async (_slug: string, input: UploadInput) => {
        const name = input.files[0]?.name ?? ''
        sent.push(name)
        if (name === 'deux.jpg' && firstAttempt) {
          firstAttempt = false
          throw ApiError.network()
        }
        return accepted(`photo-${name}`)
      }),
    })
    const { result } = mount(api)
    act(() => result.current.add([aPhotoFile('un.jpg'), aPhotoFile('deux.jpg')]))
    act(() => result.current.send(null))
    await waitFor(() => expect(result.current.items[1]?.state).toBe('failed'))

    act(() => result.current.retry(result.current.items[1]?.id ?? ''))

    await waitFor(() => expect(result.current.items[1]?.state).toBe('done'))
    // The photo that arrived is not sent a second time: the server would answer
    // `duplicate` and the guest would pay for the bytes twice.
    expect(sent).toEqual(['un.jpg', 'deux.jpg', 'deux.jpg'])
  })

  it('tells a guest what to do when the event has run out of room', async () => {
    // A quota is the one refusal a guest can act on, and only by telling somebody —
    // so the sentence names the organiser instead of suggesting a retry.
    const api = fakeApi({ uploadPhotos: vi.fn(async () => refused('event.quotaExceeded')) })
    const { result } = mount(api)

    act(() => result.current.add([aPhotoFile('confettis.jpg')]))
    act(() => result.current.send(null))

    await waitFor(() => expect(result.current.items[0]?.state).toBe('failed'))
    expect(result.current.items[0]?.error).toBe(fr.errors['event.quotaExceeded'])
    expect(result.current.items[0]?.retryable).toBe(false)
  })

  it('keeps the photos still waiting to be sent when the guest picks more', async () => {
    // Only what has arrived is cleared. A pending photo dropped here is a photo the
    // guest selected and never sees again.
    const gate = deferred()
    const api = fakeApi({
      uploadPhotos: vi.fn(async () => {
        await gate.promise
        return accepted('photo-1')
      }),
    })
    const { result } = mount(api)
    act(() => result.current.add([aPhotoFile('un.jpg'), aPhotoFile('deux.jpg')]))
    act(() => result.current.send(null))
    await waitFor(() => expect(result.current.items[0]?.state).toBe('uploading'))

    act(() => result.current.add([aPhotoFile('trois.jpg')]))

    expect(result.current.items.map((item) => item.file.name)).toEqual([
      'un.jpg',
      'deux.jpg',
      'trois.jpg',
    ])
    act(() => gate.release())
    await waitFor(() => expect(result.current.sending).toBe(false))
  })

  it('does not send a photo the guest removed while it was queued behind another', async () => {
    const sent: string[] = []
    const gate = deferred()
    const api = fakeApi({
      uploadPhotos: vi.fn(async (_slug: string, input: UploadInput) => {
        sent.push(input.files[0]?.name ?? '')
        await gate.promise
        return accepted('photo-1')
      }),
    })
    const { result } = mount(api)
    act(() => result.current.add([aPhotoFile('un.jpg'), aPhotoFile('deux.jpg')]))
    act(() => result.current.send(null))
    await waitFor(() => expect(sent).toEqual(['un.jpg']))

    act(() => result.current.remove(result.current.items[1]?.id ?? ''))
    act(() => gate.release())

    await waitFor(() => expect(result.current.sending).toBe(false))
    expect(sent).toEqual(['un.jpg'])
  })

  it('does not send a photo the guest removed while it was being shrunk', async () => {
    const sent: string[] = []
    const shrinking = deferred()
    const api = fakeApi({
      uploadPhotos: vi.fn(async (_slug: string, input: UploadInput) => {
        sent.push(input.files[0]?.name ?? '')
        return accepted('photo-1')
      }),
    })
    const { result } = mount(api, {
      resize: async (file: File) => {
        await shrinking.promise
        return file
      },
    })
    act(() => result.current.add([aPhotoFile('confettis.jpg')]))
    act(() => result.current.send(null))
    await waitFor(() => expect(result.current.items[0]?.state).toBe('preparing'))

    act(() => result.current.remove(result.current.items[0]?.id ?? ''))
    act(() => shrinking.release())

    await waitFor(() => expect(result.current.sending).toBe(false))
    expect(sent).toEqual([])
  })

  it('carries on with the batch when the guest cancels one upload mid-flight', async () => {
    // The abort is the queue's own doing, so it is not a failure — and above all it
    // must not stop the photos queued behind it.
    const api = fakeApi({
      uploadPhotos: vi.fn(
        async (_slug: string, input: UploadInput) =>
          new Promise<UploadResponse>((resolve, reject) => {
            if (input.files[0]?.name !== 'un.jpg') {
              resolve(accepted('photo-2'))
              return
            }
            // The real transport rethrows the browser's `AbortError` untouched.
            input.signal?.addEventListener('abort', () => {
              reject(new DOMException('The user aborted a request.', 'AbortError'))
            })
          }),
      ),
    })
    const { result } = mount(api)
    act(() => result.current.add([aPhotoFile('un.jpg'), aPhotoFile('deux.jpg')]))
    act(() => result.current.send(null))
    await waitFor(() => expect(result.current.items[0]?.state).toBe('uploading'))

    act(() => result.current.remove(result.current.items[0]?.id ?? ''))

    await waitFor(() => expect(result.current.items[0]?.state).toBe('done'))
    expect(result.current.items.map((item) => item.file.name)).toEqual(['deux.jpg'])
  })

  it('offers a retry when the server said nothing at all about the photo', async () => {
    // A 200 with an empty `results` is a server this build does not understand. The
    // photo is not lost: the row says so and the guest can press again.
    const api = fakeApi({
      uploadPhotos: vi.fn(async (): Promise<UploadResponse> => ({ results: [] })),
    })
    const { result } = mount(api)

    act(() => result.current.add([aPhotoFile('confettis.jpg')]))
    act(() => result.current.send(null))

    await waitFor(() => expect(result.current.items[0]?.state).toBe('failed'))
    expect(result.current.items[0]?.error).toBe(fr.errors.unknown)
    expect(result.current.items[0]?.retryable).toBe(true)
  })

  it('says something in French when an upload fails for a reason with no error code', async () => {
    // Anything that is not an `ApiError` is a bug in this build, and its message is an
    // internal English string. A guest must never be shown one.
    const api = fakeApi({
      uploadPhotos: vi.fn(async () => {
        throw new TypeError('Cannot read properties of undefined')
      }),
    })
    const { result } = mount(api)

    act(() => result.current.add([aPhotoFile('confettis.jpg')]))
    act(() => result.current.send(null))

    await waitFor(() => expect(result.current.items[0]?.state).toBe('failed'))
    expect(result.current.items[0]?.error).toBe(fr.errors.unknown)
  })

  it('sends each photo once when a guest taps “Envoyer” twice', async () => {
    // A thumb on a phone double-taps. Two runs over the same queue would upload every
    // photo twice and make the server answer `duplicate` for half of them.
    const gate = deferred()
    const api = fakeApi({
      uploadPhotos: vi.fn(async () => {
        await gate.promise
        return accepted('photo-1')
      }),
    })
    const { result } = mount(api)
    act(() => result.current.add([aPhotoFile('un.jpg'), aPhotoFile('deux.jpg')]))

    act(() => result.current.send(null))
    act(() => result.current.send(null))
    act(() => gate.release())

    await waitFor(() => expect(result.current.sending).toBe(false))
    expect(api.uploadPhotos).toHaveBeenCalledTimes(2)
  })
})
