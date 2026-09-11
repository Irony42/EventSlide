import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { aWallItem } from '../../../testing/renderWithProviders'
import { SlideCaption } from './SlideCaption'
import { SlideLayer } from './SlideLayer'

const KEN_BURNS_MS = 8_800

/**
 * Reduced motion, as the browser reports it.
 *
 * `base.css` already collapses CSS animations under the query, but the Ken Burns
 * duration is declared from JavaScript and has to be withheld rather than shortened —
 * a 0.01 ms `scale(1.08)` with a fill mode snaps to the zoomed frame and stays there.
 */
const prefersReducedMotion = (): void => {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: query.includes('prefers-reduced-motion'),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
        // A hand-written stub cannot satisfy a whole DOM interface, which is the one
        // place the web app allows a structural cast.
      }) as unknown as MediaQueryList,
  )
}

/** The stage is the element carrying the crossfade timing; it has no accessible identity. */
const stageOf = (container: HTMLElement): HTMLElement => {
  const stage = container.firstElementChild
  if (!(stage instanceof HTMLElement)) throw new Error('the layer rendered no stage')
  return stage
}

const confettis = aWallItem({ id: 'photo-1', caption: 'Les confettis', authorName: 'Léa' })
const gateau = aWallItem({ id: 'photo-2', caption: 'Le gâteau', authorName: 'Sacha' })

describe('SlideLayer', () => {
  it('leaves the crossfade length to the stylesheet unless it is given one', () => {
    const { container } = render(
      <SlideLayer
        current={confettis}
        previous={null}
        next={gateau}
        kenBurnsDurationMs={KEN_BURNS_MS}
        transitionMs={null}
        generation={0}
      />,
    )

    // `--duration-slow` is the design system's answer; declaring the property with no
    // value to put in it would override the token with nothing.
    expect(stageOf(container).style.getPropertyValue('--wall-transition')).toBe('')
  })

  it('hands the stage the crossfade length it was given, so a cut can be asked for', () => {
    const { container } = render(
      <SlideLayer
        current={confettis}
        previous={gateau}
        next={gateau}
        kenBurnsDurationMs={KEN_BURNS_MS}
        transitionMs={0}
        generation={1}
      />,
    )

    // The end-to-end suite drives the wall with `?e2e_transition=0`: without it a
    // projector journey would have to wait out a real dissolve on every slide.
    expect(stageOf(container).style.getPropertyValue('--wall-transition')).toBe('0ms')
  })

  it('prepares nothing when there is no photo after this one', () => {
    const { container } = render(
      <SlideLayer
        current={confettis}
        previous={null}
        next={null}
        kenBurnsDurationMs={KEN_BURNS_MS}
        transitionMs={null}
        generation={0}
      />,
    )

    // One photo on the wall: the only <img> is the one being shown, and the hidden
    // preload is absent rather than pointing at the photo already on screen.
    expect(container.querySelectorAll('img')).toHaveLength(1)
  })

  it('gives each layer a permanent slot so the outgoing photo is never moved mid-fade', () => {
    const { container } = render(
      <SlideLayer
        current={gateau}
        previous={confettis}
        next={confettis}
        kenBurnsDurationMs={KEN_BURNS_MS}
        transitionMs={null}
        generation={1}
      />,
    )

    // Moving a DOM node restarts its CSS animation, which jerks the outgoing photo back
    // to its start scale halfway through the dissolve. So the odd generation takes the
    // second slot rather than the two figures swapping places.
    const figures = container.querySelectorAll('figure')
    expect(figures[1]).toHaveAttribute('data-testid', 'wall-slide')
    expect(figures[0]).toHaveAttribute('aria-hidden', 'true')
  })

  it('announces the photo on screen and not the copy fading out of it', () => {
    render(
      <SlideLayer
        current={gateau}
        previous={confettis}
        next={confettis}
        kenBurnsDurationMs={KEN_BURNS_MS}
        transitionMs={null}
        generation={0}
      />,
    )

    // Both photos are in the document during the dissolve. Naming both would read the
    // wall out twice, half a second apart.
    const named = screen.getAllByRole('img')
    expect(named).toHaveLength(1)
    expect(named[0]).toHaveAccessibleName(/Le gâteau/)
  })

  it('names the photo it is showing, so the slide on screen can be identified', () => {
    render(
      <SlideLayer
        current={confettis}
        previous={null}
        next={gateau}
        kenBurnsDurationMs={KEN_BURNS_MS}
        transitionMs={null}
        generation={0}
      />,
    )

    // The position is derived from the playlist and never stored, so the DOM is the only
    // place the answer exists. It is how two projectors in one room are shown to agree,
    // and how a wall that has quietly stopped advancing is caught.
    expect(screen.getByTestId('wall-slide')).toHaveAttribute('data-photo-id', 'photo-1')
  })

  it('names the outgoing photo too, so the two halves of a dissolve are told apart', () => {
    const { container } = render(
      <SlideLayer
        current={gateau}
        previous={confettis}
        next={confettis}
        kenBurnsDurationMs={KEN_BURNS_MS}
        transitionMs={null}
        generation={1}
      />,
    )

    // Mid-crossfade both photos are on screen. The slot is permanent and the photo is
    // what changes, so each layer names the photo it holds rather than its slot.
    const named = [...container.querySelectorAll('figure')].map((figure) =>
      figure.getAttribute('data-photo-id'),
    )
    expect(named).toEqual(['photo-1', 'photo-2'])
  })

  it('names no photo on a layer that is holding none', () => {
    const { container } = render(
      <SlideLayer
        current={confettis}
        previous={null}
        next={null}
        kenBurnsDurationMs={KEN_BURNS_MS}
        transitionMs={null}
        generation={0}
      />,
    )

    // The first slide of the evening: the outgoing layer is empty, and an attribute
    // naming a photo it is not showing would make an empty layer look like a slide.
    expect(container.querySelectorAll('[data-photo-id]')).toHaveLength(1)
  })

  it('shows a finished still frame when the viewer asked for no motion', () => {
    prefersReducedMotion()

    render(
      <SlideLayer
        current={confettis}
        previous={null}
        next={gateau}
        kenBurnsDurationMs={KEN_BURNS_MS}
        transitionMs={null}
        generation={0}
        caption={<SlideCaption caption={confettis.caption} authorName={confettis.authorName} />}
      />,
    )

    // Not the first frame of an animation that never runs: the photo, its caption and
    // its author are all there, and no duration is declared for a zoom that was never
    // declared either.
    const slide = screen.getByTestId('wall-slide')
    expect(slide).toHaveAttribute('data-motion', 'still')
    expect(slide.style.getPropertyValue('--wall-kenburns-duration')).toBe('')
    expect(screen.getByRole('img')).toBeVisible()
    expect(screen.getByText('Les confettis')).toBeVisible()
    expect(screen.getByText('Léa')).toBeVisible()
  })
})
