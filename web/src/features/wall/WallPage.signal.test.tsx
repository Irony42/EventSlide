import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  aWallItem,
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
  prefersReducedMotion,
  useWallPageEnvironment,
} from './testing/wallPageHarness'

describe('WallPage', () => {
  useWallPageEnvironment()

  describe('the new-photo signal (spec 11)', () => {
    const signalOn = { newPhotoSignal: true }
    const first = aWallItem({ id: 'photo-1', authorName: 'Julie' })
    const second = aWallItem({ id: 'photo-2', authorName: 'Marc' })

    it('says nothing at the first read, however many photos are already there', async () => {
      const api = fakeApi({
        wall: wallSequence(aPopulatedWall({ ...signalOn, souvenirCount: 1, items: [first] })),
      })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })

      await screen.findByTestId('wall-slide')
      expect(screen.queryByTestId('new-photo-signal')).toBeNull()
    })

    it('announces a photo that became visible, without naming the guest', async () => {
      const api = fakeApi({
        wall: wallSequence(
          aPopulatedWall({ ...signalOn, souvenirCount: 1, items: [first] }),
          aPopulatedWall({
            ...signalOn,
            revision: 'rev-2',
            souvenirCount: 2,
            items: [second, first],
          }),
        ),
      })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
      await screen.findByTestId('wall-slide')

      await streamSignals('photo.moderated')

      const bubble = await screen.findByTestId('new-photo-signal')
      expect(bubble).toHaveTextContent('Nouvelle photo ajoutée')
      expect(bubble.textContent).not.toMatch(/Julie|Marc/)
    })

    it('stays silent for a send the total does not confirm, and when the switch is off', async () => {
      const off = fakeApi({
        wall: wallSequence(
          aPopulatedWall({ souvenirCount: null, items: [first] }),
          aPopulatedWall({ revision: 'rev-2', souvenirCount: null, items: [second, first] }),
        ),
      })
      const { unmount } = renderWithProviders(<WallPage />, { api: off, route: ROUTE, path: PATH })
      await screen.findByTestId('wall-slide')
      await streamSignals('photo.moderated')
      await screen.findByTestId('wall-slide')
      expect(screen.queryByTestId('new-photo-signal')).toBeNull()
      unmount()

      // Total went down: the 201st photo came back into the window after a deletion.
      const deleted = fakeApi({
        wall: wallSequence(
          aPopulatedWall({ ...signalOn, souvenirCount: 5, items: [first] }),
          aPopulatedWall({ ...signalOn, revision: 'rev-2', souvenirCount: 4, items: [second] }),
        ),
      })
      renderWithProviders(<WallPage />, { api: deleted, route: ROUTE, path: PATH })
      await screen.findByTestId('wall-slide')
      await streamSignals('photo.moderated')
      expect(screen.queryByTestId('new-photo-signal')).toBeNull()
    })
  })

  it('shows the souvenir total only when the host switched the counter on (spec 11)', async () => {
    const off = fakeApi({
      wall: wallSequence(aPopulatedWall({ souvenirCount: 1_234, souvenirCounter: false })),
    })
    const { unmount } = renderWithProviders(<WallPage />, { api: off, route: ROUTE, path: PATH })
    await screen.findByTestId('wall-slide')
    expect(screen.queryByTestId('souvenir-counter')).toBeNull()
    unmount()

    const on = fakeApi({
      wall: wallSequence(aPopulatedWall({ souvenirCount: 1_234, souvenirCounter: true })),
    })
    renderWithProviders(<WallPage />, { api: on, route: ROUTE, path: PATH })

    // The server's total, not the length of the one-item playlist.
    expect(await screen.findByTestId('souvenir-counter')).toHaveTextContent(/^1.234 souvenirs/)
  })

  it('takes the Ken Burns duration from the response, not from a constant', async () => {
    // 1.0 hardcoded a 20 s zoom beside a 10 s slide, so every image snapped back.
    //
    // Two photographs rather than one, because the zoom is declared only for a wall that
    // is going to change photo — see the single-photograph case below. On a one-photo
    // wall this test would pass whatever the response carried, which is the shape of
    // green that proves nothing.
    const api = fakeApi({
      wall: wallSequence(aWallResponse({ items: somePhotos(2), kenBurnsDurationMs: 12_345 })),
    })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })

    const slide = await screen.findByTestId('wall-slide')

    expect(slide.style.getPropertyValue('--wall-kenburns-duration')).toBe('12345ms')
    expect(slide).toHaveAttribute('data-motion', 'kenburns')
  })

  it('runs no Ken Burns animation at all when the viewer asked for no motion', async () => {
    prefersReducedMotion()
    const api = fakeApi({
      wall: wallSequence(aWallResponse({ items: somePhotos(2), kenBurnsDurationMs: 12_345 })),
    })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })

    const slide = await screen.findByTestId('wall-slide')

    // Removed rather than shortened: a 0.01 ms zoom with a fill mode still snaps to the
    // zoomed frame, and a projected zoom is the worst case for a vestibular disorder.
    expect(slide).toHaveAttribute('data-motion', 'still')
    expect(slide.style.getPropertyValue('--wall-kenburns-duration')).toBe('')
  })

  it('runs no Ken Burns animation on a wall holding a single photograph', async () => {
    const api = fakeApi({ wall: wallSequence(aPopulatedWall({ kenBurnsDurationMs: 12_345 })) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })

    const slide = await screen.findByTestId('wall-slide')

    // Every event's first ten minutes, and any evening whose host published once. The
    // zoom is `interval + CROSSFADE_MS` so that it can never finish under a photograph
    // still on screen, and a wall that is not advancing has no interval for that to be
    // true of: it ran off a cadence nobody was keeping and then held `scale(1.08)` until
    // the second photograph arrived. `useSlideshow` reports no cadence here for the same
    // reason it reports none for a paused wall, which is the one condition this reads.
    expect(slide).toHaveAttribute('data-motion', 'still')
    expect(slide.style.getPropertyValue('--wall-kenburns-duration')).toBe('')
  })
})
