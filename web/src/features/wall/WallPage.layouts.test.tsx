import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { WallLayout } from '../../lib/api/dto'
import { fakeApi, renderWithProviders } from '../../testing/renderWithProviders'
import { WallPage } from './WallPage'
import {
  ROUTE,
  PATH,
  theWall,
  aPopulatedWall,
  somePhotos,
  wallSequence,
  pendingWall,
  useWallPageEnvironment,
} from './testing/wallPageHarness'

describe('WallPage', () => {
  useWallPageEnvironment()

  it('cycles to the mosaic when the host presses L', async () => {
    const api = fakeApi({ wall: wallSequence(aPopulatedWall({ items: somePhotos(8) })) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
    await screen.findByTestId('wall-slide')

    await userEvent.keyboard('l')

    // Six slots, and no captions: a caption is unreadable at five metres, while a name
    // is short enough to survive the size.
    expect(screen.getAllByTestId('wall-slide')).toHaveLength(6)
    expect(screen.queryByText('Photo 0')).not.toBeInTheDocument()
    expect(screen.getAllByText('Léa')).toHaveLength(6)
  })

  /**
   * `?layout=` on the display URL: the `L` key for a projector nobody is standing at.
   *
   * A kiosk's autostart line is the only thing that touches that machine all evening,
   * so the layout a room is set up for has to be expressible there. It is a choice
   * belonging to one screen — the server is neither told about it nor asked for it.
   */
  it('starts on the layout the display URL asks for, with nobody there to press L', async () => {
    const api = fakeApi({ wall: wallSequence(aPopulatedWall({ items: somePhotos(8) })) })
    renderWithProviders(<WallPage />, { api, route: `${ROUTE}?layout=mosaic`, path: PATH })

    expect(await screen.findAllByTestId('wall-slide')).toHaveLength(6)
    // The wall asked for the playlist and nothing else: the layout never left the browser.
    expect(api.wall).toHaveBeenCalledWith('camille-et-sacha', expect.anything())
  })

  it.each([
    { what: 'a layout that does not exist', query: 'layout=neon' },
    { what: 'an empty value', query: 'layout=' },
    { what: 'a value that is not a layout name at all', query: 'layout=%7B%7D' },
  ])('keeps showing the wall’s own layout when the URL carries $what', async ({ query }) => {
    // The one screen in the product that must never go blank, running unattended for
    // eight hours. A typo in a kiosk config falls back to the layout the response
    // carries; it does not take the room's screen down or render nothing.
    const api = fakeApi({ wall: wallSequence(aPopulatedWall({ items: somePhotos(8) })) })
    renderWithProviders(<WallPage />, { api, route: `${ROUTE}?${query}`, path: PATH })
    await screen.findByTestId('wall-slide')

    expect(screen.getAllByTestId('wall-slide')).toHaveLength(1)
    expect(within(screen.getByTestId('wall-slide')).getByText('Photo 0')).toBeVisible()
  })

  it('cycles with L from wherever the URL put the wall', async () => {
    // The host who does walk up to a projector started on the mosaic must not have to
    // press `L` five times to get anywhere: the key continues from what is on screen.
    const api = fakeApi({ wall: wallSequence(aPopulatedWall({ items: somePhotos(8) })) })
    renderWithProviders(<WallPage />, { api, route: `${ROUTE}?layout=mosaic`, path: PATH })
    expect(await screen.findAllByTestId('wall-slide')).toHaveLength(6)

    await userEvent.keyboard('l')

    expect(theWall()).toHaveAttribute('data-wall-layout', 'polaroid')
  })

  /**
   * Which layout the room is actually looking at, named on the wall element.
   *
   * The layout is chosen in three places — a key, a URL, the wall response — and stored
   * in none of them, so without this attribute there is nothing outside React that can
   * answer the question. It is the question a second projector is compared on, and the
   * one a wall that quietly fell back to the spotlight answers wrongly: for four
   * baseline generations the visual suite photographed a spotlight while believing it
   * had a mosaic, and a tile count was what eventually caught it.
   */
  it('names the layout on the wall itself, so a screen can be checked from outside React', async () => {
    const api = fakeApi({ wall: wallSequence(aPopulatedWall({ items: somePhotos(8) })) })
    renderWithProviders(<WallPage />, { api, route: `${ROUTE}?layout=filmstrip`, path: PATH })
    await screen.findAllByTestId('wall-slide')

    expect(theWall()).toHaveAttribute('data-wall-layout', 'filmstrip')
  })

  it('walks through every built layout and comes back to where it started', async () => {
    const api = fakeApi({ wall: wallSequence(aPopulatedWall({ items: somePhotos(20) })) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
    await screen.findByTestId('wall-slide')

    const visited: (string | null)[] = [theWall().getAttribute('data-wall-layout')]
    for (let press = 0; press < 7; press += 1) {
      await userEvent.keyboard('l')
      visited.push(theWall().getAttribute('data-wall-layout'))
    }

    // The two layouts 2.0 shipped, then the four 2.3 added, then the clothesline — not
    // sorted by slot count, so that the first press still lands where every host's hand
    // expects it. What this protects is the wrap: the eighth press comes home rather than
    // stranding somebody on a layout they cannot get out of.
    expect(visited).toEqual([
      'spotlight',
      'mosaic',
      'polaroid',
      'filmstrip',
      'collage',
      'split',
      'clothesline',
      'spotlight',
    ])
  })

  it.each<WallLayout>(['polaroid', 'filmstrip', 'collage', 'split', 'clothesline'])(
    'renders %s itself rather than falling back to the layout nearest to it',
    async (layout) => {
      // Every name in the contract is now built. A layout that silently rendered its
      // neighbour would still show photographs, which is exactly why it went unnoticed
      // for four baseline generations when `?layout=` was dead.
      const api = fakeApi({ wall: wallSequence(aPopulatedWall({ items: somePhotos(20) })) })
      renderWithProviders(<WallPage />, { api, route: `${ROUTE}?layout=${layout}`, path: PATH })
      await screen.findAllByTestId('wall-slide')

      expect(theWall()).toHaveAttribute('data-wall-layout', layout)
    },
  )

  describe('the layout an ambiance suggests', () => {
    const themed = (ambiance: 'riviera' | 'guinguette') =>
      aPopulatedWall({
        items: somePhotos(8),
        theme: { accentHue: 305, fonts: 'sans', frame: 'soft', ambiance },
      })

    it('keeps the wall response’s layout for every ambiance, the default included', async () => {
      // Since 28/10 the Guinguette is the product's own look, so no ambiance forces a layout:
      // the clothesline is one `L` press or `?layout=clothesline` away.
      for (const ambiance of ['guinguette', 'riviera'] as const) {
        const api = fakeApi({ wall: wallSequence(themed(ambiance)) })
        const { unmount } = renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
        await screen.findAllByTestId('wall-slide')
        expect(theWall()).toHaveAttribute('data-wall-layout', 'spotlight')
        unmount()
      }
    })

    it('yields to a kiosk that names its layout', async () => {
      const api = fakeApi({ wall: wallSequence(themed('guinguette')) })
      renderWithProviders(<WallPage />, { api, route: `${ROUTE}?layout=mosaic`, path: PATH })
      await screen.findAllByTestId('wall-slide')

      expect(theWall()).toHaveAttribute('data-wall-layout', 'mosaic')
    })

    it('wraps L from the clothesline, last in the cycle, back to the spotlight', async () => {
      const api = fakeApi({ wall: wallSequence(themed('guinguette')) })
      renderWithProviders(<WallPage />, { api, route: `${ROUTE}?layout=clothesline`, path: PATH })
      await screen.findAllByTestId('wall-slide')

      await userEvent.keyboard('l')

      expect(theWall()).toHaveAttribute('data-wall-layout', 'spotlight')
    })
  })

  it('shows the layout the host chose while the first playlist was still on its way', async () => {
    const pending = pendingWall()
    const api = fakeApi({ wall: vi.fn(() => pending.promise) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })

    await userEvent.keyboard('l')
    await act(async () => {
      pending.arrives(aPopulatedWall({ items: somePhotos(8) }))
    })

    // The host sets the wall up for a cocktail hour while the server is still answering.
    // Losing that choice the moment the photos arrive would send them back to the
    // keyboard in front of the room.
    expect(await screen.findAllByTestId('wall-slide')).toHaveLength(6)
  })

  it('never confuses the zoom’s length with the slide’s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const api = fakeApi({
      wall: wallSequence(
        aPopulatedWall({
          items: somePhotos(3),
          slideIntervalMs: 8_000,
          kenBurnsDurationMs: 8_800,
        }),
      ),
    })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })

    const slide = await screen.findByTestId('wall-slide')

    // Both numbers come from one event setting in `src/domain/slideshow/`, where the
    // zoom is the interval plus the crossfade; the wall's job is to keep them apart.
    // Swapping them is what made 1.0's zoom outlive its slide and every photo jump.
    expect(slide.style.getPropertyValue('--wall-kenburns-duration')).toBe('8800ms')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000)
    })
    expect(within(screen.getByTestId('wall-slide')).getByText('Photo 1')).toBeVisible()
  })

  /* ---- Per-event theming (roadmap 2.2). ---- */
})
