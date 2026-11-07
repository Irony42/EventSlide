import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { fr } from '../../lib/i18n/fr'
import { fakeApi, renderWithProviders } from '../../testing/renderWithProviders'
import { WallPage } from './WallPage'
import {
  ROUTE,
  PATH,
  aPopulatedWall,
  somePhotos,
  wallSequence,
  useWallPageEnvironment,
  alreadyFullscreen,
} from './testing/wallPageHarness'

describe('WallPage', () => {
  useWallPageEnvironment()

  it('pauses and resumes for a host who presses the space bar', async () => {
    const api = fakeApi({ wall: wallSequence(aPopulatedWall({ items: somePhotos(3) })) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
    await screen.findByTestId('wall-slide')

    await userEvent.keyboard(' ')
    expect(screen.getByText(fr.wall.paused)).toBeVisible()

    await userEvent.keyboard(' ')
    expect(screen.queryByText(fr.wall.paused)).not.toBeInTheDocument()
  })

  it('steps to the next photo when the host presses the right arrow', async () => {
    const api = fakeApi({ wall: wallSequence(aPopulatedWall({ items: somePhotos(3) })) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
    await screen.findByTestId('wall-slide')

    await userEvent.keyboard('{ArrowRight}')

    expect(within(screen.getByTestId('wall-slide')).getByText('Photo 1')).toBeVisible()
  })

  it('explains its keyboard shortcuts when the host presses the question mark', async () => {
    const api = fakeApi({ wall: wallSequence(aPopulatedWall()) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
    await screen.findByTestId('wall-slide')

    await userEvent.keyboard('?')

    expect(await screen.findByRole('dialog')).toHaveTextContent(fr.wall.shortcutsHint)
  })

  it('says how to leave the wall, and draws no exit control for a guest to press by mistake (A5)', async () => {
    // There is deliberately no on-screen exit: the console opens the wall in a tab of its
    // own, and the host who walks up to the projector is told how to close it.
    const api = fakeApi({ wall: wallSequence(aPopulatedWall()) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
    await screen.findByTestId('wall-slide')
    expect(screen.queryAllByRole('link')).toHaveLength(0)

    await userEvent.keyboard('?')

    expect(await screen.findByRole('dialog')).toHaveTextContent(fr.wall.leaveHint)
  })

  it('puts the projector into fullscreen when the host presses F', async () => {
    const request = vi.spyOn(document.documentElement, 'requestFullscreen')
    const api = fakeApi({ wall: wallSequence(aPopulatedWall()) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
    await screen.findByTestId('wall-slide')

    await userEvent.keyboard('f')

    // The browser API is the boundary here: asking for fullscreen is the whole of the
    // observable effect, the same way a use-case call is for a screen that talks to the
    // server.
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('brings the projector back out of fullscreen when the host presses F again', async () => {
    alreadyFullscreen()
    const exit = vi.spyOn(document, 'exitFullscreen')
    const api = fakeApi({ wall: wallSequence(aPopulatedWall()) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
    await screen.findByTestId('wall-slide')

    await userEvent.keyboard('f')

    expect(exit).toHaveBeenCalledTimes(1)
  })

  it('keeps the wall up when leaving fullscreen fails', async () => {
    alreadyFullscreen()
    vi.spyOn(document, 'exitFullscreen').mockRejectedValue(new Error('Not allowed'))
    const api = fakeApi({ wall: wallSequence(aPopulatedWall()) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
    await screen.findByTestId('wall-slide')

    await userEvent.keyboard('f')

    expect(screen.getByTestId('wall-slide')).toBeVisible()
  })

  it('ignores F for leaving fullscreen on a browser that cannot leave it', async () => {
    alreadyFullscreen()
    Reflect.deleteProperty(document, 'exitFullscreen')
    const api = fakeApi({ wall: wallSequence(aPopulatedWall()) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
    await screen.findByTestId('wall-slide')

    await userEvent.keyboard('f')

    // A kiosk browser can put a page into fullscreen and implement no way back out.
    // Calling the method anyway would take the photos off the screen with a TypeError.
    expect(screen.getByTestId('wall-slide')).toBeVisible()
  })

  it('keeps the wall up when the projector’s browser refuses fullscreen', async () => {
    vi.spyOn(document.documentElement, 'requestFullscreen').mockRejectedValue(
      new Error('Permission denied'),
    )
    const api = fakeApi({ wall: wallSequence(aPopulatedWall()) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
    await screen.findByTestId('wall-slide')

    await userEvent.keyboard('f')

    // A projector browser may refuse without a user gesture it recognises. That is not
    // worth taking the photos off the screen for, and an unhandled rejection would.
    expect(screen.getByTestId('wall-slide')).toBeVisible()
  })

  it('ignores F on a browser that has no fullscreen at all', async () => {
    Reflect.deleteProperty(document.documentElement, 'requestFullscreen')
    const api = fakeApi({ wall: wallSequence(aPopulatedWall()) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
    await screen.findByTestId('wall-slide')

    await userEvent.keyboard('f')

    // Some in-app and kiosk browsers implement none of it. Calling it anyway would take
    // the whole wall down with a TypeError.
    expect(screen.getByTestId('wall-slide')).toBeVisible()
  })

  it('puts the shortcuts panel away before it starts hiding the join reminder', async () => {
    const api = fakeApi({ wall: wallSequence(aPopulatedWall()) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
    await screen.findByTestId('wall-slide')
    await userEvent.keyboard('?')
    await screen.findByRole('dialog')
    // The host looks back at the photo, so the panel's close button no longer has the
    // keyboard: Escape now reaches the wall itself.
    await userEvent.click(screen.getByTestId('wall-slide'))

    await userEvent.keyboard('{Escape}')

    // One key, the obvious meaning: put away whatever is covering the photos — starting
    // with the thing that covers most of them.
    expect(screen.queryByText(fr.wall.shortcutsHint)).not.toBeInTheDocument()
    expect(screen.getByText('H7K2QM')).toBeVisible()
  })

  it('closes the shortcuts panel from its own close button', async () => {
    const api = fakeApi({ wall: wallSequence(aPopulatedWall()) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
    await screen.findByTestId('wall-slide')
    await userEvent.keyboard('?')
    await screen.findByRole('dialog')

    await userEvent.click(screen.getByRole('button', { name: fr.ui.dialogClose }))

    // The host who opened the panel with a key may well be holding a mouse by the time
    // they want it gone, and the panel covers the photos while it is up.
    expect(screen.queryByText(fr.wall.shortcutsHint)).not.toBeInTheDocument()
  })

  it('leaves the slideshow alone while the shortcuts panel has the keyboard', async () => {
    const api = fakeApi({ wall: wallSequence(aPopulatedWall({ items: somePhotos(3) })) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
    await screen.findByTestId('wall-slide')
    await userEvent.keyboard('?')
    await screen.findByRole('dialog')

    await userEvent.keyboard('{ArrowRight}')

    // The panel's own controls own the arrows while it is open. Stepping the wall behind
    // it would move the photo the host opened the panel to ask about.
    expect(within(screen.getByTestId('wall-slide')).getByText('Photo 0')).toBeVisible()
  })
})
