import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useVoiceRecorder } from './useVoiceRecorder'
import { installFakeMicrophone, type FakeMicrophone } from '../testing/fakeMicrophone'

/**
 * Recording a voice message, against a fake microphone and a mocked clock (spec 25, ring 5).
 *
 * Every trap of the spec has its line: the phone's own timer rather than `audio.duration`, the stop at
 * sixty seconds, a hidden page that keeps what was said, and the microphone released on every way out.
 */

let microphone: FakeMicrophone

beforeEach(() => {
  vi.useFakeTimers()
  microphone = installFakeMicrophone()
})

afterEach(() => {
  microphone.uninstall()
  vi.useRealTimers()
})

const startRecording = async () => {
  const hook = renderHook(() => useVoiceRecorder())
  await act(async () => {
    await hook.result.current.start()
  })
  return hook
}

const run = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)))

const hide = (): void => {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

afterEach(() => {
  Reflect.deleteProperty(document, 'visibilityState')
})

describe('useVoiceRecorder', () => {
  it('asks for the microphone only when told to, never at mount', () => {
    renderHook(() => useVoiceRecorder())

    expect(microphone.getUserMedia).not.toHaveBeenCalled()
  })

  it('records with the first format of the ladder the browser can produce', async () => {
    microphone.uninstall()
    microphone = installFakeMicrophone({ formats: ['audio/mp4', 'audio/webm'] })

    await startRecording()

    const made = microphone.recorders()[0]
    expect(made?.mimeType).toBe('audio/mp4')
  })

  it('asks the recorder for a slice a second, so what was said survives a tab that dies', async () => {
    await startRecording()

    expect(microphone.recorders()[0]?.startedWith).toBe(1_000)
  })

  it('shows the clock of its own timer, and reports the duration it measured', async () => {
    const { result } = await startRecording()

    await run(12_000)
    expect(result.current.phase).toBe('recording')
    expect(result.current.elapsedMs).toBe(12_000)

    act(() => result.current.stop())
    await run(0)

    expect(result.current.phase).toBe('recorded')
    // The recorder's blob carries no duration: this is the only number there is.
    expect(result.current.recording?.durationMs).toBe(12_000)
  })

  it('does not let audio.duration reach the clock, whatever the element says', async () => {
    // A WebM from MediaRecorder reports Infinity; the hook never creates an element, so nothing
    // an <audio> says can enter the duration.
    const { result } = await startRecording()
    await run(5_000)

    act(() => result.current.stop())
    await run(0)

    expect(Number.isFinite(result.current.recording?.durationMs ?? Number.NaN)).toBe(true)
  })

  it('stops by itself at sixty seconds, and keeps all sixty', async () => {
    const { result } = await startRecording()

    await run(70_000)

    expect(result.current.phase).toBe('recorded')
    expect(result.current.recording?.durationMs).toBe(60_000)
    expect(result.current.recording?.interrupted).toBe(false)
    expect(microphone.released()).toBe(true)
  })

  it('says the last ten seconds are near, from the fiftieth', async () => {
    const { result } = await startRecording()

    await run(49_500)
    expect(result.current.nearEnd).toBe(false)
    await run(1_000)
    expect(result.current.nearEnd).toBe(true)
  })

  it('releases the microphone when the guest stops', async () => {
    const { result } = await startRecording()
    await run(3_000)

    act(() => result.current.stop())
    await run(0)

    expect(microphone.released()).toBe(true)
  })

  it('keeps what was recorded when the page is hidden, and says it was interrupted', async () => {
    const { result } = await startRecording()
    await run(23_000)

    act(hide)
    await run(0)

    expect(result.current.phase).toBe('recorded')
    expect(result.current.recording?.durationMs).toBe(23_000)
    expect(result.current.recording?.interrupted).toBe(true)
    expect(microphone.released()).toBe(true)
  })

  it('does not listen to the visibility of the page while it is not recording', async () => {
    const { result } = await startRecording()
    await run(3_000)
    act(() => result.current.stop())
    await run(0)

    act(hide)

    // Hiding after the stop must not mark a finished recording as interrupted.
    expect(result.current.recording?.interrupted).toBe(false)
  })

  it('throws the recording away on "Recommencer" and keeps nothing', async () => {
    const { result } = await startRecording()
    await run(4_000)
    act(() => result.current.stop())
    await run(0)

    act(() => result.current.reset())

    expect(result.current.phase).toBe('idle')
    expect(result.current.recording).toBeNull()
    expect(result.current.elapsedMs).toBe(0)
  })

  it('does not call a press by mistake a message', async () => {
    const { result } = await startRecording()
    await run(300)

    act(() => result.current.stop())
    await run(0)

    expect(result.current.failure).toBe('tooShort')
    expect(result.current.recording).toBeNull()
  })

  it('tells a guest who said no apart from a page the browser forbade', async () => {
    microphone.refuseWith('NotAllowedError')
    const refused = renderHook(() => useVoiceRecorder())
    await act(async () => {
      await refused.result.current.start()
    })
    expect(refused.result.current.failure).toBe('denied')

    // The page's own policy says no: the guest can do nothing in their settings.
    Object.defineProperty(document, 'permissionsPolicy', {
      value: { allowsFeature: () => false },
      configurable: true,
    })
    microphone.refuseWith('NotAllowedError')
    const forbidden = renderHook(() => useVoiceRecorder())
    await act(async () => {
      await forbidden.result.current.start()
    })
    Reflect.deleteProperty(document, 'permissionsPolicy')

    expect(forbidden.result.current.failure).toBe('blockedByPolicy')
  })

  it('reports an unavailable microphone for any other failure', async () => {
    microphone.refuseWith('NotFoundError')
    const { result } = renderHook(() => useVoiceRecorder())

    await act(async () => {
      await result.current.start()
    })

    expect(result.current.failure).toBe('unavailable')
    expect(result.current.phase).toBe('idle')
  })

  it('releases the microphone when the screen is left mid-recording', async () => {
    const { unmount } = await startRecording()
    await run(2_000)

    unmount()

    expect(microphone.released()).toBe(true)
  })

  it('does not leave a microphone open when the guest leaves while the prompt is up', async () => {
    const hook = renderHook(() => useVoiceRecorder())
    let resolvePrompt: (stream: unknown) => void = () => {}
    microphone.getUserMedia.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePrompt = resolve as (stream: unknown) => void
        }),
    )
    const pending = hook.result.current.start()
    hook.unmount()

    const track = { stop: vi.fn() }
    const late = { getTracks: () => [track] }
    resolvePrompt(late)
    await pending

    expect(track.stop).toHaveBeenCalled()
    // The recorder was never built for a screen that is gone.
    expect(microphone.recorders()).toHaveLength(0)
  })

  it('reports an unavailable recording when the recorder delivers nothing', async () => {
    const { result } = await startRecording()
    await run(3_000)
    const made = microphone.recorders()[0]
    if (made !== undefined) made.payload = new Uint8Array([])

    act(() => result.current.stop())
    await run(0)

    expect(result.current.failure).toBe('unavailable')
  })

  it('reports an unavailable microphone when the recorder itself errors', async () => {
    const { result } = await startRecording()

    act(() => microphone.recorders()[0]?.onerror?.())

    expect(result.current.failure).toBe('unavailable')
    expect(microphone.released()).toBe(true)
  })

  it('throws a recording in progress away on "Recommencer", and releases the microphone', async () => {
    const { result } = await startRecording()
    await run(3_000)

    act(() => result.current.reset())
    await run(0)

    // The recorder's own stop event must not bring the discarded take back.
    expect(result.current.phase).toBe('idle')
    expect(result.current.recording).toBeNull()
    expect(microphone.released()).toBe(true)
  })

  it('reports an unavailable microphone, and lets go of it, when no format of the ladder is left', async () => {
    microphone.uninstall()
    microphone = installFakeMicrophone({ formats: [] })
    const { result } = renderHook(() => useVoiceRecorder())

    await act(async () => {
      await result.current.start()
    })

    expect(result.current.failure).toBe('unavailable')
    expect(result.current.phase).toBe('idle')
    expect(microphone.released()).toBe(true)
  })

  it('reports an unavailable microphone, and lets go of it, when the recorder cannot be built', async () => {
    const built = microphone
    vi.stubGlobal(
      'MediaRecorder',
      class {
        static isTypeSupported = () => true
        constructor() {
          throw new Error('NotSupportedError')
        }
      },
    )
    const { result } = renderHook(() => useVoiceRecorder())

    await act(async () => {
      await result.current.start()
    })

    expect(result.current.failure).toBe('unavailable')
    expect(built.released()).toBe(true)
  })
})
