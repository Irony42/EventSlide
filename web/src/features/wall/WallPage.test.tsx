import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/http'
import { fr } from '../../lib/i18n/fr'
import type { WallResponse } from '../../lib/api/dto'
import { aWallItem, fakeApi, renderWithProviders } from '../../testing/renderWithProviders'
import { WallPage } from './WallPage'
import {
  ROUTE,
  PATH,
  streamSignals,
  aPopulatedWall,
  anEmptyWall,
  withoutJoinCode,
  withoutJoinUrl,
  wallSequence,
  prefersReducedMotion,
  useWallPageEnvironment,
} from './testing/wallPageHarness'

describe('WallPage', () => {
  useWallPageEnvironment()

  it('waits with a spinner while the first playlist is on its way', () => {
    const api = fakeApi({ wall: vi.fn(() => new Promise<WallResponse>(() => {})) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })

    expect(screen.getByRole('status')).toHaveTextContent(fr.app.loading)
  })

  it('invites the room to join while nothing has been published yet', async () => {
    const api = fakeApi({ wall: wallSequence(anEmptyWall()) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })

    const invitation = await screen.findByTestId('wall-empty')

    // The wall is the invitation for the first twenty minutes of the party: the event,
    // the code that gets read out across a table, and a QR drawn inline rather than
    // fetched from anywhere.
    expect(within(invitation).getByRole('heading', { name: 'Camille & Sacha' })).toBeVisible()
    expect(within(invitation).getByText('H7K2QM')).toBeVisible()
    expect(within(invitation).getByTitle(fr.wall.qrTitle)).toBeInTheDocument()
  })

  it('still invites the room when the server presents no join code', async () => {
    const api = fakeApi({ wall: wallSequence(withoutJoinCode(anEmptyWall())) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })

    const invitation = await screen.findByTestId('wall-empty')

    expect(within(invitation).getByText(fr.wall.empty)).toBeVisible()
    expect(within(invitation).queryByTitle(fr.wall.qrTitle)).not.toBeInTheDocument()
  })

  it('draws no QR when the server sends a code but no link for it', async () => {
    // The pair arrives from one presenter, so this is not a deployment the product has —
    // it is the one state in which the browser would be tempted to fill the gap from
    // `window.location.origin`, and the assertion is that it does not. A QR for the
    // address this projector happens to be on is §9 trap 1: the characters read right and
    // the link goes nowhere a guest can follow.
    const api = fakeApi({ wall: wallSequence(withoutJoinUrl(anEmptyWall())) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })

    const invitation = await screen.findByTestId('wall-empty')

    expect(within(invitation).getByText(fr.wall.empty)).toBeVisible()
    expect(within(invitation).queryByTitle(fr.wall.qrTitle)).not.toBeInTheDocument()
    expect(screen.queryByTestId('wall-join')).not.toBeInTheDocument()
  })

  it('reserves the corner for a join card only while it has a whole one to show', async () => {
    // `data-wall-chrome` is what makes the polaroid lay its row out inside what the card
    // leaves free — 362px of overlap if it does not. So the attribute has to follow the
    // card that is actually on screen, not the code alone.
    const api = fakeApi({ wall: wallSequence(withoutJoinUrl(aPopulatedWall())) })
    const { container } = renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })

    await screen.findByTestId('wall-slide')

    expect(screen.queryByTestId('wall-join')).not.toBeInTheDocument()
    expect(container.querySelector('[data-wall-chrome]')).toBeNull()
  })

  it('puts the photo, its caption and its author on the screen', async () => {
    const api = fakeApi({ wall: wallSequence(aPopulatedWall()) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })

    const slide = await screen.findByTestId('wall-slide')

    expect(within(slide).getByText('Les confettis')).toBeVisible()
    expect(within(slide).getByText('Léa')).toBeVisible()
    // The alt is the caption and the author. 1.0 used the stored filename, which reads
    // aloud as IMG_4821.jpg.
    expect(within(slide).getByRole('img')).toHaveAccessibleName(
      `Les confettis — ${fr.wall.photoBy('Léa')}`,
    )
  })

  it('says what to do next when the first load fails, instead of going black', async () => {
    const api = fakeApi({ wall: vi.fn(() => Promise.reject(new ApiError(500, 'unknown'))) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })

    const failure = await screen.findByRole('alert')

    expect(failure).toHaveTextContent(fr.errors.unknown)
    expect(failure).toHaveTextContent(fr.wall.errorHint)
  })

  it('shows a newly published photo when the stream signals a change', async () => {
    const api = fakeApi({
      wall: wallSequence(
        anEmptyWall(),
        aPopulatedWall({ revision: 'rev-2', items: [aWallItem({ caption: 'La première danse' })] }),
      ),
    })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })

    await screen.findByTestId('wall-empty')
    await streamSignals('photo.moderated')

    const slide = await screen.findByTestId('wall-slide')
    expect(within(slide).getByText('La première danse')).toBeVisible()
  })

  it('says the first-photo line under the first photo of the evening, sent to an empty wall', async () => {
    const first = aWallItem({ caption: 'Les confettis', authorName: 'Julie', firstFromGuest: true })
    const api = fakeApi({
      wall: wallSequence(anEmptyWall(), aPopulatedWall({ revision: 'rev-2', items: [first] })),
    })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })

    await screen.findByTestId('wall-empty')
    await streamSignals('photo.moderated')

    const slide = await screen.findByTestId('wall-slide')
    expect(within(slide).getByText(fr.wall.firstPhotoOf('Julie'))).toBeVisible()
  })

  it('says nothing about a first photo when the page loads on a populated wall', async () => {
    const first = aWallItem({ caption: 'Les confettis', authorName: 'Julie', firstFromGuest: true })
    const api = fakeApi({ wall: wallSequence(aPopulatedWall({ items: [first] })) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })

    const slide = await screen.findByTestId('wall-slide')
    expect(within(slide).getByText('Les confettis')).toBeVisible()
    expect(within(slide).queryByText(fr.wall.firstPhotoOf('Julie'))).not.toBeInTheDocument()
  })

  it('names the photo on screen, so the slide the room is looking at can be identified', async () => {
    const api = fakeApi({ wall: wallSequence(aPopulatedWall()) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })

    const slide = await screen.findByTestId('wall-slide')

    // The position is derived from the playlist and stored nowhere, so this attribute is
    // the only account of it: it is what two projectors in one room are compared on.
    expect(slide).toHaveAttribute('data-photo-id', 'photo-1')
  })

  it('does not hand the screen to a newly published photo while the room is mid-slide', async () => {
    // The photo a guest just sent arrives at the head of the playlist, and the head is
    // where a wall that has not changed slide yet was sitting. The room was looking at
    // something; publishing must not take it away — the fresh photo comes round next.
    const onScreen = aWallItem({ id: 'photo-1', caption: 'Les confettis' })
    const alsoPublished = aWallItem({ id: 'photo-2', caption: 'Le gâteau' })
    const api = fakeApi({
      wall: wallSequence(
        aPopulatedWall({ items: [onScreen, alsoPublished] }),
        aPopulatedWall({
          revision: 'rev-2',
          items: [
            aWallItem({ id: 'photo-3', caption: 'La première danse' }),
            onScreen,
            alsoPublished,
          ],
        }),
      ),
    })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })

    expect(await screen.findByTestId('wall-slide')).toHaveAttribute('data-photo-id', 'photo-1')

    await streamSignals('photo.moderated')

    expect(screen.getByTestId('wall-slide')).toHaveAttribute('data-photo-id', 'photo-1')
  })

  it('leaves the wall alone when a refetch comes back on the same revision', async () => {
    /**
     * The revision is the whole mechanism. A signal fires for anything happening at the
     * event — a guest joining, a photo submitted for moderation — and each one provokes
     * one refetch. The second answer here carries a different photo under the *same*
     * revision, which a real server would never do; it is the only way to prove the
     * client trusts the revision rather than the payload. Without that comparison the
     * wall jumps every time anything happens in the room.
     */
    const wall = wallSequence(
      aPopulatedWall(),
      aPopulatedWall({ items: [aWallItem({ id: 'photo-2', caption: 'Le gâteau' })] }),
    )
    renderWithProviders(<WallPage />, { api: fakeApi({ wall }), route: ROUTE, path: PATH })

    await screen.findByTestId('wall-slide')
    await streamSignals('guest.joined')

    await waitFor(() => expect(wall).toHaveBeenCalledTimes(2))
    expect(within(screen.getByTestId('wall-slide')).getByText('Les confettis')).toBeVisible()
    expect(screen.queryByText('Le gâteau')).not.toBeInTheDocument()
  })

  it('keeps the photos on screen when a refetch fails', async () => {
    let call = 0
    const wall = vi.fn(async (): Promise<WallResponse> => {
      call += 1
      if (call === 1) return aPopulatedWall()
      throw ApiError.network()
    })
    renderWithProviders(<WallPage />, { api: fakeApi({ wall }), route: ROUTE, path: PATH })

    await screen.findByTestId('wall-slide')
    await streamSignals('photo.moderated')

    await waitFor(() => expect(wall).toHaveBeenCalledTimes(2))
    // A venue's network drops several times an evening. The room keeps its photos.
    expect(screen.getByTestId('wall-slide')).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('floats a capped number of reactions and asks for no playlist', async () => {
    const wall = wallSequence(aPopulatedWall())
    renderWithProviders(<WallPage />, { api: fakeApi({ wall }), route: ROUTE, path: PATH })

    await screen.findByTestId('wall-slide')
    for (let sent = 0; sent < 12; sent += 1) await streamSignals('reaction.added')

    // Capped by construction: an eight-hour reception sends thousands of these, and
    // 1.0's confetti grew a node for every one of them.
    expect(screen.getAllByTestId('wall-reaction')).toHaveLength(8)
    // A reaction changes no photo, so it must not provoke a wall read.
    expect(wall).toHaveBeenCalledTimes(1)
  })

  it('shows no reactions when the viewer asked for no motion', async () => {
    prefersReducedMotion()
    const api = fakeApi({ wall: wallSequence(aPopulatedWall()) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })

    await screen.findByTestId('wall-slide')
    await streamSignals('reaction.added')

    expect(screen.queryByTestId('wall-reaction')).not.toBeInTheDocument()
  })
})
