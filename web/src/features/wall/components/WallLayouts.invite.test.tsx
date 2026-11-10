import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { WallItemDto, WallLayout } from '../../../lib/api/dto'
import { aWallItem } from '../../../testing/renderWithProviders'
import { classesOf, cls } from '../../../testing/classesOf'
import { fr } from '../../../lib/i18n/fr'
import type { Slideshow } from '../hooks/useSlideshow'
import { joinSlotOf, type JoinSlot } from '../joinSlot'
import { WallLayouts } from './WallLayouts'
import type { LayoutInvite } from './layouts/layoutProps'
import styles from './WallLayouts.module.css'

/**
 * The invitation in each layout's own flow (the QR integration pass): where each layout puts it,
 * what it gives up for it, and what it must never do to the code — move it or put a photo over it.
 */
const JOIN = { code: 'H7K2QM', url: 'https://photos.example.com/join/H7K2QM' }

const somePhotos = (count: number): readonly WallItemDto[] =>
  Array.from({ length: count }, (_unused, at) =>
    aWallItem({ id: `photo-${at}`, caption: `Photo ${at}`, authorName: 'Léa' }),
  )

/** The history the real hook keeps at the start of the list: no slide shown before this one. */
const aSlideshow = (items: readonly WallItemDto[], generation = 0): Slideshow => ({
  current: items[0] ?? null,
  next: items[1] ?? null,
  previous: null,
  upcoming: items.slice(1, 7),
  recent: Array.from({ length: 12 }, (_unused, back) => ({
    item: back === 0 ? (items[0] ?? null) : null,
    fresh: false,
  })),
  index: 0,
  intervalMs: 8_000,
  generation,
  automaticChanges: 0,
  fresh: false,
  paused: false,
  pause: () => undefined,
  resume: () => undefined,
  advance: () => undefined,
})

const renderWith = (
  layout: WallLayout,
  {
    items = somePhotos(12),
    invite = { join: JOIN, onDismiss: vi.fn() },
    generation = 0,
    tilt = true,
  }: {
    items?: readonly WallItemDto[]
    invite?: LayoutInvite | null
    generation?: number
    tilt?: boolean
  } = {},
) =>
  render(
    <WallLayouts
      layout={layout}
      items={items}
      slideshow={aSlideshow(items, generation)}
      kenBurnsDurationMs={8_800}
      transitionMs={null}
      tilt={tilt}
      invite={invite}
    />,
  )

const INTEGRATED = [
  ['mosaic', 'tile'],
  ['collage', 'cell'],
  ['polaroid', 'print'],
  ['clothesline', 'tag'],
  ['filmstrip', 'band'],
  ['split', 'seam'],
] as const satisfies readonly (readonly [WallLayout, JoinSlot])[]

describe('the invitation inside the layouts', () => {
  it.each(INTEGRATED)('the %s draws it once, as its %s, with the code', (layout, slot) => {
    renderWith(layout)

    const invite = screen.getByTestId('wall-invite')
    expect(invite).toHaveAttribute('data-slot', slot)
    expect(joinSlotOf(layout)).toBe(slot)
    expect(within(invite).getByTitle(fr.wall.qrTitle)).toBeInTheDocument()
    expect(within(invite).getByText(JOIN.code)).toBeVisible()
    // Never one of the photographs: no slide, so nothing counts it or rotates it.
    expect(invite.closest('[data-testid="wall-slide"]')).toBeNull()
  })

  it.each([...INTEGRATED.map(([layout]) => layout), 'spotlight'] as const)(
    'the %s sets nothing aside when there is no invitation to draw',
    (layout) => {
      renderWith(layout, { invite: null })

      expect(screen.queryByTestId('wall-invite')).not.toBeInTheDocument()
    },
  )

  it('leaves the spotlight’s invitation to the corner the page draws', () => {
    renderWith('spotlight')

    expect(screen.queryByTestId('wall-invite')).not.toBeInTheDocument()
  })

  it.each(INTEGRATED)('the %s hands the close button to the host', async (layout) => {
    const onDismiss = vi.fn()
    renderWith(layout, { invite: { join: JOIN, onDismiss } })

    await userEvent.click(screen.getByRole('button', { name: fr.wall.dismissJoinCard }))

    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('gives the mosaic’s last cell to the invitation: five photographs, six without it', () => {
    const { unmount } = renderWith('mosaic')

    expect(screen.getAllByTestId('wall-slide')).toHaveLength(5)
    expect(classesOf(screen.getByTestId('wall-invite'))).toContain(cls(styles, 'slot5'))
    unmount()

    renderWith('mosaic', { invite: null })
    expect(screen.getAllByTestId('wall-slide')).toHaveLength(6)
  })

  it('keeps the whole last column of a full collage for the invitation', () => {
    renderWith('collage', { generation: 40 })

    expect(screen.getAllByTestId('wall-slide')).toHaveLength(9)
    expect(classesOf(screen.getByTestId('wall-invite'))).toContain(cls(styles, 'collageInvite'))
  })

  it('shows the collage’s invitation from its first photograph on', () => {
    renderWith('collage', { generation: 0 })

    expect(screen.getAllByTestId('wall-slide')).toHaveLength(1)
    expect(screen.getByTestId('wall-invite')).toBeInTheDocument()
  })

  it('adds the invitation print to the pile rather than replacing a photograph', () => {
    const { container } = renderWith('polaroid')

    expect(screen.getAllByTestId('wall-slide')).toHaveLength(3)
    expect(container.querySelector('[data-invite="true"]')).toHaveClass(cls(styles, 'polaroid'))
  })

  it('puts the invitation print in the last column even beside a lone photograph', () => {
    renderWith('polaroid', { items: somePhotos(1) })

    expect(screen.getAllByTestId('wall-slide')).toHaveLength(1)
    expect(classesOf(screen.getByTestId('wall-invite').parentElement)).toContain(
      cls(styles, 'polaroidInvite'),
    )
  })

  it.each([
    [true, '-1.5deg'],
    [false, '0deg'],
  ])('leans the invitation print only as the host’s switch allows (tilt %s)', (tilt, angle) => {
    renderWith('polaroid', { tilt })

    const holder = screen.getByTestId('wall-invite').parentElement
    expect(holder?.style.getPropertyValue('--wall-tilt')).toBe(angle)
  })

  it('threads the tag on the clothesline without making it a print that sways', () => {
    renderWith('clothesline')

    const holder = screen.getByTestId('wall-invite').parentElement
    expect(classesOf(holder)).toContain(cls(styles, 'tagHolder'))
    expect(classesOf(holder)).not.toContain(cls(styles, 'hung'))
    expect(classesOf(holder?.parentElement)).toContain(cls(styles, 'line'))
  })

  it('puts the filmstrip’s ticket outside the track that drifts', () => {
    const { container } = renderWith('filmstrip')

    const track = container.querySelector(`.${cls(styles, 'track')}`)
    expect(track).not.toBeNull()
    expect(track?.contains(screen.getByTestId('wall-invite'))).toBe(false)
  })

  it('sets the split’s medallion between the two panes', () => {
    const { container } = renderWith('split')

    const stage = container.querySelector(`.${cls(styles, 'split')}`)
    const children = [...(stage?.children ?? [])].filter(
      (child) => child.tagName === 'FIGURE' || child.tagName === 'SECTION',
    )
    expect(children.map((child) => child.getAttribute('data-testid'))).toEqual([
      'wall-slide',
      'wall-invite',
      'wall-slide',
    ])
    expect(stage).toHaveAttribute('data-invite', 'true')
  })

  it('still draws the split’s medallion beside a single pane', () => {
    renderWith('split', { items: somePhotos(1) })

    expect(screen.getAllByTestId('wall-slide')).toHaveLength(1)
    expect(screen.getByTestId('wall-invite')).toBeInTheDocument()
  })
})
