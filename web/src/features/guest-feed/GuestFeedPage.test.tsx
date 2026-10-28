import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GuestFeedPage } from './GuestFeedPage'
import {
  readGuestSession,
  readRememberedGuestSession,
  rememberGuestSession,
} from '../../lib/guestSession'
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
import type {
  GuestPhotoDto,
  PublicEventDto,
  ReactionsResponse,
  WallItemDto,
  WallResponse,
} from '../../lib/api/dto'

const SLUG = 'camille-et-sacha'

/** What the join step leaves behind. Without it the screen has no event to show. */
const havingJoined = (overrides: Partial<PublicEventDto> = {}): void => {
  rememberGuestSession({
    event: aPublicEvent(overrides),
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

    // The caption and then the sender, as the wall words it: "who sent this" is the part a
    // listener cannot get from the picture.
    expect(images.map((image) => image.getAttribute('alt'))).toEqual([
      `Les confettis — ${fr.wall.photoBy('Léa')}`,
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
    // Waited for, not read at once: the bar asks for its reactions in an effect, and the list
    // above appears from a state update outside `act`, whose passive effects React runs a
    // moment after the commit that Testing Library already saw. Reading the call count in the
    // same tick is what made this test fail once on a slow runner.
    await waitFor(() =>
      expect(api.reactions).toHaveBeenCalledWith(SLUG, 'theirs', expect.any(AbortSignal)),
    )
    expect(api.reactions).toHaveBeenCalledTimes(1)
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
    expect(
      screen.getByRole('img', { name: `La danse — ${fr.wall.videoBy('Léa')}` }),
    ).toHaveAttribute('src', `/api/events/${SLUG}/photos/clip-1/poster`)
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

  it('keeps each photograph’s reactions with that photograph when a refresh puts a new one first', async () => {
    // The cards are keyed by the photograph and not by their place: under an index key the
    // first card would keep the hearts of whichever photograph used to be there.
    havingJoined()
    let reads = 0
    const api = fakeApi({
      wall: vi.fn(async () => {
        reads += 1
        return aWallResponse({
          items: reads === 1 ? [photo('a'), photo('b')] : [photo('new'), photo('a'), photo('b')],
        })
      }),
      // The new photograph's row never answers, so what its card shows is only what it
      // starts from: under an index key that would be the hearts of the photograph that used
      // to be first, still on screen while the new one is being read.
      reactions: vi.fn((_slug: string, photoId: string) =>
        photoId === 'new'
          ? new Promise<ReactionsResponse>(() => {})
          : Promise.resolve({
              counts: { love: 0, laugh: 0, wow: 0, cheers: 0, clap: 0 },
              mine: photoId === 'a' ? (['love'] as const) : [],
            }),
      ),
    })
    renderFeed(api)
    const before = await screen.findAllByRole('listitem')
    await waitFor(() =>
      expect(
        within(before[0]!).getByRole('button', { name: fr.upload.reactionKinds.love }),
      ).toHaveAttribute('aria-pressed', 'true'),
    )

    await userEvent.click(screen.getByRole('button', { name: fr.feed.refresh }))

    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(3))
    const after = screen.getAllByRole('listitem')
    await waitFor(() =>
      expect(
        within(after[1]!).getByRole('button', { name: fr.upload.reactionKinds.love }),
      ).toHaveAttribute('aria-pressed', 'true'),
    )
    const fresh = within(after[0]!).getByRole('button', { name: fr.upload.reactionKinds.love })
    expect(fresh).toHaveAttribute('aria-pressed', 'false')
    expect(fresh).toBeDisabled()
  })

  it('says a refresh is under way, and says when it failed while keeping what was on screen', async () => {
    havingJoined()
    let reads = 0
    const pending: { release: () => void } = { release: () => {} }
    const api = fakeApi({
      wall: vi.fn(async () => {
        reads += 1
        if (reads === 1) return aWallResponse({ items: [photo('a')] })
        await new Promise<void>((resolve) => {
          pending.release = resolve
        })
        throw ApiError.network()
      }),
    })
    renderFeed(api)
    await screen.findByRole('img')

    await userEvent.click(screen.getByRole('button', { name: fr.feed.refresh }))

    // Not a second tap on a button that did nothing: on venue Wi-Fi that restarts both reads.
    expect(await screen.findByRole('button', { name: fr.feed.refresh })).toHaveAttribute(
      'aria-busy',
      'true',
    )

    pending.release()

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.feed.failed)
    expect(screen.getByRole('img')).toBeVisible()
    expect(screen.getByRole('button', { name: fr.feed.refresh })).not.toHaveAttribute('aria-busy')
  })

  it('moves focus to the first photograph that “Voir plus” added', async () => {
    // On the last page the button is gone from under the finger that pressed it, and focus
    // would otherwise fall to the top of a long page.
    havingJoined()
    renderFeed(withWall(manyPhotos(15)))
    await screen.findAllByRole('listitem')

    await userEvent.click(screen.getByRole('button', { name: fr.feed.more }))

    expect(screen.getAllByRole('listitem')[12]).toHaveFocus()
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

describe('a gallery the server no longer serves (A3)', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    havingJoined()
  })

  const archived = (): Api =>
    fakeApi({
      wall: vi.fn(async () => {
        throw new ApiError(404, 'event.notFound')
      }),
    })

  it('says it is no longer on display instead of offering a retry that cannot succeed', async () => {
    renderFeed(archived())

    expect(await screen.findByRole('heading', { name: fr.feed.unavailable })).toBeVisible()
    expect(screen.getByText(fr.feed.unavailableHint)).toBeVisible()
    expect(screen.queryByRole('button', { name: fr.app.retry })).toBeNull()
    expect(screen.queryByRole('button', { name: fr.feed.refresh })).toBeNull()
    expect(screen.queryByText(fr.feed.failed)).toBeNull()
  })

  it('still offers the way back to the upload screen', async () => {
    renderFeed(archived())
    await screen.findByRole('heading', { name: fr.feed.unavailable })

    expect(screen.getByRole('link', { name: fr.feed.back })).toHaveAttribute(
      'href',
      `/e/${SLUG}/upload`,
    )
  })

  it('keeps the retry for a failure that is the network’s, which a retry can fix', async () => {
    renderFeed(
      fakeApi({
        wall: vi.fn(async () => {
          throw ApiError.network()
        }),
      }),
    )

    expect(await screen.findByText(fr.feed.failed)).toBeVisible()
    expect(screen.getByRole('button', { name: fr.app.retry })).toBeVisible()
    expect(screen.queryByText(fr.feed.unavailable)).toBeNull()
  })

  it('keeps the retry for a server error, which is not the server saying the gallery is gone', async () => {
    renderFeed(
      fakeApi({
        wall: vi.fn(async () => {
          throw new ApiError(503, 'service.notReady')
        }),
      }),
    )

    expect(await screen.findByRole('button', { name: fr.app.retry })).toBeVisible()
  })

  it('is an ordinary feed on a closed evening, which still serves its wall', async () => {
    // The server's answer for a closed event is the same 200 as for an open one.
    renderFeed(withWall([photo('a')]))

    expect(await screen.findByRole('img')).toBeVisible()
    expect(screen.queryByText(fr.feed.unavailable)).toBeNull()
  })
})

describe('a guest with no session on the feed (A2)', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
  })

  it('asks for the code (where the code then leads is the router journey’s test)', () => {
    renderFeed(fakeApi())

    expect(screen.getByRole('link', { name: fr.upload.notJoinedAction })).toHaveAttribute(
      'href',
      '/join',
    )
  })

  it('finds the event the device remembers, with no code to type', async () => {
    havingJoined()
    sessionStorage.clear()

    renderFeed(withWall([photo('a')]))

    expect(await screen.findByRole('img')).toBeVisible()
  })

  it('lets the guest say it is not their evening, and forgets it', async () => {
    havingJoined()
    renderFeed(withWall([photo('a')]))

    await userEvent.click(await screen.findByRole('button', { name: fr.join.notYourEvening }))

    expect(readRememberedGuestSession()).toBeNull()
    expect(readGuestSession(SLUG)).toBeNull()
  })
})

describe('a guest the server does not recognise any more, on the feed', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    havingJoined()
  })

  it('still shows the evening, and stops the device resuming an event it no longer has access to', async () => {
    renderFeed(
      fakeApi({
        wall: vi.fn(async () => aWallResponse({ items: [photo('a')] })),
        myPhotos: vi.fn(async () => {
          throw new ApiError(401, 'guestToken.expired')
        }),
      }),
    )

    expect(await screen.findByRole('img')).toBeVisible()
    await waitFor(() => expect(readRememberedGuestSession()).toBeNull())
  })

  describe('a theme the host changed after the guest joined', () => {
    const VIOLET = {
      accentHue: 305,
      fonts: 'sans',
      frame: 'soft',
      material: 'glass',
      ambiance: 'guinguette',
    } as const
    const ROSE = {
      accentHue: 345,
      fonts: 'serif',
      frame: 'round',
      material: 'plain',
      ambiance: 'guinguette',
    } as const
    const pageOf = async () =>
      (await screen.findByRole('heading', { name: fr.feed.title })).closest('div')

    it('paints the colour the wall answers with instead of the one the join stored', async () => {
      // The wall is the feed's own read, so the news costs no request; the join's copy is only
      // what the first frame is painted from.
      havingJoined({ theme: VIOLET })
      renderFeed(withWall([photo('a')], { theme: ROSE }))

      const page = await pageOf()
      await waitFor(() => expect(page).toHaveAttribute('data-event-accent', '345'))
    })

    it('writes it back, so the tab and the device hold the same theme for the next visit', async () => {
      havingJoined({ theme: VIOLET })
      renderFeed(withWall([photo('a')], { theme: ROSE }))

      await waitFor(() => expect(readGuestSession(SLUG)?.event.theme).toEqual(ROSE))
      expect(readRememberedGuestSession()?.event.theme).toEqual(ROSE)
    })

    it('keeps the colour it learned when a later wall answer carries none', async () => {
      havingJoined({ theme: VIOLET })
      let reads = 0
      renderFeed(
        fakeApi({
          wall: vi.fn(async () => {
            reads += 1
            return aWallResponse({
              items: [photo('a')],
              ...(reads === 1 ? { theme: ROSE } : { theme: { ...ROSE, accentHue: 4000 } }),
            })
          }),
          myPhotos: vi.fn(async () => ({ items: [] })),
        }),
      )
      const page = await pageOf()
      await waitFor(() => expect(page).toHaveAttribute('data-event-accent', '345'))

      await userEvent.click(screen.getByRole('button', { name: fr.feed.refresh }))
      await waitFor(() => expect(reads).toBe(2))

      expect(page).toHaveAttribute('data-event-accent', '345')
    })

    it('keeps the stored theme when the wall carries none this build can read', async () => {
      havingJoined({ theme: ROSE })
      renderFeed(withWall([photo('a')], { theme: { ...ROSE, accentHue: 4000 } }))

      expect(await screen.findByRole('img')).toBeVisible()
      expect(await pageOf()).toHaveAttribute('data-event-accent', '345')
      expect(readGuestSession(SLUG)?.event.theme).toEqual(ROSE)
    })
  })
})
