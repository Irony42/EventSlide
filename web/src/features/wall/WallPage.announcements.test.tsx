import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/http'
import { fr } from '../../lib/i18n/fr'
import type { WallAnnouncementDto, WallResponse } from '../../lib/api/dto'
import {
  aWallAnnouncement,
  aWallGuestbookMessage,
  fakeApi,
  renderWithProviders,
} from '../../testing/renderWithProviders'
import { WallPage } from './WallPage'
import {
  ROUTE,
  PATH,
  theWall,
  aPopulatedWall,
  somePhotos,
  streamOpens,
  streamSignals,
  prefersReducedMotion,
  useWallPageEnvironment,
} from './testing/wallPageHarness'

/**
 * The wall and its scheduled announcements, fullscreen kind (spec 21, ring 5).
 *
 * Time is the test's: the layers are derived from the server's clock on every render, so a fake
 * clock that moves only through `advance` is the whole story, and a "projector" is a fake clock
 * `skewMs` away from the server's.
 */
describe('WallPage', () => {
  useWallPageEnvironment()

  describe('WallPage and the scheduled announcements (spec 21)', () => {
    /** The server's clock at the start of every test: an instant a few hours into an evening. */
    const SERVER_START = 1_790_000_000_000

    const advance = (ms: number) =>
      act(async () => {
        await vi.advanceTimersByTimeAsync(ms)
      })

    /** The wall as the server answers it, `serverNowMs` being the server's clock at that read. */
    const wallWith = (
      items: readonly WallAnnouncementDto[],
      overrides: Partial<WallResponse> = {},
    ): WallResponse =>
      aPopulatedWall({
        items: somePhotos(8),
        serverNowMs: SERVER_START,
        announcements: { items, nextReadAtMs: SERVER_START + 15 * 60_000 },
        ...overrides,
      })

    /**
     * The server, which reads its own clock at every answer: a screen's offset is measured against
     * it, so a fixed `serverNowMs` would be a server whose clock had stopped. `skewMs` is how far
     * ahead of it this machine runs. The last response repeats.
     */
    const serving = (skewMs: number, ...responses: readonly WallResponse[]) => {
      let call = -1
      return vi.fn(async (): Promise<WallResponse> => {
        call += 1
        const response = responses[Math.min(call, responses.length - 1)]
        if (response === undefined) throw new Error('serving needs a response')
        return { ...response, serverNowMs: Date.now() - skewMs }
      })
    }

    /** This machine's clock is `skewMs` ahead of the server's, and nothing has happened yet. */
    const open = async (
      wall: WallResponse,
      { skewMs = 0, route = ROUTE }: { skewMs?: number; route?: string } = {},
    ): Promise<ReturnType<typeof fakeApi>> => {
      vi.setSystemTime(SERVER_START + skewMs)
      const api = fakeApi({ wall: serving(skewMs, wall) })
      renderWithProviders(<WallPage />, { api, route, path: PATH })
      await advance(0)
      expect(screen.getAllByTestId('wall-slide').length).toBeGreaterThan(0)
      return api
    }

    const band = (): Element | null => document.querySelector('[data-wall-announcement-band]')
    const card = (): Element | null => document.querySelector('[data-wall-announcement-card]')

    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('shows the banner with the sentence and the time left during the countdown, and reserves the top', async () => {
      await open(wallWith([aWallAnnouncement(SERVER_START + 272_000)]))

      expect(band()).not.toBeNull()
      expect(band()).toHaveTextContent('Le gâteau arrive')
      expect(band()).toHaveTextContent(fr.wall.announcementIn('4:32'))
      expect(theWall().getAttribute('data-wall-chrome')).toContain('top')
      expect(card()).toBeNull()
    })

    it('counts down once a second and says the last ten seconds by the word', async () => {
      await open(wallWith([aWallAnnouncement(SERVER_START + 12_000)]))
      expect(band()).toHaveTextContent(fr.wall.announcementIn('0:12'))

      await advance(2_000)

      expect(band()).toHaveTextContent(fr.wall.announcementImminent('0:10'))
      expect(band()).not.toHaveTextContent(fr.wall.announcementIn('0:10'))
    })

    it('keeps the banner out of the accessibility tree, the card says it once', async () => {
      await open(wallWith([aWallAnnouncement(SERVER_START + 5_000)]))
      expect(band()?.getAttribute('aria-hidden')).toBe('true')
      expect(screen.queryByRole('status', { name: '' })).toBeNull()

      await advance(5_000)

      expect(band()).toBeNull()
      expect(card()).toHaveTextContent('Le gâteau arrive')
      const status = card()?.querySelector('[role="status"]')
      expect(status).toHaveTextContent(fr.wall.announcementSay('Le gâteau arrive'))
      expect(card()?.querySelector('p')?.getAttribute('aria-hidden')).toBe('true')
    })

    it('shows nothing, and reserves nothing, when the wall carries no announcement', async () => {
      await open(aPopulatedWall({ items: somePhotos(8), serverNowMs: SERVER_START }))

      expect(band()).toBeNull()
      expect(card()).toBeNull()
      expect(theWall().getAttribute('data-wall-chrome') ?? '').not.toContain('top')
    })

    it('shows nothing of an announcement before its countdown starts, then the banner on that second', async () => {
      await open(wallWith([aWallAnnouncement(SERVER_START + 400_000)]))
      expect(band()).toBeNull()

      await advance(99_999)
      expect(band()).toBeNull()

      await advance(1)
      expect(band()).not.toBeNull()
    })

    it('puts the card up at its second, takes it down when its time is out, and the wall goes on', async () => {
      await open(wallWith([aWallAnnouncement(SERVER_START + 60_000, { countdownSeconds: 0 })]))
      expect(card()).toBeNull()

      await advance(59_999)
      expect(card()).toBeNull()

      await advance(1)
      expect(card()).not.toBeNull()

      await advance(29_999)
      expect(card()).not.toBeNull()

      await advance(1)
      expect(card()).toBeNull()
      expect(screen.getAllByTestId('wall-slide').length).toBeGreaterThan(0)
    })

    it('starts the card on the same server second on two projectors whose clocks are five minutes apart', async () => {
      const startedAfter = async (skewMs: number): Promise<number> => {
        const wall = wallWith([aWallAnnouncement(SERVER_START + 90_000, { countdownSeconds: 60 })])
        // The machine's clock is `skewMs` off the server's: the response says what time it is there.
        vi.setSystemTime(SERVER_START + skewMs)
        const view = renderWithProviders(<WallPage />, {
          api: fakeApi({ wall: serving(skewMs, wall) }),
          route: ROUTE,
          path: PATH,
        })
        await advance(0)
        let elapsed = 0
        while (card() === null && elapsed < 120_000) {
          await advance(100)
          elapsed += 100
        }
        view.unmount()
        return elapsed
      }

      const onTime = await startedAfter(0)
      const fiveMinutesAhead = await startedAfter(5 * 60_000)
      const fiveMinutesBehind = await startedAfter(-5 * 60_000)

      expect(onTime).toBe(90_000)
      expect(fiveMinutesAhead).toBe(onTime)
      expect(fiveMinutesBehind).toBe(onTime)
    })

    it('shows the time that is left, not the whole duration, on a wall opened during the card', async () => {
      // 20 s into a 30 s card: ten seconds remain.
      await open(wallWith([aWallAnnouncement(SERVER_START - 20_000, { countdownSeconds: 0 })]))
      expect(card()).not.toBeNull()

      await advance(9_999)
      expect(card()).not.toBeNull()

      await advance(1)
      expect(card()).toBeNull()
    })

    it('shows the card although the wall is paused: a pause stops the photographs, not the time', async () => {
      await open(wallWith([aWallAnnouncement(SERVER_START + 10_000, { countdownSeconds: 0 })]))
      await act(async () => {
        fireEvent.keyDown(window, { key: ' ' })
      })
      expect(screen.getByText(fr.wall.paused)).toBeVisible()

      await advance(10_000)

      expect(card()).not.toBeNull()
    })

    it('gives the banner up to the challenge banner, which keeps the top centre', async () => {
      const challenge: Partial<WallResponse> = {
        challenge: {
          id: 'c1',
          prompt: 'un selfie avec votre voisin',
          startedAt: new Date(SERVER_START - 1_000).toISOString(),
          endsAt: new Date(SERVER_START + 3_600_000).toISOString(),
          state: 'running',
          answers: null,
        },
      }
      await open(wallWith([aWallAnnouncement(SERVER_START + 60_000)], challenge))

      expect(screen.getByText('un selfie avec votre voisin')).toBeVisible()
      expect(band()).toBeNull()
    })

    it('puts the card in front of the challenge banner, which goes on underneath', async () => {
      const challenge: Partial<WallResponse> = {
        challenge: {
          id: 'c1',
          prompt: 'un selfie avec votre voisin',
          startedAt: new Date(SERVER_START - 1_000).toISOString(),
          endsAt: new Date(SERVER_START + 3_600_000).toISOString(),
          state: 'running',
          answers: null,
        },
      }
      await open(
        wallWith([aWallAnnouncement(SERVER_START - 5_000, { countdownSeconds: 0 })], challenge),
      )

      expect(card()).not.toBeNull()
      expect(document.querySelector('[data-wall-challenge]')).not.toBeNull()
    })

    it('hides the souvenir counter while the banner is up, and brings it back after', async () => {
      await open(
        wallWith([aWallAnnouncement(SERVER_START + 5_000)], {
          souvenirCounter: true,
          souvenirCount: 12,
        }),
      )
      expect(screen.queryByText(fr.wall.souvenirCount(12))).toBeNull()

      await advance(5_000 + 30_000)

      expect(band()).toBeNull()
      expect(screen.getByText(fr.wall.souvenirCount(12))).toBeVisible()
    })

    describe('the slideshow underneath', () => {
      /** The photograph on screen after each of `count` steps of the server's eight-second interval. */
      const sequenceOf = async (count: number): Promise<(string | null)[]> => {
        const seen: (string | null)[] = []
        for (let step = 0; step < count; step += 1) {
          await advance(8_000)
          seen.push(screen.getAllByTestId('wall-slide')[0]?.getAttribute('data-photo-id') ?? null)
        }
        return seen
      }

      it('shows the same photographs, in the same order, with and without a card', async () => {
        const without = await (async () => {
          const view = renderWithProviders(<WallPage />, {
            api: fakeApi({
              wall: serving(0, aPopulatedWall({ items: somePhotos(6) })),
            }),
            route: ROUTE,
            path: PATH,
          })
          vi.setSystemTime(SERVER_START)
          await advance(0)
          const seen = await sequenceOf(10)
          view.unmount()
          return seen
        })()

        vi.setSystemTime(SERVER_START)
        renderWithProviders(<WallPage />, {
          api: fakeApi({
            wall: serving(
              0,
              wallWith([aWallAnnouncement(SERVER_START + 4_000, { countdownSeconds: 0 })], {
                items: somePhotos(6),
              }),
            ),
          }),
          route: ROUTE,
          path: PATH,
        })
        await advance(0)
        const withCard = await sequenceOf(10)

        expect(without.length).toBe(10)
        expect(withCard).toEqual(without)
      })

      it('does not remount the layouts, and leaves the invitation where it was, around the card', async () => {
        await open(wallWith([aWallAnnouncement(SERVER_START + 10_000, { countdownSeconds: 0 })]))
        const wall = theWall()
        const slide = screen.getAllByTestId('wall-slide')[0]
        const code = screen.getByText('H7K2QM')
        const placed = () => ({
          chrome: wall.getAttribute('data-wall-chrome'),
          corner: wall.getAttribute('data-wall-join-corner'),
          layout: wall.getAttribute('data-wall-layout'),
          codeParent: code.parentElement,
        })
        const before = placed()
        expect(card()).toBeNull()

        await advance(10_000)
        expect(card()).not.toBeNull()
        expect(theWall()).toBe(wall)
        expect(screen.getByText('H7K2QM')).toBe(code)
        expect(placed()).toEqual(before)

        await advance(30_000)
        expect(card()).toBeNull()
        expect(theWall()).toBe(wall)
        expect(screen.getAllByTestId('wall-slide')[0]).toBe(slide)
        expect(screen.getByText('H7K2QM')).toBe(code)
        expect(placed()).toEqual(before)
      })

      it('draws the card after the invitation, so that it covers it', async () => {
        await open(wallWith([aWallAnnouncement(SERVER_START - 1_000, { countdownSeconds: 0 })]))

        const code = screen.getByText('H7K2QM')
        const position = code.compareDocumentPosition(card() as Node)

        expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      })
    })

    describe('the guestbook cards', () => {
      const book = {
        everyNth: 1,
        messages: [aWallGuestbookMessage({ id: 'g1', text: 'Une soirée merveilleuse' })],
      }

      it('starts no guestbook card while an announcement counts down or shows, and goes back to them after', async () => {
        await open(
          wallWith([aWallAnnouncement(SERVER_START + 20_000, { countdownSeconds: 20 })], {
            guestbook: book,
          }),
        )
        // The banner is up for the first 20 s of the clock, the card for the next 30: the
        // slide clock changes photograph at 8, 16, ... 48 s, and each of those changes brings none.
        for (let change = 0; change < 6; change += 1) {
          await advance(8_000)
          expect(screen.queryByText('Une soirée merveilleuse')).toBeNull()
        }

        // 56 s: the announcement ended at 50 s, and the guestbook comes back with this change.
        await advance(8_000)
        expect(screen.getByText('Une soirée merveilleuse')).toBeVisible()
      })

      it('starts a guestbook card on the first change when no announcement is pending (the control)', async () => {
        await open(wallWith([], { guestbook: book }))

        await advance(8_000)

        expect(screen.getByText('Une soirée merveilleuse')).toBeVisible()
      })
    })

    it('goes on with the announcement it already read when the network goes away', async () => {
      vi.setSystemTime(SERVER_START)
      const wall = wallWith([aWallAnnouncement(SERVER_START + 60_000, { countdownSeconds: 0 })])
      const answers = serving(0, wall)
      let reads = 0
      const thenNetworkDown = vi.fn(async (): Promise<WallResponse> => {
        reads += 1
        if (reads > 1) throw ApiError.network()
        return answers()
      })
      renderWithProviders(<WallPage />, {
        api: fakeApi({ wall: thenNetworkDown }),
        route: ROUTE,
        path: PATH,
      })
      await advance(0)
      expect(card()).toBeNull()

      // Past the thirty-second read of a wall without a stream: it fails, and the card goes on.
      await advance(59_999)
      expect(card()).toBeNull()
      await advance(1)

      expect(card()).not.toBeNull()
    })

    it('reads again on an announcement.changed signal and shows what was scheduled', async () => {
      vi.setSystemTime(SERVER_START)
      const api = fakeApi({
        wall: serving(
          0,
          wallWith([]),
          wallWith([aWallAnnouncement(SERVER_START, { countdownSeconds: 0 })]),
        ),
      })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
      await advance(0)
      await streamOpens()
      expect(card()).toBeNull()

      await streamSignals('announcement.changed')
      await advance(300)

      expect(card()).not.toBeNull()
    })

    it('removes a deleted announcement from the screen on the next read', async () => {
      vi.setSystemTime(SERVER_START)
      const api = fakeApi({
        wall: serving(
          0,
          wallWith([aWallAnnouncement(SERVER_START, { countdownSeconds: 0 })]),
          aPopulatedWall({ items: somePhotos(8) }),
        ),
      })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
      await advance(0)
      await streamOpens()
      expect(card()).not.toBeNull()

      await streamSignals('announcement.changed')
      await advance(300)

      expect(card()).toBeNull()
    })

    it('has no entrance under prefers-reduced-motion', async () => {
      prefersReducedMotion()
      await open(wallWith([aWallAnnouncement(SERVER_START - 1_000, { countdownSeconds: 0 })]))

      expect(card()?.className).not.toContain('enters')
    })

    it('has the entrance otherwise', async () => {
      await open(wallWith([aWallAnnouncement(SERVER_START - 1_000, { countdownSeconds: 0 })]))

      expect(card()?.className).toContain('enters')
    })
  })
})
