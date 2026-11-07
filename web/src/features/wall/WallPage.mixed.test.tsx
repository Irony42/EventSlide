import { act, fireEvent, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fr } from '../../lib/i18n/fr'
import type { WallResponse } from '../../lib/api/dto'
import { aWallMission, fakeApi, renderWithProviders } from '../../testing/renderWithProviders'
import { WallPage } from './WallPage'
import {
  ROUTE,
  PATH,
  theWall,
  aPopulatedWall,
  somePhotos,
  wallSequence,
  prefersReducedMotion,
  useWallPageEnvironment,
} from './testing/wallPageHarness'

describe('WallPage', () => {
  useWallPageEnvironment()

  describe('WallPage, the mixed wall across many boundaries', () => {
    const SERVER_NOW = 1_790_000_000_000

    it('changes phase at every boundary, even when each one is reported with the same time left', async () => {
      // Equal phases, and a clock that moves in whole phases: every render lands exactly on a
      // boundary, so the wall half and the slideshow half both have 300 ms left. The boundary
      // timer used to be re-armed only when that figure changed, so the second boundary was
      // never watched and the room stayed on one phase until something else re-rendered.
      vi.useFakeTimers()
      const wall = aPopulatedWall({
        items: somePhotos(8),
        serverNowMs: SERVER_NOW,
        mixed: { wallMs: 180_000, slideshowMs: 60_000, layout: 'mosaic', anchorMs: SERVER_NOW },
      })
      renderWithProviders(<WallPage />, {
        api: fakeApi({ wall: wallSequence(wall) }),
        route: `${ROUTE}?e2e_phase_ms=300&e2e_transition=0`,
        path: PATH,
      })
      const advance = (ms: number) =>
        act(async () => {
          await vi.advanceTimersByTimeAsync(ms)
        })
      await advance(0)
      const phaseOf = (): string | null => theWall().getAttribute('data-wall-phase')
      expect(phaseOf()).toBe('wall')

      const seen: (string | null)[] = []
      for (let boundary = 0; boundary < 6; boundary += 1) {
        await advance(300)
        seen.push(phaseOf())
      }

      expect(seen).toEqual(['slideshow', 'wall', 'slideshow', 'wall', 'slideshow', 'wall'])
    })
  })

  describe('WallPage, the mixed wall (spec 09)', () => {
    /** Both phases last 300 ms on this screen; the anchor is the server's, `startsAgoMs` before its now. */
    const PHASES = 'e2e_phase_ms=300&e2e_transition=0'
    const SERVER_NOW = 1_790_000_000_000
    const mixedWall = (startsAgoMs = 0, overrides: Partial<WallResponse> = {}): WallResponse =>
      aPopulatedWall({
        items: somePhotos(8),
        serverNowMs: SERVER_NOW,
        mixed: {
          wallMs: 180_000,
          slideshowMs: 60_000,
          layout: 'mosaic',
          anchorMs: SERVER_NOW - startsAgoMs,
        },
        ...overrides,
      })
    /**
     * Both clocks are the test's: the phase is read off `Date.now()` and flips on a `setTimeout`,
     * so with real time (or `shouldAdvanceTime`) a slow runner could carry the screen past a
     * 300 ms boundary between `open` and the first assertion, and "the wall half" was
     * "the slideshow half" by then. Time moves only through `advance`.
     */
    beforeEach(() => vi.useFakeTimers())
    const advance = (ms: number) =>
      act(async () => {
        await vi.advanceTimersByTimeAsync(ms)
      })
    const press = (key: string) =>
      act(async () => {
        fireEvent.keyDown(window, { key })
      })
    const phaseOf = (): string | null => theWall().getAttribute('data-wall-phase')
    const open = async (wall: WallResponse, query = PHASES): Promise<void> => {
      renderWithProviders(<WallPage />, {
        api: fakeApi({ wall: wallSequence(wall) }),
        route: `${ROUTE}?${query}`,
        path: PATH,
      })
      await advance(0)
      expect(screen.getAllByTestId('wall-slide').length).toBeGreaterThan(0)
    }
    const untilPhase = async (phase: string): Promise<void> => {
      // 47 ms is not a divisor of the 300 ms phases, on purpose: the page re-arms its boundary
      // timer only when the time left changes, and a step that lands every render on a multiple of
      // the phase makes two consecutive phases report the same time left.
      for (let step = 0; step < 60 && phaseOf() !== phase; step += 1) await advance(47)
      expect(phaseOf()).toBe(phase)
    }

    it('tells in the shortcuts notice that L leaves the alternation, only while the mode is on', async () => {
      await open(mixedWall())
      await press('?')
      expect(screen.getByRole('dialog')).toHaveTextContent(fr.wall.mixedHint)
    })

    it('keeps the alternation out of the shortcuts notice while the mode is off', async () => {
      await open(aPopulatedWall({ items: somePhotos(8) }))
      await press('?')
      expect(screen.getByRole('dialog')).not.toHaveTextContent(fr.wall.mixedHint)
    })

    it('says nothing of phases, and renders as before, while the mode is off', async () => {
      await open(aPopulatedWall({ items: somePhotos(8) }))

      expect(phaseOf()).toBeNull()
      expect(theWall()).toHaveAttribute('data-wall-layout', 'spotlight')
      expect(document.querySelector('[data-fading]')).toBeNull()
    })

    it('starts on the event layout (the overview by default), then shows one large photo', async () => {
      await open(mixedWall())

      expect(phaseOf()).toBe('wall')
      expect(theWall()).toHaveAttribute('data-wall-layout', 'mosaic')

      await untilPhase('slideshow')
      expect(theWall()).toHaveAttribute('data-wall-layout', 'spotlight')
      expect(screen.getAllByTestId('wall-slide')).toHaveLength(1)

      await untilPhase('wall')
      expect(theWall()).toHaveAttribute('data-wall-layout', 'mosaic')
    })

    it('reads the phase off the server time, whatever this machine thinks the date is', async () => {
      vi.spyOn(Date, 'now').mockReturnValue(0)
      // 400 ms into a 300 + 300 cycle: the slideshow half.
      await open(mixedWall(400))

      expect(phaseOf()).toBe('slideshow')
    })

    it('leaves the alternation on a screen that names its layout: the L key', async () => {
      await open(mixedWall())

      await press('l')

      expect(phaseOf()).toBeNull()
      const named = theWall().getAttribute('data-wall-layout')
      await advance(700)
      expect(theWall()).toHaveAttribute('data-wall-layout', named)
    })

    it('leaves the alternation on a screen that names its layout: ?layout=', async () => {
      await open(mixedWall(), `${PHASES}&layout=polaroid`)

      expect(phaseOf()).toBeNull()
      await advance(700)
      expect(theWall()).toHaveAttribute('data-wall-layout', 'polaroid')
    })

    it('does not move the playlist at a change of phase: the same photograph stays under the cursor', async () => {
      await open(mixedWall(400))
      expect(phaseOf()).toBe('slideshow')
      expect(within(screen.getByTestId('wall-slide')).getByText('Photo 0')).toBeVisible()

      await untilPhase('wall')
      await untilPhase('slideshow')

      expect(within(screen.getByTestId('wall-slide')).getByText('Photo 0')).toBeVisible()
    })

    it('keeps the invitation and the missions on screen in both phases', async () => {
      await open(mixedWall(0, { missions: [aWallMission()] }))
      const present = () => {
        expect(screen.getByTitle(fr.wall.qrTitle)).toBeInTheDocument()
        expect(screen.getByText('un selfie avec les mariés')).toBeVisible()
      }

      present()
      await untilPhase('slideshow')
      present()
    })

    it('freezes the phase while paused, and catches up on resume', async () => {
      await open(mixedWall())
      await press(' ')

      await advance(400)
      // Something re-renders the page while it is paused (here a tab coming back to the front):
      // the boundary has gone by, and the room still sees the phase it froze on.
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'))
      })
      expect(phaseOf()).toBe('wall')

      await press(' ')
      // 800 ms into a 600 ms cycle that began at the anchor: 200 ms in, the wall half again.
      await advance(200)
      expect(phaseOf()).not.toBeNull()
    })

    it('goes dark between two phases, and never mounts two layouts at once', async () => {
      const seen = { fading: false, layouts: 0 }
      const watch = new MutationObserver(() => {
        if (document.querySelector('[data-fading="true"]') !== null) seen.fading = true
        seen.layouts = Math.max(
          seen.layouts,
          document.querySelectorAll('[data-wall-layout] [data-testid="wall-slide"]').length,
        )
      })
      watch.observe(document.body, { subtree: true, attributes: true, childList: true })

      await open(mixedWall(), 'e2e_phase_ms=300&e2e_transition=200')
      await untilPhase('slideshow')
      watch.disconnect()

      expect(seen.fading).toBe(true)
      // The overview has six slots; the single photograph never sits beside them.
      expect(seen.layouts).toBeLessThanOrEqual(6)
    })

    it('cuts instead of fading when the viewer asked for no motion', async () => {
      prefersReducedMotion()
      let faded = false
      const watch = new MutationObserver(() => {
        if (document.querySelector('[data-fading="true"]') !== null) faded = true
      })
      watch.observe(document.body, { subtree: true, attributes: true, childList: true })

      await open(mixedWall(), 'e2e_phase_ms=300&e2e_transition=200')
      await untilPhase('slideshow')
      watch.disconnect()

      expect(faded).toBe(false)
    })
  })
})
