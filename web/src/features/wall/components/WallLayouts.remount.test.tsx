import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import type { WallItemDto, WallLayout } from '../../../lib/api/dto'
import { aWallItem } from '../../../testing/renderWithProviders'
import type { Slideshow } from '../hooks/useSlideshow'
import { WallLayouts } from './WallLayouts'

/**
 * What the split layout files hold that no other suite pins: which nodes remount when the
 * photo changes, and that every layout hands the next photo to the hidden preload.
 */

const somePhotos = (count: number): readonly WallItemDto[] =>
  Array.from({ length: count }, (_unused, at) =>
    aWallItem({ id: `photo-${at}`, caption: `Photo ${at}`, authorName: 'Léa' }),
  )

const slideshowAt = (items: readonly WallItemDto[], index: number, next: number): Slideshow => {
  const at = (position: number): WallItemDto | null =>
    items[((position % items.length) + items.length) % items.length] ?? null
  return {
    current: at(index),
    next: at(next),
    previous: at(index - 1),
    index,
    intervalMs: 8_000,
    generation: index,
    automaticChanges: 0,
    recent: Array.from({ length: 12 }, (_, back) => ({ item: at(index - back), fresh: false })),
    upcoming: Array.from({ length: 6 }, (_, ahead) => at(index + 1 + ahead)).filter(
      (item): item is WallItemDto => item !== null,
    ),
    fresh: false,
    paused: false,
    pause: () => undefined,
    resume: () => undefined,
    advance: () => undefined,
  }
}

const view = (layout: WallLayout, items: readonly WallItemDto[], slideshow: Slideshow) => (
  <WallLayouts
    layout={layout}
    items={items}
    slideshow={slideshow}
    kenBurnsDurationMs={8_800}
    transitionMs={null}
  />
)

const slides = (container: HTMLElement): readonly HTMLElement[] =>
  Array.from(container.querySelectorAll<HTMLElement>('[data-testid="wall-slide"]'))

/** Rerender one step later and return, per slot, whether it changed photo and whether its node did. */
const stepOnce = (layout: WallLayout, pick: (slide: HTMLElement) => HTMLElement | null) => {
  const items = somePhotos(20)
  const { container, rerender } = render(view(layout, items, slideshowAt(items, 3, 4)))
  const before = slides(container).map((slide) => ({
    id: slide.getAttribute('data-photo-id'),
    node: pick(slide),
  }))
  rerender(view(layout, items, slideshowAt(items, 4, 5)))
  const after = slides(container).map((slide) => ({
    id: slide.getAttribute('data-photo-id'),
    node: pick(slide),
  }))
  return before.map((was, at) => ({
    changed: was.id !== after[at]?.id,
    remounted: was.node !== after[at]?.node,
  }))
}

describe('the remounts the layouts rely on', () => {
  it('lands a new polaroid print on a fresh node when a slot changes photo', () => {
    const slots = stepOnce('polaroid', (slide) => slide)

    expect(slots.some((slot) => slot.changed)).toBe(true)
    for (const slot of slots) expect(slot.remounted).toBe(slot.changed)
  })

  it('swaps the split pane media for a fresh element when the photo changes', () => {
    const slots = stepOnce('split', (slide) => slide.querySelector('img'))

    expect(slots.some((slot) => slot.changed)).toBe(true)
    for (const slot of slots) if (slot.changed) expect(slot.remounted).toBe(true)
  })
})

describe('the hidden preload of the next photo', () => {
  it.each([
    'spotlight',
    'mosaic',
    'polaroid',
    'clothesline',
    'filmstrip',
    'collage',
    'split',
  ] as const)('is fed the slideshow next photo by the %s layout', (layout) => {
    const items = somePhotos(20)
    const next = items[15]
    const { container } = render(view(layout, items, slideshowAt(items, 3, 15)))

    const preloads = Array.from(container.querySelectorAll('img[aria-hidden="true"]'))
    expect(preloads.map((image) => image.getAttribute('src'))).toContain(next?.displayUrl)
  })
})
