import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { WallItemDto } from '../../../lib/api/dto'
import { aWallItem } from '../../../testing/renderWithProviders'
import type { Slideshow } from '../hooks/useSlideshow'
import { WallLayouts } from './WallLayouts'

const KEN_BURNS_MS = 8_800

const somePhotos = (count: number): readonly WallItemDto[] =>
  Array.from({ length: count }, (_unused, at) =>
    aWallItem({ id: `photo-${at}`, caption: `Photo ${at}`, authorName: 'Léa' }),
  )

/**
 * A slideshow, as a layout sees one.
 *
 * The layouts render and never drive the slideshow — position, pausing and stepping all
 * belong to `useSlideshow`, which has its own tests — so the three callbacks are no-ops
 * here rather than recorded.
 */
const aSlideshow = (overrides: Partial<Slideshow> = {}): Slideshow => ({
  current: null,
  next: null,
  previous: null,
  index: 0,
  generation: 0,
  paused: false,
  pause: () => undefined,
  resume: () => undefined,
  advance: () => undefined,
  ...overrides,
})

const photosOnScreen = (): readonly (string | null)[] =>
  screen.getAllByRole('img').map((image) => image.getAttribute('alt'))

/** The stage carrying the crossfade timing; it has no accessible identity of its own. */
const stageOf = (container: HTMLElement): HTMLElement => {
  const stage = container.firstElementChild
  if (!(stage instanceof HTMLElement)) throw new Error('the layout rendered no stage')
  return stage
}

describe('WallLayouts', () => {
  it('fills every mosaic tile from the first frame instead of filling in over a minute', () => {
    const items = somePhotos(8)

    render(
      <WallLayouts
        layout="mosaic"
        items={items}
        slideshow={aSlideshow({ current: items[0] ?? null, index: 0 })}
        kenBurnsDurationMs={KEN_BURNS_MS}
        transitionMs={null}
      />,
    )

    // Before a tile's first turn it shows the photo at its own position, so a host who
    // switches to the mosaic sees six photos rather than one and five holes.
    expect(photosOnScreen()).toEqual([
      expect.stringContaining('Photo 0'),
      expect.stringContaining('Photo 1'),
      expect.stringContaining('Photo 2'),
      expect.stringContaining('Photo 3'),
      expect.stringContaining('Photo 4'),
      expect.stringContaining('Photo 5'),
    ])
  })

  it('changes one mosaic tile per interval, in turn', () => {
    const items = somePhotos(8)

    render(
      <WallLayouts
        layout="mosaic"
        items={items}
        slideshow={aSlideshow({ current: items[6] ?? null, index: 6 })}
        kenBurnsDurationMs={KEN_BURNS_MS}
        transitionMs={null}
      />,
    )

    // A whole-wall refresh every eight seconds reads as a fault from across the room,
    // and one tile at a time is what gives each photo six intervals on screen. Derived
    // from the index alone, so two projectors on one event agree tile for tile.
    expect(photosOnScreen()).toEqual([
      expect.stringContaining('Photo 6'),
      expect.stringContaining('Photo 1'),
      expect.stringContaining('Photo 2'),
      expect.stringContaining('Photo 3'),
      expect.stringContaining('Photo 4'),
      expect.stringContaining('Photo 5'),
    ])
  })

  it('names the photo in every mosaic tile, so two projectors can be compared tile by tile', () => {
    const items = somePhotos(8)

    render(
      <WallLayouts
        layout="mosaic"
        items={items}
        slideshow={aSlideshow({ current: items[6] ?? null, index: 6 })}
        kenBurnsDurationMs={KEN_BURNS_MS}
        transitionMs={null}
      />,
    )

    // Each tile's photo is derived from the index alone. Naming it is what turns that
    // claim into something observable from outside React.
    expect(
      screen.getAllByTestId('wall-slide').map((tile) => tile.getAttribute('data-photo-id')),
    ).toEqual(['photo-6', 'photo-1', 'photo-2', 'photo-3', 'photo-4', 'photo-5'])
  })

  it('shows only the tiles it can fill when the playlist is shorter than the grid', () => {
    const items = somePhotos(3)

    render(
      <WallLayouts
        layout="mosaic"
        items={items}
        slideshow={aSlideshow({ current: items[0] ?? null, index: 0 })}
        kenBurnsDurationMs={KEN_BURNS_MS}
        transitionMs={null}
      />,
    )

    // Three photos at the start of the evening must not be repeated into six tiles: the
    // same face twice on one wall reads as a fault.
    expect(screen.getAllByTestId('wall-slide')).toHaveLength(3)
  })

  it('shows nothing and asks for no bytes when the mosaic has an empty playlist', () => {
    const { container } = render(
      <WallLayouts
        layout="mosaic"
        items={[]}
        slideshow={aSlideshow()}
        kenBurnsDurationMs={KEN_BURNS_MS}
        transitionMs={null}
      />,
    )

    expect(screen.queryByTestId('wall-slide')).toBeNull()
    // Not even the hidden preload: there is no next photo to prepare, and an <img> with
    // no source is a second request for the page itself in some browsers.
    expect(container.querySelectorAll('img')).toHaveLength(0)
  })

  it('hands the mosaic stage the crossfade length it was given', () => {
    const items = somePhotos(8)

    const { container } = render(
      <WallLayouts
        layout="mosaic"
        items={items}
        slideshow={aSlideshow({ current: items[0] ?? null, next: items[1] ?? null, index: 0 })}
        kenBurnsDurationMs={KEN_BURNS_MS}
        transitionMs={0}
      />,
    )

    expect(stageOf(container).style.getPropertyValue('--wall-transition')).toBe('0ms')
  })

  it('prepares the photo the next tile will turn to', () => {
    const items = somePhotos(8)

    const { container } = render(
      <WallLayouts
        layout="mosaic"
        items={items}
        slideshow={aSlideshow({ current: items[0] ?? null, next: items[6] ?? null, index: 0 })}
        kenBurnsDurationMs={KEN_BURNS_MS}
        transitionMs={null}
      />,
    )

    // The tile that turns next shows exactly the slideshow's next photo, so that is the
    // one whose bytes are fetched and decoded ahead of the change.
    const preload = container.querySelector('img[aria-hidden="true"]')
    expect(preload).toHaveAttribute('src', items[6]?.displayUrl ?? '')
  })

  it('renders no caption panel when the spotlight has no photo to caption', () => {
    const { container } = render(
      <WallLayouts
        layout="spotlight"
        items={[]}
        slideshow={aSlideshow()}
        kenBurnsDurationMs={KEN_BURNS_MS}
        transitionMs={null}
      />,
    )

    // A scrim with nothing written on it is a grey band across the bottom of a black
    // screen, which reads as a broken projector rather than as an empty wall.
    expect(container.querySelector('figcaption')).toBeNull()
  })

  it('falls back to the nearest built layout rather than showing the room nothing', () => {
    const items = somePhotos(8)

    render(
      <WallLayouts
        layout="polaroid"
        items={items}
        slideshow={aSlideshow({ current: items[0] ?? null, next: items[1] ?? null, index: 0 })}
        kenBurnsDurationMs={KEN_BURNS_MS}
        transitionMs={null}
      />,
    )

    // `polaroid` is in the API contract but not built yet. A blank projector in front of
    // two hundred people is the worst outcome available, so it lands on the spotlight.
    expect(screen.getAllByTestId('wall-slide')).toHaveLength(1)
    expect(screen.getByText('Photo 0')).toBeVisible()
  })

  it('falls back to the mosaic for a filmstrip, which is the layout it is closest to', () => {
    const items = somePhotos(8)

    render(
      <WallLayouts
        layout="filmstrip"
        items={items}
        slideshow={aSlideshow({ current: items[0] ?? null, next: items[1] ?? null, index: 0 })}
        kenBurnsDurationMs={KEN_BURNS_MS}
        transitionMs={null}
      />,
    )

    expect(screen.getAllByTestId('wall-slide')).toHaveLength(6)
  })
})
