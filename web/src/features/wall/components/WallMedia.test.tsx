import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { aWallClip, aWallItem } from '../../../testing/renderWithProviders'
import { WallMedia } from './WallMedia'

/**
 * The element itself, rather than the layouts around it.
 *
 * `WallLayouts.test.tsx` covers which layouts play and which show the still — that is a
 * question about the spec. What is left here is the life of one `<video>` on a projector
 * that runs for eight hours: when it degrades, when it must **not**, and what it lets go
 * of when the slide is over. None of that is visible from a layout test, and both of the
 * defects below were invisible to a full green suite.
 */

const clip = aWallClip()

interface DeferredPlay {
  readonly reject: (cause: unknown) => void
}

/**
 * A `play()` that has not settled, the way a real one has not on venue Wi-Fi.
 *
 * The distinction this file exists for: `mockResolvedValue()` never produces a *pending*
 * promise, so a `pause()` arriving mid-decode — which is what every slide advance is —
 * cannot be expressed with it. That is why the bug below survived a suite that looked
 * like it covered the same ground.
 */
const deferredPlay = (): DeferredPlay => {
  let rejectPlay: ((cause: unknown) => void) | undefined
  const pending = new Promise<void>((_resolve, reject) => {
    rejectPlay = reject
  })
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockReturnValue(pending)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  if (rejectPlay === undefined) throw new Error('the deferred play was never wired')
  return { reject: rejectPlay }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('a clip interrupted before it finished starting', () => {
  it('stays a clip when a slide advance aborts a play that had not settled', async () => {
    // The spotlight's two layers are permanent: advancing a slide pauses the outgoing
    // one, and pausing **rejects a pending play promise with `AbortError`**. Treating
    // that as a decode failure swaps the element for its poster at the exact instant the
    // dissolve begins — the snap-back this component's own comment says it exists to
    // prevent — and on a slow connection that is every slide.
    const play = deferredPlay()
    const { container, rerender } = render(<WallMedia item={clip} plays alt="une vidéo" />)

    rerender(<WallMedia item={clip} plays paused alt="une vidéo" />)
    await act(async () => {
      play.reject(
        new DOMException('The play() request was interrupted by a call to pause()', 'AbortError'),
      )
    })

    expect(container.querySelector('video')).not.toBeNull()
    expect(container.querySelector('img')).toBeNull()
  })

  it('still degrades when the browser refuses to play it at all', async () => {
    // The other half, and the reason the filter has to be narrow: a policy refusal or a
    // codec this box does not have is a black rectangle in the middle of a wedding
    // unless it becomes the poster.
    const play = deferredPlay()
    const { container } = render(<WallMedia item={clip} plays alt="une vidéo" />)

    await act(async () => {
      play.reject(new DOMException('play() failed', 'NotAllowedError'))
    })

    expect(container.querySelector('video')).toBeNull()
    expect(container.querySelector('img')).toHaveAttribute('src', clip.displayUrl)
  })
})

describe('when the slide is over', () => {
  it('lets go of the decoder instead of leaving it attached to a detached element', () => {
    // Eight hours is a thousand slides. A `<video>` still pointing at a source keeps the
    // platform's decoder attached to it, which is exactly what `probeClipDuration` says
    // and does — and this is the surface where it accumulates.
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})

    const { container, unmount } = render(<WallMedia item={clip} plays alt="une vidéo" />)
    const element = container.querySelector('video')
    expect(element).not.toBeNull()

    unmount()

    expect(element?.getAttribute('src')).toBeNull()
    expect(load).toHaveBeenCalled()
  })

  it('has nothing to release for a photograph', () => {
    const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})

    const { unmount } = render(<WallMedia item={aWallItem()} plays alt="une photo" />)
    unmount()

    expect(load).not.toHaveBeenCalled()
  })
})
