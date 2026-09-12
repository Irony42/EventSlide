import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useInstallPrompt } from './useInstallPrompt'
import type { BeforeInstallPromptEvent } from '../../../lib/pwa/install'

/**
 * When the offer appears, and — more importantly — when it does not.
 *
 * The rule this hook exists to enforce is that a guest forty seconds from sending their
 * first photo is never interrupted. Most of the cases below are about silence.
 */

/** The Chromium event, which is not constructible: it is an `Event` with two extras. */
const aBeforeInstallPrompt = (outcome: 'accepted' | 'dismissed' = 'accepted') => {
  const event = new Event('beforeinstallprompt') as BeforeInstallPromptEvent
  const prompt = vi.fn(async () => {})
  Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome }) })
  return { event, prompt }
}

const fireInstallPrompt = (event: BeforeInstallPromptEvent): void => {
  act(() => {
    window.dispatchEvent(event)
  })
}

const asIos = (): void => {
  Object.defineProperty(navigator, 'standalone', { value: false, configurable: true })
}

beforeEach(() => {
  localStorage.clear()
  Reflect.deleteProperty(navigator, 'standalone')
})

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  Reflect.deleteProperty(navigator, 'standalone')
})

describe('useInstallPrompt', () => {
  it('offers nothing before a photo has arrived', () => {
    // A prompt on arrival is friction at the worst possible moment: the guest has
    // scanned a QR code and is forty seconds from sending something.
    const { result } = renderHook(() => useInstallPrompt({ eligible: false }))
    fireInstallPrompt(aBeforeInstallPrompt().event)

    expect(result.current.offer).toEqual({ kind: 'none' })
  })

  it('offers the browser’s prompt once a photo has arrived', () => {
    const { result } = renderHook(() => useInstallPrompt({ eligible: true }))

    fireInstallPrompt(aBeforeInstallPrompt().event)

    expect(result.current.offer).toEqual({ kind: 'prompt' })
  })

  it('keeps an event that arrived before the guest was eligible', () => {
    // The browser fires this when *it* is ready, which is routinely before the first
    // photo is sent. Listening only at the moment of the offer would miss it entirely.
    const { result, rerender } = renderHook(
      ({ eligible }: { eligible: boolean }) => useInstallPrompt({ eligible }),
      { initialProps: { eligible: false } },
    )
    fireInstallPrompt(aBeforeInstallPrompt().event)

    rerender({ eligible: true })

    expect(result.current.offer).toEqual({ kind: 'prompt' })
  })

  it('offers instructions on iOS, which has no prompt to raise', () => {
    asIos()

    const { result } = renderHook(() => useInstallPrompt({ eligible: true }))

    expect(result.current.offer).toEqual({ kind: 'instructions' })
  })

  it('offers nothing in a browser that does neither', () => {
    // Firefox. Inventing a card it cannot honour would be worse than silence.
    const { result } = renderHook(() => useInstallPrompt({ eligible: true }))

    expect(result.current.offer).toEqual({ kind: 'none' })
  })

  it('offers nothing when the app is already on the home screen', () => {
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true })

    const { result } = renderHook(() => useInstallPrompt({ eligible: true }))

    expect(result.current.offer).toEqual({ kind: 'none' })
  })

  it('raises the browser’s prompt when the guest accepts', async () => {
    const { event, prompt } = aBeforeInstallPrompt()
    const { result } = renderHook(() => useInstallPrompt({ eligible: true }))
    fireInstallPrompt(event)

    await act(async () => {
      await result.current.install()
    })

    expect(prompt).toHaveBeenCalledTimes(1)
    expect(result.current.offer).toEqual({ kind: 'none' })
  })

  it('raises it once however many times the card is pressed', async () => {
    // A `BeforeInstallPromptEvent` may be prompted once; a second call throws. A thumb
    // on a phone double-taps.
    const { event, prompt } = aBeforeInstallPrompt()
    const { result } = renderHook(() => useInstallPrompt({ eligible: true }))
    fireInstallPrompt(event)

    await act(async () => {
      await Promise.all([result.current.install(), result.current.install()])
    })

    expect(prompt).toHaveBeenCalledTimes(1)
  })

  it('remembers a refusal made in the browser’s own dialog', async () => {
    // The guest has answered the question. Asking again on the next visit would be
    // asking them to answer it twice.
    const { event } = aBeforeInstallPrompt('dismissed')
    const first = renderHook(() => useInstallPrompt({ eligible: true }))
    fireInstallPrompt(event)
    await act(async () => {
      await first.result.current.install()
    })

    first.unmount()
    const second = renderHook(() => useInstallPrompt({ eligible: true }))
    fireInstallPrompt(aBeforeInstallPrompt().event)

    expect(second.result.current.offer).toEqual({ kind: 'none' })
  })

  it('says nothing to the guest when the browser refuses the prompt', async () => {
    // Raised outside a user gesture, or withdrawn. They did not ask for this, and the
    // photo is what they came for.
    const event = new Event('beforeinstallprompt') as BeforeInstallPromptEvent
    Object.assign(event, {
      prompt: vi.fn(async () => {
        throw new Error('must be called from a user gesture')
      }),
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    })
    const { result } = renderHook(() => useInstallPrompt({ eligible: true }))
    fireInstallPrompt(event)

    await act(async () => {
      await result.current.install()
    })

    expect(result.current.offer).toEqual({ kind: 'none' })
  })

  it('stops offering once the app is installed by any route', async () => {
    // The browser's own menu, for instance. Without this the card sits there offering
    // something already done.
    const { result } = renderHook(() => useInstallPrompt({ eligible: true }))
    fireInstallPrompt(aBeforeInstallPrompt().event)

    act(() => {
      window.dispatchEvent(new Event('appinstalled'))
    })

    await waitFor(() => expect(result.current.offer).toEqual({ kind: 'none' }))
  })

  it('remembers "not now" across visits', () => {
    const first = renderHook(() => useInstallPrompt({ eligible: true }))
    fireInstallPrompt(aBeforeInstallPrompt().event)
    act(() => first.result.current.dismiss())
    first.unmount()

    const second = renderHook(() => useInstallPrompt({ eligible: true }))
    fireInstallPrompt(aBeforeInstallPrompt().event)

    expect(second.result.current.offer).toEqual({ kind: 'none' })
  })
})
