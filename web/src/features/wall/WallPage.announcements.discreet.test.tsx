import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  aPopulatedWall,
  somePhotos,
  streamOpens,
  streamSignals,
  prefersReducedMotion,
  useWallPageEnvironment,
} from './testing/wallPageHarness'

/**
 * The wall and its scheduled announcements, discreet kind: the pill (spec 21, ring 5).
 *
 * Same footing as `WallPage.announcements.test.tsx`: the layers are derived from the server's
 * clock, so a fake clock that moves only through `advance` is the whole story.
 */
describe('WallPage', () => {
  useWallPageEnvironment()

  describe('WallPage and the discreet announcements (spec 21)', () => {
    const SERVER_START = 1_790_000_000_000

    const advance = (ms: number) =>
      act(async () => {
        await vi.advanceTimersByTimeAsync(ms)
      })

    /** A discreet announcement that starts `startsInMs` from the server's now and stays `minutes`. */
    const discreet = (
      startsInMs: number,
      minutes: number,
      overrides: Partial<WallAnnouncementDto> = {},
    ): WallAnnouncementDto =>
      aWallAnnouncement(SERVER_START + startsInMs, {
        id: 'discreet-1',
        text: 'Le buffet est ouvert',
        kind: 'discreet',
        countdownSeconds: 0,
        durationSeconds: minutes * 60,
        ...overrides,
      })

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

    const serving = (...responses: readonly WallResponse[]) => {
      let call = -1
      return vi.fn(async (): Promise<WallResponse> => {
        call += 1
        const response = responses[Math.min(call, responses.length - 1)]
        if (response === undefined) throw new Error('serving needs a response')
        return { ...response, serverNowMs: Date.now() }
      })
    }

    const open = async (...walls: readonly WallResponse[]): Promise<void> => {
      vi.setSystemTime(SERVER_START)
      renderWithProviders(<WallPage />, {
        api: fakeApi({ wall: serving(...walls) }),
        route: ROUTE,
        path: PATH,
      })
      await advance(0)
      expect(screen.getAllByTestId('wall-slide').length).toBeGreaterThan(0)
    }

    const pill = (): Element | null => document.querySelector('[data-wall-announcement-pill]')
    const card = (): Element | null => document.querySelector('[data-wall-announcement-card]')
    const band = (): Element | null => document.querySelector('[data-wall-announcement-band]')
    const column = (): Element | null => document.querySelector('[data-wall-top-centre]')
    const follows = (earlier: Element, later: Element): boolean =>
      Boolean(earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING)

    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('mounts the pill while a discreet announcement shows, with no countdown banner before it', async () => {
      await open(wallWith([discreet(60_000, 15)]))
      expect(pill()).toBeNull()
      expect(band()).toBeNull()

      await advance(59_999)
      expect(pill()).toBeNull()
      expect(band()).toBeNull()

      await advance(1)
      expect(pill()).toHaveTextContent('Le buffet est ouvert')
      expect(pill()).toHaveTextContent(fr.wall.announcementMinutesLeft(15))
      expect(band()).toBeNull()
      expect(card()).toBeNull()
    })

    it('takes the pill away at the end of its time, with no exit animation and no extension', async () => {
      await open(wallWith([discreet(0, 5)]))
      expect(pill()).not.toBeNull()

      await advance(299_999)
      expect(pill()).not.toBeNull()

      await advance(1)
      expect(pill()).toBeNull()
      expect(column()).toBeNull()
    })

    it('counts the minutes down on the wall, and says the last one in words', async () => {
      await open(wallWith([discreet(0, 5)]))
      expect(pill()).toHaveTextContent(fr.wall.announcementMinutesLeft(5))

      await advance(60_000)
      expect(pill()).toHaveTextContent(fr.wall.announcementMinutesLeft(4))

      await advance(3 * 60_000)
      expect(pill()).toHaveTextContent(fr.wall.announcementLastMinute)
    })

    it('shows the time left, not the whole duration, on a wall opened during it', async () => {
      await open(wallWith([discreet(-10 * 60_000, 15)]))

      expect(pill()).toHaveTextContent(fr.wall.announcementMinutesLeft(5))
    })

    it('shows the pill although the wall is paused: a pause stops the photographs, not the time', async () => {
      await open(wallWith([discreet(10_000, 15)]))
      await act(async () => {
        fireEvent.keyDown(window, { key: ' ' })
      })
      expect(screen.getByText(fr.wall.paused)).toBeVisible()

      await advance(10_000)

      expect(pill()).not.toBeNull()
    })

    it('shows nothing, and no column, when the wall carries no discreet announcement', async () => {
      await open(wallWith([]))

      expect(pill()).toBeNull()
      expect(column()).toBeNull()
    })

    describe('the slideshow underneath', () => {
      const sequenceOf = async (count: number): Promise<(string | null)[]> => {
        const seen: (string | null)[] = []
        for (let step = 0; step < count; step += 1) {
          await advance(8_000)
          seen.push(screen.getAllByTestId('wall-slide')[0]?.getAttribute('data-photo-id') ?? null)
        }
        return seen
      }

      it('does not hold the slideshow: the same photographs in the same order, with and without a pill', async () => {
        vi.setSystemTime(SERVER_START)
        const plain = renderWithProviders(<WallPage />, {
          api: fakeApi({ wall: serving(aPopulatedWall({ items: somePhotos(6) })) }),
          route: ROUTE,
          path: PATH,
        })
        await advance(0)
        const without = await sequenceOf(10)
        plain.unmount()

        vi.setSystemTime(SERVER_START)
        renderWithProviders(<WallPage />, {
          api: fakeApi({
            wall: serving(wallWith([discreet(4_000, 30)], { items: somePhotos(6) })),
          }),
          route: ROUTE,
          path: PATH,
        })
        await advance(0)
        const withPill = await sequenceOf(10)

        expect(without.length).toBe(10)
        expect(withPill).toEqual(without)
        expect(pill()).not.toBeNull()
      })

      it('does not remount the layouts or move the invitation when the pill comes and goes', async () => {
        await open(wallWith([discreet(10_000, 5)]))
        const wall = document.querySelector('[data-wall-layout]')
        const slide = screen.getAllByTestId('wall-slide')[0]
        const code = screen.getByText('H7K2QM')

        await advance(10_000)
        expect(pill()).not.toBeNull()
        expect(document.querySelector('[data-wall-layout]')).toBe(wall)
        expect(screen.getByText('H7K2QM')).toBe(code)

        await advance(300_000)
        expect(pill()).toBeNull()
        expect(document.querySelector('[data-wall-layout]')).toBe(wall)
        expect(screen.getAllByTestId('wall-slide')[0]).toBe(slide)
      })
    })

    describe('the layers', () => {
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

      it('stacks the pill under the challenge banner without hiding it', async () => {
        await open(wallWith([discreet(0, 15)], challenge))

        const banner = document.querySelector('[data-wall-challenge]')
        expect(banner).not.toBeNull()
        expect(screen.getByText('un selfie avec votre voisin')).toBeVisible()
        expect(pill()).not.toBeNull()
        expect(column()?.contains(banner)).toBe(true)
        expect(column()?.contains(pill())).toBe(true)
        expect(follows(banner as Element, pill() as Element)).toBe(true)
      })

      it('stacks the pill under the countdown banner of a fullscreen announcement without hiding it', async () => {
        const upcoming = aWallAnnouncement(SERVER_START + 120_000, { id: 'full', text: 'Gâteau' })
        await open(wallWith([discreet(0, 15), upcoming]))

        expect(band()).not.toBeNull()
        expect(pill()).not.toBeNull()
        expect(column()?.contains(band())).toBe(true)
        expect(follows(band() as Element, pill() as Element)).toBe(true)
      })

      it('stacks the pill under the souvenir counter without hiding it', async () => {
        await open(wallWith([discreet(0, 15)], { souvenirCounter: true, souvenirCount: 12 }))

        const counter = screen.getByText(fr.wall.souvenirCount(12))
        expect(counter).toBeVisible()
        expect(pill()).not.toBeNull()
        expect(follows(counter, pill() as Element)).toBe(true)
      })

      it('puts the fullscreen card in front of the pill, which goes on underneath with the time really left', async () => {
        const full = aWallAnnouncement(SERVER_START + 60_000, {
          id: 'full',
          text: 'Le gâteau',
          countdownSeconds: 0,
          durationSeconds: 30,
        })
        await open(wallWith([discreet(0, 5), full]))
        const before = pill()
        expect(pill()).toHaveTextContent(fr.wall.announcementMinutesLeft(5))

        await advance(60_000)
        // Covered: the card is drawn after the pill, and the pill is still mounted under it.
        expect(card()).not.toBeNull()
        expect(follows(pill() as Element, card() as Element)).toBe(true)
        expect(pill()).toBe(before)

        await advance(30_000)
        // The card is over; 90 s of the five minutes went by, and the pill says what is left.
        expect(card()).toBeNull()
        expect(pill()).toBe(before)
        expect(pill()).toHaveTextContent(fr.wall.announcementMinutesLeft(4))

        // Not extended: it ends at its own time.
        await advance(209_999)
        expect(pill()).not.toBeNull()
        await advance(1)
        expect(pill()).toBeNull()
      })

      it('lets a guestbook card cover the pill, which a pill does not hold back', async () => {
        const book = {
          everyNth: 1,
          messages: [aWallGuestbookMessage({ id: 'g1', text: 'Une soirée merveilleuse' })],
        }
        await open(wallWith([discreet(0, 30)], { guestbook: book }))
        expect(pill()).not.toBeNull()

        // The first change of photograph brings the card: a discreet announcement does not hold it.
        await advance(8_000)

        const message = screen.getByText('Une soirée merveilleuse')
        expect(message).toBeVisible()
        expect(follows(pill() as Element, message)).toBe(true)
      })

      it('lets a guestbook card start while a discreet announcement shows, as without it', async () => {
        const book = {
          everyNth: 1,
          messages: [aWallGuestbookMessage({ id: 'g1', text: 'Une soirée merveilleuse' })],
        }
        await open(wallWith([discreet(-60_000, 30)], { guestbook: book }))

        await advance(8_000)

        expect(screen.getByText('Une soirée merveilleuse')).toBeVisible()
      })
    })

    it('changes the text of a pill that is showing in place, on the next read', async () => {
      vi.setSystemTime(SERVER_START)
      renderWithProviders(<WallPage />, {
        api: fakeApi({
          wall: serving(
            wallWith([discreet(0, 15)]),
            wallWith([discreet(0, 15, { text: 'Le buffet ferme à minuit' })]),
          ),
        }),
        route: ROUTE,
        path: PATH,
      })
      await advance(0)
      await streamOpens()
      const before = pill()
      expect(before).toHaveTextContent('Le buffet est ouvert')

      await streamSignals('announcement.changed')
      await advance(300)

      expect(pill()).toBe(before)
      expect(pill()).toHaveTextContent('Le buffet ferme à minuit')
    })

    it('has no entrance under prefers-reduced-motion, and has it otherwise', async () => {
      await open(wallWith([discreet(-1_000, 15)]))
      expect(pill()?.className).toContain('enters')
    })

    it('has no entrance when the visitor prefers reduced motion', async () => {
      prefersReducedMotion()
      await open(wallWith([discreet(-1_000, 15)]))

      expect(pill()?.className).not.toContain('enters')
    })
  })
})
