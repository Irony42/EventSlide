import { act, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeApi, renderWithProviders } from '../../testing/renderWithProviders'
import { WallPage } from './WallPage'
import {
  ROUTE,
  PATH,
  theWall,
  aPopulatedWall,
  wallSequence,
  pendingWall,
  prefersReducedMotion,
  useWallPageEnvironment,
} from './testing/wallPageHarness'

describe('WallPage', () => {
  useWallPageEnvironment()

  describe('the event’s own look', () => {
    it('wears the accent as an angle, on the element that renders the photos', async () => {
      const api = fakeApi({
        wall: wallSequence(
          aPopulatedWall({
            theme: {
              accentHue: 345,
              fonts: 'sans',
              frame: 'soft',
              ambiance: 'guinguette',
            },
          }),
        ),
      })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })

      await screen.findByTestId('wall-slide')

      // An angle, not a colour: `tokens.css` is still the only file in the product that
      // declares one, and the wall only says which way round the wheel to go.
      expect(theWall().style.getPropertyValue('--accent-hue')).toBe('345')
      // And the marker the stylesheet re-derives `--accent` on. Without it the hue moves
      // and nothing changes, because a custom property referencing another is resolved
      // where it is declared.
      expect(theWall()).toHaveAttribute('data-event-accent', '345')
    })

    it('wears the font pairing and the frame style the host chose', async () => {
      const api = fakeApi({
        wall: wallSequence(
          aPopulatedWall({
            theme: {
              accentHue: 305,
              fonts: 'serif',
              frame: 'square',
              ambiance: 'guinguette',
            },
          }),
        ),
      })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })

      await screen.findByTestId('wall-slide')

      expect(theWall()).toHaveAttribute('data-event-fonts', 'serif')
      expect(theWall()).toHaveAttribute('data-event-frame', 'square')
    })

    it('renders an unthemed event exactly as it did before theming existed', async () => {
      // The assertion the committed visual baselines rest on. Not "the default values on
      // the element" — nothing on the element, so the DOM the suite photographs is the
      // DOM it photographed before this feature.
      const api = fakeApi({
        wall: wallSequence(
          aPopulatedWall({
            theme: {
              accentHue: 305,
              fonts: 'sans',
              frame: 'soft',
              ambiance: 'guinguette',
            },
          }),
        ),
      })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })

      await screen.findByTestId('wall-slide')

      expect(theWall().getAttribute('style')).toBeNull()
      expect(theWall()).not.toHaveAttribute('data-event-accent')
      expect(theWall()).not.toHaveAttribute('data-event-fonts')
      expect(theWall()).not.toHaveAttribute('data-event-frame')
    })

    it('carries no theme from a server build that does not send one', async () => {
      // A projector on an old bundle against a new server, or the reverse: the wall shows
      // the product's look rather than failing to render.
      const api = fakeApi({ wall: wallSequence(aPopulatedWall()) })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })

      await screen.findByTestId('wall-slide')

      expect(theWall().getAttribute('style')).toBeNull()
    })

    it('paints nothing in the product’s colours before the event’s own arrive', async () => {
      // Why the theme is a prop on this element rather than a `:root` write: there is no
      // frame between "the response landed" and "the theme applied" for a room to notice.
      // While the wall is still waiting, the only chrome on screen is the loading state,
      // which is `--text-primary` on `--surface-base` — neither of which a theme moves.
      const pending = pendingWall()
      const api = fakeApi({ wall: vi.fn(() => pending.promise) })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })

      expect(document.querySelector('[data-event-fonts]')).toBeNull()

      await act(async () => {
        pending.arrives(
          aPopulatedWall({
            theme: {
              accentHue: 345,
              fonts: 'serif',
              frame: 'soft',
              ambiance: 'guinguette',
            },
          }),
        )
      })

      // One render, one paint: the attribute and the photos it themes arrive together.
      expect(theWall().style.getPropertyValue('--accent-hue')).toBe('345')
      expect(await screen.findByTestId('wall-slide')).toBeVisible()
    })
  })

  /**
   * The budget reaching the screen — roadmap 11.3.
   *
   * `useFrameBudget.test.tsx` covers the loop and `budget.test.ts` covers the rule. What
   * neither can say is whether the verdict arrives anywhere a stylesheet can read it: the
   * rung is an attribute on the wall's own root, inherited by everything inside it, and a
   * hook returning the right number to a component that spreads it nowhere is a budget that
   * decides nothing.
   */
  describe('what it gives up when the machine cannot keep up', () => {
    let scheduled = new Map<number, FrameRequestCallback>()

    /**
     * `requestAnimationFrame` under the test's control, installed before the wall mounts.
     *
     * Before rather than during: the monitor's loop starts in the effect that runs on
     * mount, so a stub installed afterwards would hold an empty queue while the real
     * callback sat on jsdom's own 16 ms timer — which is how the first version of this
     * passed for a wall that never degraded.
     */
    beforeEach(() => {
      scheduled = new Map()
      let handle = 0
      vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
        handle += 1
        scheduled.set(handle, callback)
        return handle
      })
      vi.stubGlobal('cancelAnimationFrame', (id: number) => scheduled.delete(id))
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    /** Paint `count` frames, each `stepMs` after the last. */
    const paintFrames = (count: number, stepMs: number): void => {
      let now = 0
      act(() => {
        for (let frame = 0; frame < count; frame += 1) {
          now += stepMs
          const waiting = [...scheduled.values()]
          scheduled.clear()
          for (const callback of waiting) callback(now)
        }
      })
    }

    it('says nothing on a wall that is holding its frames', async () => {
      const api = fakeApi({ wall: wallSequence(aPopulatedWall()) })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
      await screen.findByTestId('wall-slide')

      // Absent, not `full`. The committed visual baselines are of a wall with no such
      // attribute on it, and the default has to be the one that changes nothing.
      expect(theWall()).not.toHaveAttribute('data-wall-budget')
    })

    it('holds the zoom still once two windows of frames have come in late', async () => {
      const api = fakeApi({ wall: wallSequence(aPopulatedWall()) })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
      await screen.findByTestId('wall-slide')

      // Sixteen frames a second, sustained, which is under the cadence anything in a room
      // reads as motion — a mini-PC that has run out, not a mini-PC that hiccuped.
      paintFrames(182, 60)

      expect(theWall()).toHaveAttribute('data-wall-budget', 'still')
    })

    it('and cuts instead of fading when that was not enough', async () => {
      const api = fakeApi({ wall: wallSequence(aPopulatedWall()) })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
      await screen.findByTestId('wall-slide')

      paintFrames(364, 60)

      expect(theWall()).toHaveAttribute('data-wall-budget', 'cut')
    })

    it('measures nothing for a room that asked for no motion, and marks nothing', async () => {
      // Both rungs below the room's floor are already spent for that viewer, so there is
      // nothing for a verdict to take — and an attribute here would change a committed
      // reduced-motion baseline for a reason that does not exist.
      prefersReducedMotion()
      const api = fakeApi({ wall: wallSequence(aPopulatedWall()) })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
      await screen.findByTestId('wall-slide')

      paintFrames(364, 60)

      expect(theWall()).not.toHaveAttribute('data-wall-budget')
    })
  })
})
