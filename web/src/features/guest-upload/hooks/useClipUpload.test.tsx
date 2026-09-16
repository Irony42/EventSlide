import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../../app/ApiProvider'
import { ApiError } from '../../../lib/http'
import { fr } from '../../../lib/i18n/fr'
import { aClipJob, fakeApi } from '../../../testing/renderWithProviders'
import { useClipUpload } from './useClipUpload'
import type { ClipStage } from './useClipUpload'
import type { ReactNode } from 'react'
import type { Api } from '../../../lib/api/client'
import type { ClipJobDto } from '../../../lib/api/dto'

/**
 * One clip, from the picker to the box and back.
 *
 * Driven through the fake transport rather than through a stubbed `fetch`, so every
 * assertion below is about what a guest standing in a room would see. The duration probe
 * is injected because jsdom has no media pipeline at all — a `<video>` there never fires
 * `loadedmetadata`, so the real one would hang every test until its own timeout.
 */

const SLUG = 'camille-et-sacha'
const LIMITS = { maxBytes: 80_000_000, maxSeconds: 15 }

const aClipFile = (name = 'premiere-danse.mp4', size = 12_000_000): File => {
  const file = new File([new Uint8Array([0, 0, 0, 0x18])], name, { type: 'video/mp4' })
  // `File` computes its own size from the parts, and building an eighty-megabyte buffer
  // in jsdom to test a comparison would be absurd.
  Object.defineProperty(file, 'size', { value: size })
  return file
}

interface MountOptions {
  readonly probe?: (file: File) => Promise<number | null>
  readonly onArrived?: () => void
}

/**
 * Mounts the hook and records every stage it passes through.
 *
 * The trail, not just the current value: the states this surface exists to show are
 * transient by nature — `running` lasts as long as the box takes — and an assertion that
 * waits for one of them is a race the fast path wins. What is worth pinning is the
 * sequence, which is what a guest actually reads.
 */
const mount = (api: Api, options: MountOptions = {}) => {
  const stages: ClipStage[] = []
  const rendered = renderHook(
    () => {
      const clip = useClipUpload({
        slug: SLUG,
        limits: LIMITS,
        // Deliberately short: these tests assert that polling happens, not how long it
        // waits, and a real two-second interval would make this file take a minute.
        pollIntervalMs: 1,
        probe: options.probe ?? (() => Promise.resolve(8_000)),
        ...(options.onArrived ? { onArrived: options.onArrived } : {}),
      })
      if (stages[stages.length - 1] !== clip.stage) stages.push(clip.stage)
      return clip
    },
    {
      wrapper: function Wrapper({ children }: { readonly children: ReactNode }) {
        return <ApiProvider api={api}>{children}</ApiProvider>
      },
    },
  )
  return { ...rendered, stages }
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('choosing a recording', () => {
  it('refuses one larger than the event allows, before a byte leaves the phone', async () => {
    const api = fakeApi()
    const { result } = mount(api)

    act(() => result.current.choose(aClipFile('longue.mp4', 90_000_000)))

    await waitFor(() => expect(result.current.stage).toBe('failed'))
    expect(result.current.message).toBe(fr.upload.clipTooLarge(80))
    // The whole point: a `413` after four minutes of venue Wi-Fi has already cost the
    // guest the four minutes.
    expect(api.uploadClip).not.toHaveBeenCalled()
  })

  it('refuses one longer than the cap, once the browser has read its header', async () => {
    const api = fakeApi()
    const { result } = mount(api, { probe: () => Promise.resolve(21_000) })

    act(() => result.current.choose(aClipFile()))

    await waitFor(() => expect(result.current.stage).toBe('failed'))
    expect(result.current.message).toBe(fr.upload.clipTooLong(15))
    expect(api.uploadClip).not.toHaveBeenCalled()
  })

  it('accepts one whose duration this browser could not read', async () => {
    // Our ignorance is not the file's fault: the server has ffprobe and will say
    // `clip.durationUnknown` if it genuinely cannot tell. Refusing here would lose a
    // guest's clip for a reason that is ours.
    const { result } = mount(fakeApi(), { probe: () => Promise.resolve(null) })

    act(() => result.current.choose(aClipFile()))

    await waitFor(() => expect(result.current.stage).toBe('ready'))
  })

  it('does not make the guest wait on the header read before they can send', () => {
    // A probe that never answers must not be a "Envoyer" button that never enables.
    const { result } = mount(fakeApi(), { probe: () => new Promise(() => {}) })

    act(() => result.current.choose(aClipFile()))

    expect(result.current.stage).toBe('ready')
  })

  it('keeps the recording on screen with the refusal that names it', async () => {
    const { result } = mount(fakeApi())

    act(() => result.current.choose(aClipFile('longue.mp4', 90_000_000)))

    await waitFor(() => expect(result.current.stage).toBe('failed'))
    // A guest told "trop longue" with nothing selected cannot tell which of the two
    // recordings they just picked was the problem.
    expect(result.current.file?.name).toBe('longue.mp4')
  })
})

describe('sending it', () => {
  it('walks the job through the states the server actually reports', async () => {
    const answers: ClipJobDto[] = [aClipJob({ status: 'running' }), aClipJob({ status: 'done' })]
    const api = fakeApi({
      uploadClip: vi.fn(async () => aClipJob({ status: 'queued' })),
      clipJob: vi.fn(async () => {
        // A task apart, not a microtask: a real poll is a round trip, and resolving in
        // the same flush as the `202` would let React batch two renders into one — which
        // is a property of this fake, not of the screen a guest reads.
        await new Promise((resolve) => setTimeout(resolve, 0))
        return answers.shift() ?? aClipJob({ status: 'done' })
      }),
    })
    const { result, stages } = mount(api)

    act(() => result.current.choose(aClipFile()))
    await waitFor(() => expect(result.current.stage).toBe('ready'))
    act(() => result.current.send(null))
    await waitFor(() => expect(result.current.stage).toBe('done'))

    // `202` is not "sent": the clip is queued, then transcoded, and only then is there a
    // photo. A screen that stopped at 100% and said nothing for forty seconds is a
    // screen whose guest sends the same eighty megabytes again — so the two waiting
    // states are shown rather than collapsed into a spinner.
    expect(stages).toEqual(['idle', 'ready', 'uploading', 'queued', 'running', 'done'])
    expect(result.current.message).toBe(fr.upload.clipDone)
  })

  it('polls the job it was given rather than guessing at an id', async () => {
    const api = fakeApi({
      uploadClip: vi.fn(async () => aClipJob({ clipJobId: 'job-42', status: 'queued' })),
      clipJob: vi.fn(async () => aClipJob({ status: 'done' })),
    })
    const { result } = mount(api)

    act(() => result.current.choose(aClipFile()))
    await waitFor(() => expect(result.current.stage).toBe('ready'))
    act(() => result.current.send(null))

    // The signal is the upload's own: unmounting or cancelling stops the poll in flight
    // rather than only discarding what it answers.
    await waitFor(() =>
      expect(api.clipJob).toHaveBeenCalledWith(SLUG, 'job-42', expect.any(AbortSignal)),
    )
  })

  it('tells the album to refresh once the box has produced a photo', async () => {
    const onArrived = vi.fn()
    const api = fakeApi({ clipJob: vi.fn(async () => aClipJob({ status: 'done' })) })
    const { result } = mount(api, { onArrived })

    act(() => result.current.choose(aClipFile()))
    await waitFor(() => expect(result.current.stage).toBe('ready'))
    act(() => result.current.send(null))

    // Without it the guest is shown a success message above an empty "Vos envois", which
    // reads as the clip having gone nowhere.
    await waitFor(() => expect(onArrived).toHaveBeenCalled())
  })

  it('carries the caption the guest wrote', async () => {
    const api = fakeApi()
    const { result } = mount(api)

    act(() => result.current.choose(aClipFile()))
    await waitFor(() => expect(result.current.stage).toBe('ready'))
    act(() => result.current.send('La première danse'))

    await waitFor(() =>
      expect(api.uploadClip).toHaveBeenCalledWith(
        SLUG,
        expect.objectContaining({ caption: 'La première danse' }),
      ),
    )
  })

  it('ignores a second press while the bytes are already going up', async () => {
    const api = fakeApi({ uploadClip: vi.fn(() => new Promise<never>(() => {})) })
    const { result } = mount(api)

    act(() => result.current.choose(aClipFile()))
    await waitFor(() => expect(result.current.stage).toBe('ready'))
    act(() => result.current.send(null))
    act(() => result.current.send(null))

    // Pushing the same eighty megabytes twice is the one repetition this surface exists
    // to avoid.
    expect(api.uploadClip).toHaveBeenCalledTimes(1)
  })
})

describe('when it does not work', () => {
  it('words a failed transcode from the server’s own code', async () => {
    const api = fakeApi({
      clipJob: vi.fn(async () => aClipJob({ status: 'failed', failureCode: 'clip.tooLong' })),
    })
    const { result } = mount(api)

    act(() => result.current.choose(aClipFile()))
    await waitFor(() => expect(result.current.stage).toBe('ready'))
    act(() => result.current.send(null))

    await waitFor(() => expect(result.current.stage).toBe('failed'))
    // A clip that silently stays "en cours de traitement" for the rest of the evening is
    // the failure the status endpoint exists to prevent.
    expect(result.current.message).toBe(fr.errors['clip.tooLong'])
    // And no retry offered: the server will always *accept* another job for these bytes,
    // but a verdict on the bytes answers the same way tomorrow, so the button would only
    // exist to be refused.
    expect(result.current.retryable).toBe(false)
  })

  it('offers another attempt when the box was at fault rather than the recording', async () => {
    // A transcode that ran out of time under load, not a box that has no encoder: the
    // first clears on its own and the second does not, and only the first is worth
    // another eighty megabytes.
    const api = fakeApi({
      clipJob: vi.fn(async () =>
        aClipJob({ status: 'failed', failureCode: 'clip.transcodeTimedOut' }),
      ),
    })
    const { result } = mount(api)

    act(() => result.current.choose(aClipFile()))
    await waitFor(() => expect(result.current.stage).toBe('ready'))
    act(() => result.current.send(null))

    await waitFor(() => expect(result.current.stage).toBe('failed'))
    // The machine faults clear on their own, and so do the two verdicts about the album
    // — a host deletes fifty photographs and the same clip now fits. That asymmetry is
    // why anything not named as "about the bytes" is offered again.
    expect(result.current.retryable).toBe(true)
  })

  it('stops watching a job the box never finishes, and says where it will turn up', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const api = fakeApi({ clipJob: vi.fn(async () => aClipJob({ status: 'running' })) })
    const { result } = mount(api)

    act(() => result.current.choose(aClipFile()))
    await waitFor(() => expect(result.current.stage).toBe('ready'))
    act(() => result.current.send(null))
    await waitFor(() => expect(result.current.stage).toBe('running'))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4 * 60 * 1000)
    })

    // Not a poll every two seconds for the rest of the evening behind a "Traitement de
    // la vidéo…" that never moves — a battery cost, and a guest with no way out but a
    // reload.
    expect(result.current.stage).toBe('failed')
    expect(result.current.message).toBe(fr.upload.clipStillWorking)
    // And **no retry**: the stated reason for giving up is a box that is still working,
    // and pushing the whole clip at that same box again is the one remedy guaranteed to
    // make it worse.
    expect(result.current.retryable).toBe(false)
    vi.useRealTimers()
  })

  it('takes one last look at the album before it stops watching', async () => {
    // The sentence tells the guest to reload to find out. That is only true if the list
    // is current at the moment it appears — a transcode that finished in the last two
    // seconds is already there, and telling them to reload for it would be silly.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const onArrived = vi.fn()
    const api = fakeApi({ clipJob: vi.fn(async () => aClipJob({ status: 'running' })) })
    const { result } = mount(api, { onArrived })

    act(() => result.current.choose(aClipFile()))
    await waitFor(() => expect(result.current.stage).toBe('ready'))
    act(() => result.current.send(null))
    await waitFor(() => expect(result.current.stage).toBe('running'))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4 * 60 * 1000)
    })

    expect(onArrived).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('reads a full queue as a wait, with the delay the server asked for', async () => {
    const api = fakeApi({
      uploadClip: vi.fn(() =>
        Promise.reject(new ApiError(429, 'clip.queueFull', { retryAfterSeconds: 30 })),
      ),
    })
    const { result } = mount(api)

    act(() => result.current.choose(aClipFile()))
    await waitFor(() => expect(result.current.stage).toBe('ready'))
    act(() => result.current.send(null))

    // Not `failed`, and not "an error the guest caused". The box is busy, it clears in
    // about a minute, and a guest told "réessayez dans 30 secondes" waits where a guest
    // told "erreur" presses four more times and makes the queue worse.
    await waitFor(() => expect(result.current.stage).toBe('waiting'))
    expect(result.current.message).toBe(fr.upload.clipQueueFullRetry(30))
    expect(result.current.retryable).toBe(false)
  })

  it('refuses to send again before the delay the server asked for has passed', async () => {
    // The reason this matters is not politeness. **The bytes travel before the refusal**:
    // multer writes the upload to disk and only then does the use case decide the queue
    // depth, so an instant retry is eighty megabytes of a guest's evening spent to be
    // told the same thing.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const api = fakeApi({
      uploadClip: vi.fn(() =>
        Promise.reject(new ApiError(429, 'clip.queueFull', { retryAfterSeconds: 30 })),
      ),
    })
    const { result } = mount(api)

    act(() => result.current.choose(aClipFile()))
    await waitFor(() => expect(result.current.stage).toBe('ready'))
    act(() => result.current.send(null))
    await waitFor(() => expect(result.current.stage).toBe('waiting'))

    act(() => result.current.send(null))
    expect(api.uploadClip).toHaveBeenCalledTimes(1)

    // And the button comes back on its own once the wait is over, said out loud rather
    // than a control that silently reappears.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(result.current.stage).toBe('ready')
    expect(result.current.message).toBe(fr.upload.clipQueueFreed)
    vi.useRealTimers()
  })

  it('keeps the delay when the guest takes the recording back and picks another', async () => {
    // The delay is a fact about the **queue**, not about the file in hand. Clearing it
    // with the recording put the whole thing two taps from being bypassed — take the
    // video back, pick it again, press send — and each bypass is another full upload
    // spent to be refused identically.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const api = fakeApi({
      uploadClip: vi.fn(() =>
        Promise.reject(new ApiError(429, 'clip.queueFull', { retryAfterSeconds: 30 })),
      ),
    })
    const { result } = mount(api)

    act(() => result.current.choose(aClipFile()))
    await waitFor(() => expect(result.current.stage).toBe('ready'))
    act(() => result.current.send(null))
    await waitFor(() => expect(result.current.stage).toBe('waiting'))

    act(() => result.current.clear())
    act(() => result.current.choose(aClipFile('autre.mp4')))
    await waitFor(() => expect(result.current.stage).toBe('ready'))
    act(() => result.current.send(null))

    await waitFor(() => expect(result.current.stage).toBe('waiting'))
    expect(api.uploadClip).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('says plainly that a video is not kept for later when the network drops', async () => {
    const api = fakeApi({ uploadClip: vi.fn(() => Promise.reject(ApiError.network())) })
    const { result } = mount(api)

    act(() => result.current.choose(aClipFile()))
    await waitFor(() => expect(result.current.stage).toBe('ready'))
    act(() => result.current.send(null))

    await waitFor(() => expect(result.current.stage).toBe('failed'))
    // The photo path would hand the bytes to the outbox here. A clip is not queued, and
    // the guest is told so rather than left watching a row that says "en attente du
    // réseau" all evening for bytes nothing will ever send.
    expect(result.current.message).toBe(fr.upload.clipNotQueued)
    expect(result.current.retryable).toBe(true)
  })

  it('offers no retry when the box has no video encoder at all', async () => {
    // `500 clip.transcoderUnavailable` is not a client fault, so the generic rule reads
    // it as worth another press — and every press re-uploads the whole clip to fail
    // identically until somebody redeploys. A missing binary is the one "machine fault"
    // that does not clear on its own.
    const api = fakeApi({
      uploadClip: vi.fn(() => Promise.reject(new ApiError(500, 'clip.transcoderUnavailable'))),
    })
    const { result } = mount(api)

    act(() => result.current.choose(aClipFile()))
    await waitFor(() => expect(result.current.stage).toBe('ready'))
    act(() => result.current.send(null))

    await waitFor(() => expect(result.current.stage).toBe('failed'))
    expect(result.current.retryable).toBe(false)
  })

  it('offers no retry for a job the box gave up on for want of an encoder', async () => {
    // The same verdict arriving the other way round, through the status endpoint.
    const api = fakeApi({
      clipJob: vi.fn(async () =>
        aClipJob({ status: 'failed', failureCode: 'clip.transcoderUnavailable' }),
      ),
    })
    const { result } = mount(api)

    act(() => result.current.choose(aClipFile()))
    await waitFor(() => expect(result.current.stage).toBe('ready'))
    act(() => result.current.send(null))

    await waitFor(() => expect(result.current.stage).toBe('failed'))
    expect(result.current.retryable).toBe(false)
  })

  it('offers no retry for a refusal the same bytes would meet again', async () => {
    const api = fakeApi({
      uploadClip: vi.fn(() => Promise.reject(new ApiError(403, 'event.clipsNotAllowed'))),
    })
    const { result } = mount(api)

    act(() => result.current.choose(aClipFile()))
    await waitFor(() => expect(result.current.stage).toBe('ready'))
    act(() => result.current.send(null))

    await waitFor(() => expect(result.current.stage).toBe('failed'))
    expect(result.current.retryable).toBe(false)
  })

  it('keeps polling through a poll that could not be answered', async () => {
    let asked = 0
    const api = fakeApi({
      clipJob: vi.fn(async () => {
        asked += 1
        if (asked === 1) throw ApiError.network()
        return aClipJob({ status: 'done' })
      }),
    })
    const { result } = mount(api)

    act(() => result.current.choose(aClipFile()))
    await waitFor(() => expect(result.current.stage).toBe('ready'))
    act(() => result.current.send(null))

    // A poll the phone could not make is not the clip failing: the box is still working
    // on it and the connection came and went.
    await waitFor(() => expect(result.current.stage).toBe('done'))
  })

  it('stops when the job is gone entirely', async () => {
    const api = fakeApi({
      clipJob: vi.fn(() => Promise.reject(new ApiError(404, 'clipJob.notFound'))),
    })
    const { result } = mount(api)

    act(() => result.current.choose(aClipFile()))
    await waitFor(() => expect(result.current.stage).toBe('ready'))
    act(() => result.current.send(null))

    await waitFor(() => expect(result.current.stage).toBe('failed'))
    expect(result.current.message).toBe(fr.errors['clipJob.notFound'])
  })
})

describe('taking it back', () => {
  it('stops an upload the guest cancelled and leaves the recording in hand', async () => {
    const api = fakeApi({ uploadClip: vi.fn(() => new Promise<never>(() => {})) })
    const { result } = mount(api)

    act(() => result.current.choose(aClipFile()))
    await waitFor(() => expect(result.current.stage).toBe('ready'))
    act(() => result.current.send(null))
    act(() => result.current.cancel())

    expect(result.current.stage).toBe('ready')
    expect(result.current.file?.name).toBe('premiere-danse.mp4')
  })

  it('forgets everything when the guest clears it', async () => {
    const { result } = mount(fakeApi())

    act(() => result.current.choose(aClipFile()))
    await waitFor(() => expect(result.current.stage).toBe('ready'))
    act(() => result.current.clear())

    expect(result.current.file).toBeNull()
    expect(result.current.stage).toBe('idle')
  })

  it('does not let a superseded upload report over the recording that replaced it', async () => {
    let settle: ((job: ClipJobDto) => void) | null = null
    const api = fakeApi({
      uploadClip: vi.fn(
        () =>
          new Promise<ClipJobDto>((resolve) => {
            settle = resolve
          }),
      ),
    })
    const { result } = mount(api)

    act(() => result.current.choose(aClipFile('un.mp4')))
    await waitFor(() => expect(result.current.stage).toBe('ready'))
    act(() => result.current.send(null))
    act(() => result.current.choose(aClipFile('deux.mp4')))

    await act(async () => {
      settle?.(aClipJob({ status: 'done' }))
    })

    // The first run resolving into the second recording's screen would tell the guest
    // that a clip they have not sent yet has arrived.
    expect(result.current.file?.name).toBe('deux.mp4')
    expect(result.current.stage).toBe('ready')
  })
})
