import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fr } from '../../lib/i18n/fr'
import type { WallResponse } from '../../lib/api/dto'
import { aWallItem, fakeApi, renderWithProviders } from '../../testing/renderWithProviders'
import { WallPage } from './WallPage'
import {
  ROUTE,
  PATH,
  theWall,
  streamOpens,
  streamSignals,
  aPopulatedWall,
  wallSequence,
  useWallPageEnvironment,
} from './testing/wallPageHarness'

describe('WallPage', () => {
  useWallPageEnvironment()

  describe('WallPage and the timed challenge (spec 10)', () => {
    /** A challenge `leftMs` from its end by the server's clock, read from a machine `skewMs` ahead. */
    const running = (leftMs: number, skewMs = 0): Partial<WallResponse> => {
      const serverNowMs = Date.now() - skewMs
      return {
        serverNowMs,
        challenge: {
          id: 'c1',
          prompt: 'un selfie avec votre voisin',
          startedAt: new Date(serverNowMs - 10_000).toISOString(),
          endsAt: new Date(serverNowMs + leftMs).toISOString(),
          state: 'running',
          answers: null,
        },
      }
    }

    const ended = (answers: number | null): Partial<WallResponse> => ({
      challenge: {
        id: 'c1',
        prompt: 'un selfie avec votre voisin',
        startedAt: new Date(Date.now() - 120_000).toISOString(),
        endsAt: new Date(Date.now() - 1_000).toISOString(),
        state: 'ended',
        answers,
      },
    })

    beforeEach(() => {
      // The clock and the interval only: promises, `findBy` and the wall's own timers run on.
      vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    })

    it('shows the prompt and the time left, and reserves the top of the screen', async () => {
      const api = fakeApi({ wall: wallSequence(aPopulatedWall(running(102_000))) })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
      await screen.findByTestId('wall-slide')

      expect(await screen.findByText('1:42')).toBeVisible()
      expect(screen.getByText('un selfie avec votre voisin')).toBeVisible()
      expect(theWall().getAttribute('data-wall-chrome')).toContain('top')
    })

    it('counts down against the server clock, not the machine’s: three minutes ahead, same time', async () => {
      const api = fakeApi({ wall: wallSequence(aPopulatedWall(running(102_000, 180_000))) })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
      await screen.findByTestId('wall-slide')

      expect(await screen.findByText('1:42')).toBeVisible()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
      expect(screen.getByText('1:41')).toBeVisible()
    })

    it('shows nothing, and reserves nothing, when no challenge runs', async () => {
      const api = fakeApi({ wall: wallSequence(aPopulatedWall()) })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
      await screen.findByTestId('wall-slide')

      expect(document.querySelector('[data-wall-challenge]')).toBeNull()
      expect(theWall().getAttribute('data-wall-chrome') ?? '').not.toContain('top')
    })

    it('draws no banner once the room can no longer send photographs', async () => {
      const api = fakeApi({
        wall: wallSequence(aPopulatedWall({ ...running(102_000), acceptsGuests: false })),
      })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
      await screen.findByTestId('wall-slide')

      expect(document.querySelector('[data-wall-challenge]')).toBeNull()
      expect(screen.queryByText('1:42')).not.toBeInTheDocument()
    })

    it('brings the join card back when a challenge starts, even after Q put it away', async () => {
      const api = fakeApi({
        wall: wallSequence(aPopulatedWall(), aPopulatedWall(running(102_000))),
      })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
      await screen.findByTestId('wall-slide')
      await streamOpens()
      await userEvent.keyboard('q')
      expect(screen.queryByText('H7K2QM')).not.toBeInTheDocument()

      await streamSignals('challenge.changed')

      expect(await screen.findByText('1:42')).toBeVisible()
      expect(screen.getByText('H7K2QM')).toBeVisible()
    })

    it('holds the join card on screen while the challenge runs, whatever Q says', async () => {
      const api = fakeApi({ wall: wallSequence(aPopulatedWall(running(102_000))) })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
      await screen.findByText('1:42')

      await userEvent.keyboard('q')

      expect(screen.getByText('H7K2QM')).toBeVisible()
    })

    it('leaves the card where the challenge brought it back to, once the challenge is over', async () => {
      const api = fakeApi({
        wall: wallSequence(aPopulatedWall(), aPopulatedWall(running(102_000)), aPopulatedWall()),
      })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
      await screen.findByTestId('wall-slide')
      await streamOpens()
      await userEvent.keyboard('q')
      await streamSignals('challenge.changed')
      await screen.findByText('1:42')

      await streamSignals('challenge.changed')

      await waitFor(() => expect(screen.queryByText('1:42')).not.toBeInTheDocument())
      expect(screen.getByText('H7K2QM')).toBeVisible()
    })

    it('hides the souvenir counter while the banner is up, and shows it again after', async () => {
      const counter = { souvenirCounter: true, souvenirCount: 1_234 }
      const api = fakeApi({
        wall: wallSequence(
          aPopulatedWall({ ...counter, ...running(102_000) }),
          aPopulatedWall({ ...counter, revision: 'rev-1' }),
        ),
      })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
      await screen.findByText('1:42')
      expect(screen.queryByTestId('souvenir-counter')).toBeNull()
      await streamOpens()

      await streamSignals('challenge.changed')

      expect(await screen.findByTestId('souvenir-counter')).toBeVisible()
    })

    it('holds the new-photo signal while the banner is up, and announces it afterwards', async () => {
      const first = aWallItem({ id: 'photo-1' })
      const second = aWallItem({ id: 'photo-2' })
      const on = { newPhotoSignal: true }
      const api = fakeApi({
        wall: wallSequence(
          aPopulatedWall({ ...on, souvenirCount: 1, items: [first], ...running(102_000) }),
          aPopulatedWall({
            ...on,
            revision: 'rev-2',
            souvenirCount: 2,
            items: [second, first],
            ...running(100_000),
          }),
          aPopulatedWall({ ...on, revision: 'rev-2', souvenirCount: 2, items: [second, first] }),
        ),
      })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
      await screen.findByText('1:42')
      await streamOpens()

      await streamSignals('photo.moderated')
      await waitFor(() => expect(api.wall).toHaveBeenCalledTimes(2))
      expect(screen.queryByTestId('new-photo-signal')).toBeNull()

      await streamSignals('challenge.changed')

      expect(await screen.findByTestId('new-photo-signal')).toHaveTextContent(
        'Nouvelle photo ajoutée',
      )
    })

    it('says "Défi terminé" with the number of published answers, and no confetti', async () => {
      const api = fakeApi({ wall: wallSequence(aPopulatedWall(ended(3))) })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
      await screen.findByTestId('wall-slide')

      expect(await screen.findByText(`${fr.challenge.ended} · 3 photos`)).toBeVisible()
    })

    it('says only "Défi terminé" when nobody answered', async () => {
      const api = fakeApi({ wall: wallSequence(aPopulatedWall(ended(null))) })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
      await screen.findByTestId('wall-slide')

      expect(await screen.findByText(fr.challenge.ended)).toBeVisible()
    })

    it('asks the server again once, when the countdown reaches zero', async () => {
      const wall = wallSequence(aPopulatedWall(running(2_000)), aPopulatedWall(ended(1)))
      renderWithProviders(<WallPage />, { api: fakeApi({ wall }), route: ROUTE, path: PATH })
      await screen.findByText('0:02')

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })

      await waitFor(() => expect(wall).toHaveBeenCalledTimes(2))
      expect(await screen.findByText(`${fr.challenge.ended} · 1 photo`)).toBeVisible()
    })

    it('keeps its one-second interval only while the banner is on screen', async () => {
      const wall = wallSequence(aPopulatedWall(running(60_000)), aPopulatedWall())
      const view = renderWithProviders(<WallPage />, {
        api: fakeApi({ wall }),
        route: ROUTE,
        path: PATH,
      })
      await screen.findByText('1:00')
      const withBanner = vi.getTimerCount()

      view.unmount()

      expect(vi.getTimerCount()).toBeLessThan(withBanner)
    })
  })
})
