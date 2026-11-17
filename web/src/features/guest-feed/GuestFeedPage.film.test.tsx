import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { GuestFeedPage } from './GuestFeedPage'
import { rememberGuestSession } from '../../lib/guestSession'
import {
  aPrivacyNoticeState,
  aPublicEvent,
  aWallItem,
  aWallResponse,
  fakeApi,
  renderWithProviders,
} from '../../testing/renderWithProviders'
import { aRevealBlock } from '../../testing/revealFixtures'
import type { WallResponse, WallRevealDto } from '../../lib/api/dto'

/** The feed of the evening draws the photographs with the film look when the server says so (spec 23). */
const render = (wall: Partial<WallResponse>) =>
  renderWithProviders(<GuestFeedPage />, {
    api: fakeApi({
      wall: vi.fn(async () => aWallResponse(wall)),
      myPhotos: vi.fn(async () => ({ items: [] })),
    }),
    route: '/e/camille-et-sacha/photos',
    path: '/e/:slug/photos',
  })

const revealed = (film: boolean): WallRevealDto => ({
  ...aRevealBlock({ revealed: true, film }),
  readyCount: null,
})

const items = [
  aWallItem({ id: 'a', caption: 'Les confettis' }),
  aWallItem({ id: 'b', caption: 'Le gâteau' }),
]

describe('the feed with the film look (spec 23)', () => {
  beforeEach(() => {
    rememberGuestSession({
      event: aPublicEvent(),
      displayName: 'Léa',
      privacyNotice: aPrivacyNoticeState(),
    })
  })

  it('puts the look on every photograph, and only on the photographs', async () => {
    const { container } = render({ items, reveal: revealed(true) })

    const photos = await screen.findAllByRole('img')
    expect(photos).toHaveLength(2)
    for (const photo of photos) expect(photo).toHaveClass('filmLook')
    expect(container.querySelectorAll('.filmLook')).toHaveLength(2)
  })

  it('puts none on an evening without the film look', async () => {
    const { container } = render({ items, reveal: revealed(false) })

    expect(await screen.findAllByRole('img')).toHaveLength(2)
    expect(container.querySelector('.filmLook')).toBeNull()
  })

  it('puts none on an evening with no reveal block at all', async () => {
    const { container } = render({ items })

    expect(await screen.findAllByRole('img')).toHaveLength(2)
    expect(container.querySelector('.filmLook')).toBeNull()
  })
})
