import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GuestFeedPage } from './GuestFeedPage'
import { rememberGuestSession } from '../../lib/guestSession'
import { ApiError } from '../../lib/http'
import { fr } from '../../lib/i18n/fr'
import {
  aGuestPhoto,
  aPrivacyNoticeState,
  aPublicEvent,
  aWallClip,
  aWallItem,
  aWallResponse,
  fakeApi,
  renderWithProviders,
} from '../../testing/renderWithProviders'
import type { Api } from '../../lib/api/client'
import type { GuestPhotoDto, WallItemDto, WallResponse } from '../../lib/api/dto'

const SLUG = 'camille-et-sacha'

/** What the join step leaves behind. Without it the screen has no event to show. */
const havingJoined = (): void => {
  rememberGuestSession({
    event: aPublicEvent(),
    displayName: 'Léa',
    privacyNotice: aPrivacyNoticeState(),
  })
}

const renderFeed = (api: Api) =>
  renderWithProviders(<GuestFeedPage />, {
    api,
    route: `/e/${SLUG}/photos`,
    path: '/e/:slug/photos',
  })

const withWall = (
  items: readonly WallItemDto[],
  overrides: Partial<WallResponse> = {},
  mine: readonly GuestPhotoDto[] = [],
): Api =>
  fakeApi({
    wall: vi.fn(async () => aWallResponse({ items: [...items], ...overrides })),
    myPhotos: vi.fn(async () => ({ items: mine })),
  })

const photo = (id: string, overrides: Partial<WallItemDto> = {}): WallItemDto =>
  aWallItem({
    id,
    thumbUrl: `/api/events/${SLUG}/photos/${id}/thumb`,
    caption: `Photo ${id}`,
    ...overrides,
  })

const manyPhotos = (count: number): readonly WallItemDto[] =>
  Array.from({ length: count }, (_unused, index) => photo(`photo-${index + 1}`))

describe('GuestFeedPage', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
  })

  it('shows the photographs the wall shows, in the wall’s order, whole and described', async () => {
    havingJoined()
    renderFeed(withWall([photo('b', { caption: 'Les confettis' }), photo('a', { caption: null })]))

    const images = await screen.findAllByRole('img')

    expect(images.map((image) => image.getAttribute('alt'))).toEqual([
      'Les confettis',
      fr.wall.photoBy('Léa'),
    ])
    expect(images[0]).toHaveAttribute('src', `/api/events/${SLUG}/photos/b/thumb`)
    // The browser reserves the box before the bytes arrive, so a list of twenty does not
    // shuffle under the guest's thumb as the thumbnails land.
    expect(images[0]).toHaveAttribute('width', '2560')
    expect(images[0]).toHaveAttribute('loading', 'lazy')
  })

  it('names the evening, and leads back to sending photographs', async () => {
    havingJoined()
    renderFeed(withWall([photo('a')]))

    expect(await screen.findByRole('heading', { level: 1, name: fr.feed.title })).toBeVisible()
    expect(screen.getByText('Camille & Sacha')).toBeVisible()
    expect(screen.getByRole('link', { name: fr.feed.back })).toHaveAttribute(
      'href',
      `/e/${SLUG}/upload`,
    )
  })

  it('says it is fetching, and draws no photograph before the wall has answered', () => {
    havingJoined()
    renderFeed(fakeApi({ wall: vi.fn(() => new Promise<WallResponse>(() => {})) }))

    expect(screen.getByRole('status')).toHaveTextContent(fr.app.loading)
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('says plainly that nothing is on the screen yet', async () => {
    // An empty page is indistinguishable from one that failed to load.
    havingJoined()
    renderFeed(withWall([]))

    expect(await screen.findByText(fr.feed.empty)).toBeVisible()
    expect(screen.getByText(fr.feed.emptyHint)).toBeVisible()
  })

  it('says the photographs could not be loaded, and reads again on retry', async () => {
    havingJoined()
    let reads = 0
    const api = fakeApi({
      wall: vi.fn(async () => {
        reads += 1
        if (reads === 1) throw ApiError.network()
        return aWallResponse({ items: [photo('a')] })
      }),
    })
    renderFeed(api)

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.feed.failed)

    await userEvent.click(screen.getByRole('button', { name: fr.app.retry }))

    expect(await screen.findByRole('img')).toBeVisible()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('offers the reactions under somebody else’s photograph when the wall says they are on', async () => {
    havingJoined()
    renderFeed(withWall([photo('a'), photo('b')]))

    expect(await screen.findByRole('group', { name: fr.upload.reactionsGroup(1) })).toBeVisible()
    expect(screen.getByRole('group', { name: fr.upload.reactionsGroup(2) })).toBeVisible()
  })

  it('offers none under the guest’s own photograph, and says it is theirs', async () => {
    // The server refuses it (`reaction.ownPhoto`); this is what keeps a button off the screen
    // that could only be refused.
    havingJoined()
    renderFeed(withWall([photo('mine'), photo('theirs')], {}, [aGuestPhoto({ id: 'mine' })]))

    const cards = await screen.findAllByRole('listitem')

    expect(within(cards[0]!).getByText(fr.feed.own)).toBeVisible()
    expect(within(cards[0]!).queryByRole('group')).toBeNull()
    expect(within(cards[1]!).getByRole('group')).toBeVisible()
    expect(within(cards[1]!).queryByText(fr.feed.own)).toBeNull()
  })

  it('offers none, and reads no reactions, when the wall says the host turned them off', async () => {
    // From the wall's answer and not from what the join said: a guest holds the join's
    // for the whole evening, and the host's switch can move in the middle of it.
    havingJoined()
    const api = withWall([photo('a')], { reactionsEnabled: false })
    renderFeed(api)

    await screen.findByRole('img')

    expect(screen.queryByRole('group')).toBeNull()
    expect(api.reactions).not.toHaveBeenCalled()
  })

  it('draws no reaction bar before it knows which photographs are the guest’s own', async () => {
    // A bar drawn first would read the reactions of a photograph the guest then turns out
    // to have taken, and take itself away a moment later.
    havingJoined()
    let release: (value: { items: readonly GuestPhotoDto[] }) => void = () => {}
    const api = fakeApi({
      wall: vi.fn(async () => aWallResponse({ items: [photo('mine'), photo('theirs')] })),
      myPhotos: vi.fn(
        () =>
          new Promise<{ items: readonly GuestPhotoDto[] }>((resolve) => {
            release = resolve
          }),
      ),
    })
    renderFeed(api)
    await waitFor(() => expect(api.myPhotos).toHaveBeenCalled())

    expect(screen.queryByRole('img')).toBeNull()
    expect(api.reactions).not.toHaveBeenCalled()

    release({ items: [aGuestPhoto({ id: 'mine' })] })

    expect(await screen.findAllByRole('listitem')).toHaveLength(2)
    expect(screen.getAllByRole('group')).toHaveLength(1)
    expect(api.reactions).toHaveBeenCalledTimes(1)
    expect(api.reactions).toHaveBeenCalledWith(SLUG, 'theirs', expect.any(AbortSignal))
  })

  it('still shows the evening when the guest’s own list cannot be read', async () => {
    // Costs a refusal in words if the guest taps their own photograph, and nothing else.
    havingJoined()
    const api = fakeApi({
      wall: vi.fn(async () => aWallResponse({ items: [photo('a')] })),
      myPhotos: vi.fn(async () => {
        throw ApiError.network()
      }),
    })
    renderFeed(api)

    expect(await screen.findByRole('img')).toBeVisible()
    expect(screen.getByRole('group')).toBeVisible()
  })

  it('says a clip is a video, and shows its poster', async () => {
    havingJoined()
    renderFeed(withWall([aWallClip({ id: 'clip-1', caption: 'La danse' })]))

    expect(await screen.findByText(fr.upload.mineClipBadge)).toBeVisible()
    expect(screen.getByRole('img', { name: 'La danse' })).toHaveAttribute(
      'src',
      `/api/events/${SLUG}/photos/clip-1/poster`,
    )
  })

  it('shows twelve photographs and offers the rest', async () => {
    havingJoined()
    renderFeed(withWall(manyPhotos(15)))

    expect(await screen.findAllByRole('listitem')).toHaveLength(12)

    await userEvent.click(screen.getByRole('button', { name: fr.feed.more }))

    expect(screen.getAllByRole('listitem')).toHaveLength(15)
    expect(screen.queryByRole('button', { name: fr.feed.more })).toBeNull()
  })

  it('offers nothing more when everything is already shown', async () => {
    havingJoined()
    renderFeed(withWall(manyPhotos(12)))

    await screen.findAllByRole('listitem')

    expect(screen.queryByRole('button', { name: fr.feed.more })).toBeNull()
  })

  it('reads the wall and the guest’s own list again on refresh', async () => {
    havingJoined()
    const api = withWall([photo('a')])
    renderFeed(api)
    await screen.findByRole('img')

    await userEvent.click(screen.getByRole('button', { name: fr.feed.refresh }))

    await waitFor(() => expect(api.wall).toHaveBeenCalledTimes(2))
    expect(api.myPhotos).toHaveBeenCalledTimes(2)
  })

  it('asks a guest who has not joined to join', () => {
    renderFeed(withWall([photo('a')]))

    expect(screen.getByRole('heading', { level: 1, name: fr.upload.notJoinedTitle })).toBeVisible()
    expect(screen.getByRole('link', { name: fr.upload.notJoinedAction })).toHaveAttribute(
      'href',
      '/join',
    )
  })
})
