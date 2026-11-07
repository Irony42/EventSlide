import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { fr } from '../../lib/i18n/fr'
import { fakeApi, renderWithProviders } from '../../testing/renderWithProviders'
import { QR_HIDDEN_MS, WallPage } from './WallPage'
import {
  LOCALE_TABLES,
  ROUTE,
  PATH,
  theWall,
  streamOpens,
  streamSignals,
  aPopulatedWall,
  anEmptyWall,
  withoutJoinCode,
  wallSequence,
  useWallPageEnvironment,
} from './testing/wallPageHarness'

describe('WallPage', () => {
  useWallPageEnvironment()

  it('keeps a join reminder in the corner and puts it away with Q', async () => {
    const api = fakeApi({ wall: wallSequence(aPopulatedWall()) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
    await screen.findByTestId('wall-slide')

    // Somebody arriving at 23:00 has only the screen to read.
    expect(screen.getByText('H7K2QM')).toBeVisible()

    await userEvent.keyboard('q')

    expect(screen.queryByText('H7K2QM')).not.toBeInTheDocument()
  })

  describe('the join card and the keys (MUR-5)', () => {
    it('is not taken away by Escape, which is the key a host presses to leave fullscreen', async () => {
      // The help said Escape leaves fullscreen, and the same key hid the QR for the whole
      // night with nothing to bring it back: two presses while setting the projector up took
      // the only door a late guest has off the wall.
      const api = fakeApi({ wall: wallSequence(aPopulatedWall()) })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
      await screen.findByTestId('wall-slide')

      await userEvent.keyboard('{Escape}{Escape}')

      expect(screen.getByText('H7K2QM')).toBeVisible()
      expect(theWall()).toHaveAttribute('data-wall-chrome', 'corner')
    })

    it('comes back with a second Q', async () => {
      const api = fakeApi({ wall: wallSequence(aPopulatedWall()) })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
      await screen.findByTestId('wall-slide')

      await userEvent.keyboard('q')
      expect(screen.queryByText('H7K2QM')).not.toBeInTheDocument()
      await userEvent.keyboard('q')

      expect(screen.getByText('H7K2QM')).toBeVisible()
    })

    it('comes back by itself after ten minutes, because nobody is at the projector', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      const api = fakeApi({ wall: wallSequence(aPopulatedWall()) })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
      await screen.findByTestId('wall-slide')
      await userEvent.keyboard('q')
      expect(screen.queryByText('H7K2QM')).not.toBeInTheDocument()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(QR_HIDDEN_MS - 1_000)
      })
      expect(screen.queryByText('H7K2QM')).not.toBeInTheDocument()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000)
      })
      expect(screen.getByText('H7K2QM')).toBeVisible()
    })

    it('comes back by itself after the button hid it, too', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      const api = fakeApi({ wall: wallSequence(aPopulatedWall()) })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
      await screen.findByTestId('wall-slide')
      await userEvent.click(screen.getByRole('button', { name: fr.wall.dismissJoinCard }))
      expect(screen.queryByText('H7K2QM')).not.toBeInTheDocument()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(QR_HIDDEN_MS + 1_000)
      })

      expect(screen.getByText('H7K2QM')).toBeVisible()
    })

    it('does nothing on the empty wall, so the first photo still arrives with its card', async () => {
      // The empty wall's invitation is full-screen and Q does not touch it; a flag flipped
      // there would hide the corner card for ten minutes once the first photo shows up.
      const api = fakeApi({
        wall: wallSequence(anEmptyWall(), aPopulatedWall({ revision: 'rev-2' })),
      })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
      await screen.findByTestId('wall-empty')
      await streamOpens()

      await userEvent.keyboard('q')
      await streamSignals('photo.published')

      expect(await screen.findByText('H7K2QM')).toBeVisible()
      expect(screen.getByTestId('wall-slide')).toBeVisible()
    })

    it.each(LOCALE_TABLES)('lists Q in the shortcuts panel in %s', async (code, dictionary) => {
      const api = fakeApi({ wall: wallSequence(aPopulatedWall()) })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH, locale: code })
      await screen.findByTestId('wall-slide')

      await userEvent.keyboard('?')

      expect(await screen.findByRole('dialog')).toHaveTextContent(dictionary.wall.shortcutsHint)
      expect(dictionary.wall.shortcutsHint).toMatch(/\bQ\b/)
    })
  })

  /**
   * The corner the invitation occupies, declared so layouts can lay out around it.
   *
   * The join card is the wall's default state and sits bottom-right. Layouts that centre
   * a caption in the bottom band printed the guest's own words underneath it: measured on
   * a 1920x1080 projector, the polaroid's third caption lost 362px of its box and the
   * split's right caption 42px, both cut mid-word. A caption is content and the card is
   * chrome, so the card is what the wall reserves around — and because the card is
   * dismissible, the reservation is given back with it rather than being a standing tax
   * on a layout's width.
   *
   * The reservation itself is CSS; what is asserted here is the decision that drives it,
   * which is the half that can silently stop happening. The pixels are the visual suite's.
   */
  it('tells its layouts the corner is spoken for while the invitation is up', async () => {
    const api = fakeApi({ wall: wallSequence(aPopulatedWall()) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
    await screen.findByTestId('wall-slide')

    expect(theWall()).toHaveAttribute('data-wall-chrome', 'corner')
  })

  it('gives the corner back to the layout when the host puts the invitation away', async () => {
    const api = fakeApi({ wall: wallSequence(aPopulatedWall()) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
    await screen.findByTestId('wall-slide')

    await userEvent.keyboard('q')

    // A host who wants the full width of a split or a polaroid presses one key for it.
    expect(theWall()).not.toHaveAttribute('data-wall-chrome')
  })

  it('reserves nothing on a wall with no join code to show', async () => {
    // The shape a server build that does not present a code sends, which is `aWallResponse`
    // with the key removed rather than set to `undefined` — see `withoutJoinCode`.
    const api = fakeApi({ wall: wallSequence(withoutJoinCode(aPopulatedWall())) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
    await screen.findByTestId('wall-slide')

    // A server build that does not present the code leaves the corner free, and a layout
    // that narrowed itself for a card nobody can see would be giving up width for nothing.
    expect(theWall()).not.toHaveAttribute('data-wall-chrome')
  })

  it('lets a host dismiss the join reminder with the button as well', async () => {
    const api = fakeApi({ wall: wallSequence(aPopulatedWall()) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
    await screen.findByTestId('wall-slide')

    await userEvent.click(screen.getByRole('button', { name: fr.wall.dismissJoinCard }))

    expect(screen.queryByText('H7K2QM')).not.toBeInTheDocument()
  })

  describe('where to type the code (MUR-7)', () => {
    it('names the address under the code in the corner card, from the join link host', async () => {
      const api = fakeApi({ wall: wallSequence(aPopulatedWall()) })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
      await screen.findByTestId('wall-slide')

      expect(screen.getByText(fr.wall.typeCodeAt('H7K2QM', 'photos.example'))).toBeVisible()
    })

    it('titles the corner card with what to do', async () => {
      const api = fakeApi({ wall: wallSequence(aPopulatedWall()) })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
      await screen.findByTestId('wall-slide')

      expect(screen.getByRole('heading', { name: fr.wall.sendPrompt })).toBeVisible()
    })

    it('names the address on the empty wall too', async () => {
      const api = fakeApi({ wall: wallSequence(anEmptyWall()) })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
      await screen.findByTestId('wall-empty')

      expect(screen.getByText(fr.wall.typeCodeAt('H7K2QM', 'photos.example'))).toBeVisible()
    })
  })
})
