import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { WallItemDto, WallLayout } from '../../../lib/api/dto'
import { aWallItem } from '../../../testing/renderWithProviders'
import type { Slideshow } from '../hooks/useSlideshow'
import { WallLayouts } from './WallLayouts'

const KEN_BURNS_MS = 8_800
const INTERVAL_MS = 8_000

/**
 * `prefers-reduced-motion: reduce`, for the layouts that animate.
 *
 * jsdom ships no `matchMedia` and the harness's stub always answers `false`, which is
 * the right default and the wrong thing to leave a motion test resting on. This flips
 * one query and nothing else; `usePrefersReducedMotion` underneath is the real one.
 */
const asksForNoMotion = (): void => {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        media: query,
        matches: query.includes('prefers-reduced-motion'),
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList,
  )
}

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
const aSlideshow = (overrides: Partial<Slideshow> = {}): Slideshow => {
  // `intervalMs` follows `paused`, exactly as the real hook makes it: a paused wall
  // reports no cadence. Hand-building the two independently is how a test comes to
  // prove something the running product never does — the drift-while-paused defect was
  // "covered" by a case that set `intervalMs: 0` on a wall that was not paused.
  const paused = overrides.paused ?? false

  return {
    current: null,
    next: null,
    previous: null,
    index: 0,
    intervalMs: paused ? 0 : INTERVAL_MS,
    generation: 0,
    paused,
    pause: () => undefined,
    resume: () => undefined,
    advance: () => undefined,
    ...overrides,
  }
}

/** The one prop every case sets differently; the rest of the view is never the point. */
const renderWall = (
  layout: WallLayout,
  items: readonly WallItemDto[],
  slideshow: Partial<Slideshow> = {},
) =>
  render(
    <WallLayouts
      layout={layout}
      items={items}
      slideshow={aSlideshow({ current: items[slideshow.index ?? 0] ?? null, ...slideshow })}
      kenBurnsDurationMs={KEN_BURNS_MS}
      transitionMs={null}
    />,
  )

const photoIdsOnScreen = (): readonly (string | null)[] =>
  screen.getAllByTestId('wall-slide').map((slide) => slide.getAttribute('data-photo-id'))

const photosOnScreen = (): readonly (string | null)[] =>
  screen.getAllByRole('img').map((image) => image.getAttribute('alt'))

/** The stage carrying the crossfade timing; it has no accessible identity of its own. */
const stageOf = (container: HTMLElement): HTMLElement => {
  const stage = container.firstElementChild
  if (!(stage instanceof HTMLElement)) throw new Error('the layout rendered no stage')
  return stage
}

/**
 * The element a layout declares its animation on.
 *
 * `data-motion` is how a wall layout says "run this" or "do not", instead of leaving it
 * to the reduced-motion rule in `base.css` — which collapses an animation's duration and
 * would snap a `both` keyframe to its end frame. Asserting the attribute is asserting
 * the decision; the keyframes themselves are what the visual suite photographs.
 */
const motionOf = (container: HTMLElement): string | null => {
  const node = container.querySelector('[data-motion]')
  if (!(node instanceof HTMLElement)) throw new Error('the layout declared no motion state')
  return node.getAttribute('data-motion')
}

const driftDurationOf = (container: HTMLElement): string => {
  const node = container.querySelector('[data-motion]')
  if (!(node instanceof HTMLElement)) throw new Error('the layout declared no motion state')
  return node.style.getPropertyValue('--wall-drift-duration')
}

/**
 * Whether the filmstrip's track overflows, which is what decides where it is anchored.
 *
 * A separate question from whether it is moving, and conflating the two was the bug: a
 * centred track splits its overflow across both edges, so the drift uncovered the right
 * edge at the end of every slide. jsdom lays nothing out, so the attribute is the
 * assertable form of the decision; the pixels are the visual suite's job.
 */
const stripOf = (container: HTMLElement): string | null => {
  const node = container.querySelector('[data-strip]')
  if (!(node instanceof HTMLElement)) throw new Error('the filmstrip declared no anchoring')
  return node.getAttribute('data-strip')
}

/** Every print's angle, in degrees, read off the custom property that carries it. */
const tiltOf = (container: HTMLElement): readonly number[] =>
  [...container.querySelectorAll('[data-testid="wall-slide"]')].map((print) => {
    if (!(print instanceof HTMLElement)) throw new Error('a print was not an element')
    return Number.parseFloat(print.style.getPropertyValue('--wall-tilt'))
  })

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

  it.each<WallLayout>(['polaroid', 'filmstrip', 'collage', 'split'])(
    'shows nothing and asks for no bytes when %s has an empty playlist',
    (layout) => {
      const { container } = renderWall(layout, [])

      // The first twenty minutes of an evening. Every layout has to survive them without
      // a stray <img>: an element with no source is a second request for the page itself
      // in some browsers, and the projector is the one screen nobody can go and fix.
      expect(screen.queryByTestId('wall-slide')).toBeNull()
      expect(container.querySelectorAll('img')).toHaveLength(0)
    },
  )
})

/**
 * Three prints on a dark ground, for a wedding of sixty.
 *
 * The metaphor is the feature: paper, a mat, a few degrees of turn, and a print that
 * lands rather than cuts. What has to hold is that none of it is random — two projectors
 * in one room turn the same print the same way — and that the landing goes away for
 * somebody who asked for no motion, because a projected element moving towards the room
 * is the worst case there is.
 */
describe('the polaroid layout', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('mounts three prints and names the photo on each', () => {
    renderWall('polaroid', somePhotos(8))

    expect(photoIdsOnScreen()).toEqual(['photo-0', 'photo-1', 'photo-2'])
  })

  it('changes one print per interval, so the pile reads as a placement and not a refresh', () => {
    renderWall('polaroid', somePhotos(8), { index: 4 })

    // Slot 1's turn. The other two prints are where they were at the previous slide,
    // which is what makes a new photo arriving read as an event in the room.
    expect(photoIdsOnScreen()).toEqual(['photo-3', 'photo-4', 'photo-2'])
  })

  it('shows only the prints it can fill when the playlist is shorter than the pile', () => {
    renderWall('polaroid', somePhotos(2))

    // The same face twice on one wall reads as a fault, so two photos make two prints.
    expect(screen.getAllByTestId('wall-slide')).toHaveLength(2)
  })

  it('captions each print, because a mat is exactly where a caption belongs', () => {
    renderWall('polaroid', somePhotos(3))

    expect(screen.getByText('Photo 0')).toBeVisible()
    expect(screen.getAllByText('Léa')).toHaveLength(3)
  })

  it('turns a print by an angle derived from its photo, so two projectors agree', () => {
    const items = somePhotos(8)

    const first = renderWall('polaroid', items)
    const before = tiltOf(first.container)
    first.unmount()
    const second = renderWall('polaroid', items)

    // The one visual property that would otherwise want `Math.random()`. The same rule
    // that already decides which photo lands in which slot: derived, never rolled.
    expect(tiltOf(second.container)).toEqual(before)
  })

  it('keeps every tilt inside the range that reads as placed rather than as fallen over', () => {
    const { container } = renderWall('polaroid', somePhotos(8))

    for (const degrees of tiltOf(container)) {
      expect(Math.abs(degrees)).toBeLessThanOrEqual(4)
    }
  })

  it('does not land a print at all for somebody who asked for no motion', () => {
    asksForNoMotion()

    const { container } = renderWall('polaroid', somePhotos(8))

    // Not a shorter landing: `base.css` collapses an animation's duration, and a
    // keyframe with `both` then snaps to its end frame instead of not running. The stage
    // declines to declare the animation, exactly as `SlideLayer` does for Ken Burns.
    expect(motionOf(container)).toBe('still')
    // The tilt is composition, not motion, and stays: three square prints in a row is a
    // grid of three, which is a layout this wall already has.
    expect(tiltOf(container).some((degrees) => degrees !== 0)).toBe(true)
  })
})

/**
 * A band of photos drifting sideways, for a cocktail hour nobody is watching.
 *
 * The drift is the only animation on the wall that runs for the whole length of a slide,
 * so it is the one place 1.0's Ken Burns bug could come back: an animation with a
 * duration of its own beside a slide interval. It is timed from the slideshow's own
 * number and restarted in step with the window it moves, and both are asserted here.
 */
describe('the filmstrip layout', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('holds one frame more than it shows, so the next photo is already on the strip', () => {
    renderWall('filmstrip', somePhotos(8))

    // Five visible and one waiting off the right edge. The drift is exactly the distance
    // that turns the sixth into the fifth, which is what makes the movement continuous
    // while the DOM holds six figures all evening.
    expect(photoIdsOnScreen()).toEqual([
      'photo-0',
      'photo-1',
      'photo-2',
      'photo-3',
      'photo-4',
      'photo-5',
    ])
  })

  it('advances the whole strip by one photo per interval', () => {
    renderWall('filmstrip', somePhotos(8), { index: 1 })

    expect(photoIdsOnScreen()).toEqual([
      'photo-1',
      'photo-2',
      'photo-3',
      'photo-4',
      'photo-5',
      'photo-6',
    ])
  })

  it('wraps past the end of the playlist rather than running out of strip', () => {
    renderWall('filmstrip', somePhotos(8), { index: 6 })

    // Eight hours of one incrementing cursor. The front of the playlist follows the
    // back, so the last slide is succeeded by the first and never by a gap.
    expect(photoIdsOnScreen()).toEqual([
      'photo-6',
      'photo-7',
      'photo-0',
      'photo-1',
      'photo-2',
      'photo-3',
    ])
  })

  it('drifts for exactly one slide, never longer', () => {
    const { container } = renderWall('filmstrip', somePhotos(8))

    // The 1.0 defect was a 20s zoom beside a 10s slide, and every image visibly snapped
    // back mid-slide. There is one number here and it is the slideshow's own, so a drift
    // that outlasts its slide is unrepresentable rather than guarded against.
    expect(driftDurationOf(container)).toBe(`${INTERVAL_MS}ms`)
    expect(motionOf(container)).toBe('drift')
  })

  it('does not drift at all for somebody who asked for no motion', () => {
    asksForNoMotion()

    const { container } = renderWall('filmstrip', somePhotos(8))

    // A projected band moving continuously across four metres of wall is the worst
    // vestibular case in the product. The photos still change; only the movement goes.
    expect(motionOf(container)).toBe('still')
    expect(driftDurationOf(container)).toBe('')
    expect(screen.getAllByTestId('wall-slide').length).toBeGreaterThan(0)
  })

  it('stands still when the playlist is shorter than the strip', () => {
    const { container } = renderWall('filmstrip', somePhotos(4))

    // There is nothing to drift towards, and rotating four photos through four frames
    // would move faces around the wall for no reason at all.
    expect(motionOf(container)).toBe('still')
    expect(photoIdsOnScreen()).toEqual(['photo-0', 'photo-1', 'photo-2', 'photo-3'])
  })

  it('stands still the moment the host pauses the wall', () => {
    const { container } = renderWall('filmstrip', somePhotos(8), { paused: true })

    // A host pauses to hold a photo during a speech. The drift went on travelling to the
    // end of its slide and then held there for as long as the wall stayed paused, which
    // with the old centred track meant a tenth of the screen black in front of the room.
    // `useSlideshow` reports no cadence for a paused wall, which is the one condition
    // this reads — there is no second flag here to disagree with it.
    expect(motionOf(container)).toBe('still')
    expect(driftDurationOf(container)).toBe('')
  })

  it('anchors a full strip at its start edge, so the drift never uncovers the far edge', () => {
    const { container } = renderWall('filmstrip', somePhotos(8))

    // A centred flex container splits its overflow across both edges, so one frame of
    // drift left the right edge empty — 192px of a 1920 screen, once per slide, all
    // evening. Anchored at the start, the six frames span 0..2304 and the drift ends at
    // -384..1920: every phase in between is fully covered.
    expect(stripOf(container)).toBe('scrolling')
  })

  it('centres a strip the playlist cannot fill, rather than hugging the left edge', () => {
    const { container } = renderWall('filmstrip', somePhotos(4))

    // Nothing overflows here, so there is no overflow to split and centring is right.
    expect(stripOf(container)).toBe('short')
  })

  it('stays anchored under reduced motion, where the strip still overflows', () => {
    asksForNoMotion()

    const { container } = renderWall('filmstrip', somePhotos(8))

    // Whether the strip overflows and whether it is moving are different questions. A
    // full strip that stopped drifting must not also start hanging off both edges.
    expect(motionOf(container)).toBe('still')
    expect(stripOf(container)).toBe('scrolling')
  })
})

/**
 * A grid that composes itself over the evening.
 *
 * The reward is watching it fill, so this is the one layout that deliberately shows less
 * than it could at the start of the night. How full it is comes from the count of slides
 * this screen has shown — a per-screen number that resets on a reload — and which photo
 * sits where comes from the playlist position, so two screens on the same index compose
 * the same grid. Two screens that have been running for different lengths of time do
 * not, and that is a property of the fill, not a bug in the derivation.
 */
describe('the collage layout', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows every cell it has composed for somebody who asked for no motion', () => {
    asksForNoMotion()

    renderWall('collage', somePhotos(20), { index: 3, generation: 3 })

    // The collage is the third layout that animates beyond the crossfade, and the only
    // one that does not decline its animation in JavaScript: `cell-arrives` ends at the
    // cell's resting state, so `base.css` collapsing it to a single frame lands exactly
    // where the animation would have. What must not depend on motion is the content, and
    // that is what this asserts — the grid is the same grid either way.
    expect(photoIdsOnScreen()).toEqual(['photo-0', 'photo-1', 'photo-2', 'photo-3'])
  })

  it('starts on a single photo, so there is something for the room to watch fill', () => {
    renderWall('collage', somePhotos(20))

    expect(photoIdsOnScreen()).toEqual(['photo-0'])
  })

  it('gains a cell for every slide the wall has shown', () => {
    renderWall('collage', somePhotos(20), { index: 3, generation: 3 })

    expect(photoIdsOnScreen()).toEqual(['photo-0', 'photo-1', 'photo-2', 'photo-3'])
  })

  it('stops growing at twelve cells however long the evening runs', () => {
    renderWall('collage', somePhotos(200), { index: 400, generation: 400 })

    // The renderer's `COLLAGE_CELLS`, which mirrors `wallLayoutSpec('collage').slotCount`
    // and cannot be joined to it — the import boundary keeps the domain out of `web/`, so
    // the number is pinned twice, here and in `wallLayout.test.ts`. It is also the cap on
    // the elements this layout may hold: an eight-hour run ends with the number of <img>
    // nodes it started with, not with four hundred.
    expect(screen.getAllByTestId('wall-slide')).toHaveLength(12)
  })

  it('never grows past the photos it actually has', () => {
    renderWall('collage', somePhotos(3), { index: 2, generation: 9 })

    // A host switching to the collage an hour in must not be shown nine cells of which
    // six repeat the same three faces.
    expect(screen.getAllByTestId('wall-slide')).toHaveLength(3)
  })

  it('recycles a cell in turn once the grid is full', () => {
    renderWall('collage', somePhotos(20), { index: 12, generation: 40 })

    // Cell 0's turn comes round after twelve slides. Derived from the position alone, so
    // two projectors hold the same photo in the same cell.
    expect(photoIdsOnScreen()[0]).toBe('photo-12')
    expect(photoIdsOnScreen()[1]).toBe('photo-1')
  })
})

/**
 * Two photos side by side, an older upload beside a newer one.
 *
 * For an ultra-wide screen, where one letterboxed photo leaves two enormous black bars.
 * Neither half crops, and only one half changes at a time — a wall where both cut at
 * once is two slideshows rather than a pairing.
 */
describe('the split layout', () => {
  it('pairs a photo from earlier in the evening with one from the top of the playlist', () => {
    renderWall('split', somePhotos(8), { index: 2 })

    // Newest first, so half a playlist back is an older upload. That pairing is the whole
    // reason a host picks this layout over two mosaic tiles.
    expect(photoIdsOnScreen()).toEqual(['photo-6', 'photo-1'])
  })

  it('changes one pane per interval, so one half is always stable', () => {
    renderWall('split', somePhotos(8), { index: 3 })

    // The right half moved on; the left is exactly where the previous slide left it.
    expect(photoIdsOnScreen()).toEqual(['photo-6', 'photo-3'])
  })

  it('shows the two most recent photos when the playlist is too short to have an old end', () => {
    renderWall('split', somePhotos(3))

    // A lag of one on a three-photo playlist would put the same face in both halves, and
    // that is what the room reads as a fault.
    expect(photoIdsOnScreen()).toEqual(['photo-0', 'photo-1'])
  })

  it('fills one pane rather than repeating the only photo there is', () => {
    renderWall('split', somePhotos(1))

    expect(photoIdsOnScreen()).toEqual(['photo-0'])
  })

  it('captions both panes, because a half screen is big enough to read one', () => {
    renderWall('split', somePhotos(8), { index: 2 })

    expect(screen.getByText('Photo 6')).toBeVisible()
    expect(screen.getByText('Photo 1')).toBeVisible()
    expect(screen.getAllByText('Léa')).toHaveLength(2)
  })

  it('keeps each caption in its own pane, in flow, instead of loose over the wall', () => {
    renderWall('split', somePhotos(8), { index: 2 })

    // `.caption` is absolutely positioned for the spotlight and the mosaic tile, and a
    // <figure> with no `position` of its own is not a containing block. Both split
    // captions therefore resolved against the stage and rendered as one full-width box
    // at the bottom of the screen — printed over each other, and past the overscan inset
    // a consumer projector eats — while the row the pane reserves for them stayed empty.
    // The two previous assertions passed throughout, because jsdom lays nothing out.
    for (const pane of screen.getAllByTestId('wall-slide')) {
      const caption = pane.querySelector('figcaption')
      if (caption === null) throw new Error('a pane rendered no caption')
      expect(getComputedStyle(caption).position).toBe('static')
    }
  })

  it('prepares the photo the next pane will turn to', () => {
    const items = somePhotos(8)

    const { container } = render(
      <WallLayouts
        layout="split"
        items={items}
        slideshow={aSlideshow({ current: items[2] ?? null, next: items[3] ?? null, index: 2 })}
        kenBurnsDurationMs={KEN_BURNS_MS}
        transitionMs={null}
      />,
    )

    // A crossfade that starts before the incoming bytes have arrived shows a blank frame,
    // and on venue Wi-Fi that is most of them. Half a screen makes that very visible.
    expect(container.querySelector('img[aria-hidden="true"]')).toHaveAttribute(
      'src',
      items[3]?.displayUrl ?? '',
    )
  })
})
