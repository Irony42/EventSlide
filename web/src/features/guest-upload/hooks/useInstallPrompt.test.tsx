import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { resetInstallState, watchForInstall } from '../../../lib/pwa/install'
import { useInstallPrompt } from './useInstallPrompt'
import type { BeforeInstallPromptEvent } from '../../../lib/pwa/install'

/**
 * When the offer appears, and — mostly — when it does not.
 *
 * The ordering in these tests is the production ordering, and that is the point. The
 * capture is started first, the event fires, and only then does the screen mount: that
 * is what happens to a guest, because `beforeinstallprompt` fires once per document load
 * and the journey from `/join/:code` to `/e/:slug/upload` is a single document. An
 * earlier version of this suite dispatched the event *after* mounting — the one sequence
 * real guests never produce — and it passed while the feature was dead on Chromium.
 */

/** The Chromium event, which is not constructible: an `Event` with two extra members. */
const aBeforeInstallPrompt = (outcome: 'accepted' | 'dismissed' = 'accepted') => {
  const event = new Event('beforeinstallprompt') as BeforeInstallPromptEvent
  const prompt = vi.fn(async () => {})
  Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome }) })
  return { event, prompt }
}

const chromiumOffers = (outcome: 'accepted' | 'dismissed' = 'accepted') => {
  const { event, prompt } = aBeforeInstallPrompt(outcome)
  window.dispatchEvent(event)
  return { prompt }
}

const asIos = (): void => {
  Object.defineProperty(navigator, 'standalone', { value: false, configurable: true })
}

let stopWatching = (): void => {}

beforeEach(() => {
  localStorage.clear()
  Reflect.deleteProperty(navigator, 'standalone')
  resetInstallState()
  stopWatching = watchForInstall()
})

afterEach(() => {
  stopWatching()
  resetInstallState()
  vi.restoreAllMocks()
  localStorage.clear()
  Reflect.deleteProperty(navigator, 'standalone')
})

describe('useInstallPrompt', () => {
  it('offers the prompt captured before this screen ever mounted', () => {
    // The regression that matters. Chromium fires the event while the join screen is up
    // and never fires it again, so a hook that listened for itself heard nothing — and
    // the card never appeared for any guest who arrived the way guests arrive.
    chromiumOffers()

    const { result } = renderHook(() => useInstallPrompt({ eligible: true }))

    expect(result.current.offer).toEqual({ kind: 'prompt' })
  })

  it('offers nothing before a photo has arrived', () => {
    // A prompt on arrival is friction at the worst possible moment: the guest has just
    // scanned a QR code and is forty seconds from sending something.
    chromiumOffers()

    const { result } = renderHook(() => useInstallPrompt({ eligible: false }))

    expect(result.current.offer).toEqual({ kind: 'none' })
  })

  it('offers it as soon as the guest becomes eligible', async () => {
    chromiumOffers()
    const { result, rerender } = renderHook(
      ({ eligible }: { eligible: boolean }) => useInstallPrompt({ eligible }),
      { initialProps: { eligible: false } },
    )

    rerender({ eligible: true })

    await waitFor(() => expect(result.current.offer).toEqual({ kind: 'prompt' }))
  })

  it('notices an event that arrives while the screen is already open', async () => {
    const { result } = renderHook(() => useInstallPrompt({ eligible: true }))

    act(() => {
      chromiumOffers()
    })

    await waitFor(() => expect(result.current.offer).toEqual({ kind: 'prompt' }))
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
    const { prompt } = chromiumOffers()
    const { result } = renderHook(() => useInstallPrompt({ eligible: true }))

    await act(async () => {
      await result.current.install()
    })

    expect(prompt).toHaveBeenCalledTimes(1)
    expect(result.current.offer).toEqual({ kind: 'none' })
  })

  it('raises it once however many times the card is pressed', async () => {
    // A `BeforeInstallPromptEvent` may be prompted once; a second call throws. A thumb
    // on a phone double-taps.
    const { prompt } = chromiumOffers()
    const { result } = renderHook(() => useInstallPrompt({ eligible: true }))

    await act(async () => {
      await Promise.all([result.current.install(), result.current.install()])
    })

    expect(prompt).toHaveBeenCalledTimes(1)
  })

  it('remembers a refusal made in the browser’s own dialog', async () => {
    // The guest has answered the question. Asking again on the next visit would be
    // asking them to answer it twice.
    chromiumOffers('dismissed')
    const first = renderHook(() => useInstallPrompt({ eligible: true }))
    await act(async () => {
      await first.result.current.install()
    })
    first.unmount()

    chromiumOffers()
    const second = renderHook(() => useInstallPrompt({ eligible: true }))

    expect(second.result.current.offer).toEqual({ kind: 'none' })
  })

  it('says nothing to the guest when the browser refuses the prompt', async () => {
    // Raised outside a user gesture, or withdrawn by the browser. They did not ask for
    // this, and the photo is what they came for.
    const event = new Event('beforeinstallprompt') as BeforeInstallPromptEvent
    Object.assign(event, {
      prompt: vi.fn(async () => {
        throw new Error('must be called from a user gesture')
      }),
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    })
    window.dispatchEvent(event)
    const { result } = renderHook(() => useInstallPrompt({ eligible: true }))

    await act(async () => {
      await result.current.install()
    })

    expect(result.current.offer).toEqual({ kind: 'none' })
  })

  it('stops offering once the app is installed by any route', async () => {
    // The browser's own menu, for instance. Without this the card sits there offering
    // something already done.
    chromiumOffers()
    const { result } = renderHook(() => useInstallPrompt({ eligible: true }))

    act(() => {
      window.dispatchEvent(new Event('appinstalled'))
    })

    await waitFor(() => expect(result.current.offer).toEqual({ kind: 'none' }))
  })

  it('remembers "not now" across visits', () => {
    chromiumOffers()
    const first = renderHook(() => useInstallPrompt({ eligible: true }))
    act(() => first.result.current.dismiss())
    first.unmount()

    const second = renderHook(() => useInstallPrompt({ eligible: true }))

    expect(second.result.current.offer).toEqual({ kind: 'none' })
  })
})
