import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen } from '@testing-library/react'
import { GuestFeedPage } from './GuestFeedPage'
import { rememberGuestSession } from '../../lib/guestSession'
import { fr } from '../../lib/i18n/fr'
import {
  aPrivacyNoticeState,
  aPublicEvent,
  aWallItem,
  aWallResponse,
  fakeApi,
  renderWithProviders,
} from '../../testing/renderWithProviders'
import { aRevealBlock } from '../../testing/revealFixtures'
import type { Api } from '../../lib/api/client'
import type { WallResponse, WallRevealDto } from '../../lib/api/dto'

/**
 * The feed of the evening on a disposable-camera evening (spec 23): empty by the server's rule
 * until the reveal, and saying when it opens instead of "nothing yet". The phone asks again at the
 * hour on its own timer, since nothing announces it.
 */

const SLUG = 'camille-et-sacha'

const wallReveal = (overrides: Partial<WallRevealDto> = {}): WallRevealDto => ({
  ...aRevealBlock(overrides),
  readyCount: null,
})

const renderFeed = (api: Api) =>
  renderWithProviders(<GuestFeedPage />, {
    api,
    route: `/e/${SLUG}/photos`,
    path: '/e/:slug/photos',
  })

const serving = (...walls: readonly Partial<WallResponse>[]) => {
  let read = 0
  const wall = vi.fn(async () => aWallResponse(walls[Math.min(read++, walls.length - 1)] ?? {}))
  return { api: fakeApi({ wall, myPhotos: vi.fn(async () => ({ items: [] })) }), wall }
}

describe('the feed of a disposable-camera evening', () => {
  beforeEach(() => {
    rememberGuestSession({
      event: aPublicEvent(),
      displayName: 'Léa',
      privacyNotice: aPrivacyNoticeState(),
    })
  })

  it('says when the photos open, and the time left, instead of "no photo yet"', async () => {
    const now = Date.now()
    const { api } = serving({
      reveal: wallReveal({ serverNowMs: now, atMs: now + (2 * 60 + 5) * 60_000 }),
    })
    renderFeed(api)

    const wait = await screen.findByTestId('feed-reveal')
    expect(wait).toHaveTextContent(/^Les photos seront révélées (à|le) /)
    expect(wait).toHaveTextContent(fr.reveal.feedHint)
    expect(await screen.findByTestId('feed-reveal-left')).toHaveTextContent(
      fr.reveal.guestLeft(2, 5),
    )
    expect(screen.queryByText(fr.feed.empty)).toBeNull()
  })

  it('says the photos will be revealed soon, with no countdown, for an evening revealed by hand', async () => {
    const { api } = serving({ reveal: wallReveal({ atMs: null }) })
    renderFeed(api)

    expect(await screen.findByText(fr.reveal.feedSoon)).toBeVisible()
    expect(screen.queryByTestId('feed-reveal-left')).toBeNull()
  })

  it('offers no reaction on a photograph that is not shown yet: there is none', async () => {
    const { api } = serving({ reveal: wallReveal() })
    renderFeed(api)
    await screen.findByTestId('feed-reveal')

    expect(screen.queryAllByRole('img')).toHaveLength(0)
    expect(screen.queryByRole('group', { name: /./ })).toBeNull()
  })

  it('is the ordinary empty feed once revealed, with nothing sent yet', async () => {
    const { api } = serving({ reveal: wallReveal({ revealed: true }) })
    renderFeed(api)

    expect(await screen.findByText(fr.feed.empty)).toBeVisible()
    expect(screen.queryByTestId('feed-reveal')).toBeNull()
  })

  it('is the ordinary empty feed for an event with no reveal at all', async () => {
    const { api } = serving({})
    renderFeed(api)

    expect(await screen.findByText(fr.feed.empty)).toBeVisible()
    expect(screen.queryByTestId('feed-reveal')).toBeNull()
  })

  describe('at the hour', () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      vi.spyOn(Math, 'random').mockReturnValue(0)
    })
    afterEach(() => {
      vi.restoreAllMocks()
      vi.useRealTimers()
    })

    it('reads the wall again on its own timer and opens the feed', async () => {
      const now = Date.now()
      const { api, wall } = serving(
        { reveal: wallReveal({ serverNowMs: now, atMs: now + 30_000 }) },
        {
          reveal: wallReveal({ revealed: true, serverNowMs: now + 31_000, atMs: now + 30_000 }),
          items: [aWallItem({ id: 'a', caption: 'Les confettis' })],
        },
      )
      renderFeed(api)
      await screen.findByTestId('feed-reveal')
      expect(wall).toHaveBeenCalledTimes(1)

      await act(() => vi.advanceTimersByTimeAsync(29_000))
      expect(wall).toHaveBeenCalledTimes(1)
      await act(() => vi.advanceTimersByTimeAsync(2_000))

      expect(wall).toHaveBeenCalledTimes(2)
      expect(await screen.findAllByRole('img')).toHaveLength(1)
      expect(screen.queryByTestId('feed-reveal')).toBeNull()
    })
  })
})
