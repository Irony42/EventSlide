import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fr } from '../../lib/i18n/fr'
import type { WallResponse } from '../../lib/api/dto'
import {
  aWallGuestbookMessage,
  aWallMission,
  aWallResponse,
  fakeApi,
  renderWithProviders,
} from '../../testing/renderWithProviders'
import { WallPage } from './WallPage'
import {
  ROUTE,
  PATH,
  streamSignals,
  aPopulatedWall,
  somePhotos,
  wallSequence,
  useWallPageEnvironment,
} from './testing/wallPageHarness'

describe('WallPage', () => {
  useWallPageEnvironment()

  describe('WallPage and the mission panel', () => {
    it('draws no panel for an event whose host set no prompts', async () => {
      // Which is nearly every event, and is what keeps the wall that does not use this
      // feature exactly the wall it was.
      const api = fakeApi({ wall: wallSequence(aPopulatedWall()) })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
      await screen.findByTestId('wall-slide')

      expect(screen.queryByRole('heading', { name: fr.wall.missionsTitle })).not.toBeInTheDocument()
    })

    it('keeps the prompts in the corner while the room has photographs to look at', async () => {
      const api = fakeApi({
        wall: wallSequence(
          aPopulatedWall({ missions: [aWallMission({ prompt: 'un selfie avec les mariés' })] }),
        ),
      })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
      await screen.findByTestId('wall-slide')

      expect(screen.getByRole('heading', { name: fr.wall.missionsTitle })).toBeVisible()
      expect(screen.getByText('un selfie avec les mariés')).toBeVisible()
    })

    it('withholds the panel while the wall is still the invitation', async () => {
      // The empty state is a full-screen invitation, and chrome over it would cover the one
      // message the room needs in the first twenty minutes.
      const api = fakeApi({
        wall: wallSequence(aWallResponse({ items: [], missions: [aWallMission()] })),
      })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
      await screen.findByTestId('wall-empty')

      expect(screen.queryByRole('heading', { name: fr.wall.missionsTitle })).not.toBeInTheDocument()
    })

    it('keeps the prompts when the host only puts the join reminder away', async () => {
      // The button says "Masquer le rappel du code". A host who wants the QR out of the
      // corner has not asked for the room's mission list to go with it — and nothing on
      // this screen puts either back, because the projector is unattended.
      const api = fakeApi({
        wall: wallSequence(aPopulatedWall({ missions: [aWallMission({ prompt: 'un selfie' })] })),
      })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
      await screen.findByTestId('wall-slide')

      await userEvent.click(screen.getByRole('button', { name: fr.wall.dismissJoinCard }))

      expect(screen.queryByText('H7K2QM')).not.toBeInTheDocument()
      expect(screen.getByText('un selfie')).toBeVisible()
    })

    it('keeps the prompts when Escape or Q put the join reminder away', async () => {
      // Escape closes the help and nothing else now, and Q is the QR's key: neither takes
      // the mission list with it, and the list has no key of its own (MUR-5).
      const api = fakeApi({
        wall: wallSequence(aPopulatedWall({ missions: [aWallMission({ prompt: 'un selfie' })] })),
      })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
      await screen.findByTestId('wall-slide')

      await userEvent.keyboard('{Escape}q')

      expect(screen.queryByText('H7K2QM')).not.toBeInTheDocument()
      expect(screen.getByText('un selfie')).toBeVisible()
    })

    it('follows the server when a prompt becomes answered, without the playlist moving', async () => {
      // The panel cannot ride on `revision`, which fingerprints the items alone: a
      // photograph being published on a wall that is already playing it moves no slide at
      // all, and the panel would stay wrong for the rest of a quiet stretch.
      const api = fakeApi({
        wall: wallSequence(
          aPopulatedWall({ missions: [aWallMission({ id: 'm1', prompt: 'un selfie' })] }),
          aPopulatedWall({
            missions: [
              aWallMission({ id: 'm1', prompt: 'un selfie', achieved: true, completedByGuests: 3 }),
            ],
          }),
        ),
      })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
      await screen.findByTestId('wall-slide')
      expect(screen.queryByText(fr.wall.missionGuests(3))).not.toBeInTheDocument()

      await streamSignals('mission.changed')

      expect(await screen.findByText(fr.wall.missionGuests(3))).toBeVisible()
    })
  })

  describe('WallPage, the guestbook cards (spec 01)', () => {
    const book = (everyNth = 2) => ({
      everyNth,
      messages: [
        aWallGuestbookMessage({ id: 'g1', text: 'Une soirée merveilleuse', authorName: 'Zoé' }),
        aWallGuestbookMessage({ id: 'g2', text: 'Longue vie aux mariés', authorName: null }),
      ],
    })

    /** The slide clock, not the host: one change of the server's 8 s interval each. */
    const automaticChanges = async (count: number): Promise<void> => {
      for (let i = 0; i < count; i += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(8_000)
        })
      }
    }

    beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }))
    afterEach(() => vi.useRealTimers())

    it('shows a message card every Nth automatic photograph change, signed, and holds the photographs under it', async () => {
      const api = fakeApi({
        wall: wallSequence(aPopulatedWall({ items: somePhotos(4), guestbook: book() })),
      })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
      await screen.findByTestId('wall-slide')

      await automaticChanges(1)
      expect(screen.queryByText('Une soirée merveilleuse')).not.toBeInTheDocument()

      await automaticChanges(1)
      expect(screen.getByText('Une soirée merveilleuse')).toBeVisible()
      expect(screen.getByText('Zoé')).toBeVisible()
    })

    it('leaves the card for a photograph when the host presses an arrow, and never lands on one by pressing', async () => {
      const api = fakeApi({
        wall: wallSequence(aPopulatedWall({ items: somePhotos(6), guestbook: book(2) })),
      })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
      await screen.findByTestId('wall-slide')
      await automaticChanges(2)
      expect(document.querySelector('[data-wall-message]')).not.toBeNull()

      await userEvent.keyboard('{ArrowRight}')
      expect(document.querySelector('[data-wall-message]')).toBeNull()

      // Ten more presses, either way: the card only comes back on the slide clock.
      for (const key of ['{ArrowRight}', '{ArrowLeft}']) {
        for (let i = 0; i < 5; i += 1) {
          await userEvent.keyboard(key)
          expect(document.querySelector('[data-wall-message]')).toBeNull()
        }
      }
    })

    it('keeps the challenge banner on screen over a card, and starts no new card while it runs', async () => {
      const serverNowMs = Date.now()
      const challenge: Partial<WallResponse> = {
        serverNowMs,
        challenge: {
          id: 'c1',
          prompt: 'un selfie avec votre voisin',
          startedAt: new Date(serverNowMs - 1_000).toISOString(),
          endsAt: new Date(serverNowMs + 3_600_000).toISOString(),
          state: 'running',
          answers: null,
        },
      }
      const book = {
        everyNth: 2,
        messages: [
          aWallGuestbookMessage({ id: 'g1', text: 'Une soirée merveilleuse', displayMs: 3_000 }),
        ],
      }
      const photos = { items: somePhotos(8), guestbook: book }
      const api = fakeApi({
        wall: wallSequence(aPopulatedWall(photos), aPopulatedWall({ ...photos, ...challenge })),
      })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
      await screen.findByTestId('wall-slide')
      await automaticChanges(2)
      expect(await screen.findByText('Une soirée merveilleuse')).toBeVisible()

      await streamSignals('challenge.changed')
      expect(await screen.findByText('un selfie avec votre voisin')).toBeVisible()
      expect(screen.getByText('Une soirée merveilleuse')).toBeVisible()

      // The card ends on its own time; the next Nth changes (4th, 6th) bring none while it runs.
      for (let i = 0; i < 12; i += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(2_000)
        })
        if (i >= 2) expect(screen.queryByText('Une soirée merveilleuse')).toBeNull()
      }
      expect(screen.getByText('un selfie avec votre voisin')).toBeVisible()
    })

    it('keeps the automatic rhythm after manual presses: a card again two automatic changes later', async () => {
      const api = fakeApi({
        wall: wallSequence(aPopulatedWall({ items: somePhotos(6), guestbook: book(2) })),
      })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
      await screen.findByTestId('wall-slide')
      await userEvent.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}')
      expect(document.querySelector('[data-wall-message]')).toBeNull()

      await automaticChanges(1)
      expect(document.querySelector('[data-wall-message]')).toBeNull()
      await automaticChanges(1)

      expect(screen.getByText('Une soirée merveilleuse')).toBeVisible()
    })

    it('signs a message whose guest gave no name with the wall’s own words', async () => {
      const api = fakeApi({
        wall: wallSequence(
          aPopulatedWall({
            items: somePhotos(4),
            guestbook: { everyNth: 2, messages: [aWallGuestbookMessage({ authorName: null })] },
          }),
        ),
      })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
      await screen.findByTestId('wall-slide')

      await automaticChanges(2)

      expect(screen.getByText(fr.wall.guestbookAnonymous)).toBeVisible()
    })

    it('shows no card on a wall whose response carries no guestbook', async () => {
      const api = fakeApi({ wall: wallSequence(aPopulatedWall({ items: somePhotos(4) })) })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
      await screen.findByTestId('wall-slide')

      await automaticChanges(2)

      expect(document.querySelector('[data-wall-message]')).toBeNull()
    })

    it('re-reads on a guestbook.changed signal, and shows the message that appeared', async () => {
      const api = fakeApi({
        wall: wallSequence(
          aPopulatedWall({ items: somePhotos(4) }),
          aPopulatedWall({ items: somePhotos(4), guestbook: book() }),
        ),
      })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
      await screen.findByTestId('wall-slide')

      await streamSignals('guestbook.changed')
      await automaticChanges(2)

      expect(await screen.findByText('Une soirée merveilleuse')).toBeVisible()
    })
  })
})
