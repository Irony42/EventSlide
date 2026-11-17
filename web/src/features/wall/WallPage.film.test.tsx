import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { WallResponse, WallRevealDto } from '../../lib/api/dto'
import {
  aWallClip,
  aWallItem,
  aWallResponse,
  fakeApi,
  renderWithProviders,
} from '../../testing/renderWithProviders'
import { WallPage } from './WallPage'
import { PATH, ROUTE, useWallPageEnvironment, wallSequence } from './testing/wallPageHarness'

/**
 * The film look on the projector (spec 23): a class on the image the room looks at, set from the
 * server's word (`reveal.film`), never on the caption and never on an evening without the mode.
 */
const SERVER_NOW = 1_800_000_000_000

const revealBlock = (overrides: Partial<WallRevealDto> = {}): WallRevealDto => ({
  enabled: true,
  revealed: true,
  atMs: SERVER_NOW - 60_000,
  serverNowMs: SERVER_NOW,
  film: true,
  readyCount: null,
  ...overrides,
})

const wallOf = (overrides: Partial<WallResponse> = {}): WallResponse =>
  aWallResponse({
    items: [aWallItem({ caption: 'Les confettis', authorName: 'Léa' })],
    serverNowMs: SERVER_NOW,
    reveal: revealBlock(),
    ...overrides,
  })

const show = (wall: WallResponse) =>
  renderWithProviders(<WallPage />, {
    api: fakeApi({ wall: wallSequence(wall) }),
    route: ROUTE,
    path: PATH,
  })

describe('the wall with the film look (spec 23)', () => {
  useWallPageEnvironment()

  it('puts the look on the photograph the room looks at', async () => {
    show(wallOf())

    const slide = await screen.findByTestId('wall-slide')
    const image = slide.querySelector('img')
    expect(image).not.toBeNull()
    expect(image).toHaveClass('filmLook')
  })

  it('never puts it on the caption, the author or the figure around them', async () => {
    show(wallOf())

    const slide = await screen.findByTestId('wall-slide')
    const caption = slide.querySelector('figcaption')
    expect(caption).not.toBeNull()
    expect(caption).not.toHaveClass('filmLook')
    expect(slide).not.toHaveClass('filmLook')
    // The only element of the slide that wears it is the image.
    expect([...slide.querySelectorAll('.filmLook')].map((element) => element.tagName)).toEqual([
      'IMG',
    ])
  })

  it('puts no class at all on an evening without the film look', async () => {
    show(wallOf({ reveal: revealBlock({ film: false }) }))

    const slide = await screen.findByTestId('wall-slide')
    expect(slide.querySelector('.filmLook')).toBeNull()
  })

  it('puts none on a wall whose server predates the reveal block', async () => {
    const { reveal: _absent, ...older } = wallOf()
    show(older)

    const slide = await screen.findByTestId('wall-slide')
    expect(slide.querySelector('.filmLook')).toBeNull()
  })

  it('wears the light version on the wall, a class of the wall as well as the shared one', async () => {
    show(wallOf())

    const image = (await screen.findByTestId('wall-slide')).querySelector('img')
    // Two classes on purpose: `filmLook` is the look, the module's own class is its measured light
    // recipe for the projector (WallMedia.module.css).
    expect(
      [...(image?.classList ?? [])].some((name) => name !== 'filmLook' && /film/.test(name)),
    ).toBe(true)
  })

  it('draws a clip with it too: the room sees the same evening whatever the media is', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
    show(wallOf({ items: [aWallClip({ id: 'clip-1' })], layout: 'spotlight' }))

    const slide = await screen.findByTestId('wall-slide')
    const media = slide.querySelector('video, img')
    expect(media).toHaveClass('filmLook')
  })
})
