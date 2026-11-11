import { Suspense } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fr } from '../../lib/i18n/fr'
import { PHONE_QUERY } from '../../lib/moderationView'
import { renderWithProviders } from '../../testing/renderWithProviders'
import { ModerationRoute, PhoneModerationRedirect } from './ModerationRoute'

/**
 * One address, two screens: the queue opens on the phone's screen on a phone and on the laptop's
 * console elsewhere, and the person can swap them when the guess was wrong, once for this device.
 */

const SLUG = 'camille-et-sacha'
const STORAGE_KEY = 'eventslide.moderation.view'

/** Where the router is, so a redirect can be asserted by its destination. */
function Where() {
  const { pathname, search } = useLocation()
  return <p data-testid="where">{`${pathname}${search}`}</p>
}

const renderQueue = (route = `/admin/events/${SLUG}/moderation`) =>
  renderWithProviders(
    <Suspense fallback={null}>
      <Routes>
        <Route
          path="/admin/events/:slug/moderation"
          element={
            <>
              <ModerationRoute />
              <Where />
            </>
          }
        />
        <Route path="/admin/events/:slug/moderation/mobile" element={<PhoneModerationRedirect />} />
      </Routes>
    </Suspense>,
    { route },
  )

const onAPhone = () => {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) => ({ matches: query === PHONE_QUERY, media: query }) as MediaQueryList,
  )
}

const laptopHeading = () => screen.findByRole('heading', { level: 1, name: fr.moderation.title })
const phoneHeading = () =>
  screen.findByRole('heading', { level: 1, name: fr.mobileModeration.title })

describe('the moderation queue’s one address', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('opens the laptop’s console on a laptop', async () => {
    renderQueue()

    expect(await laptopHeading()).toBeVisible()
    expect(screen.queryByRole('heading', { name: fr.mobileModeration.title })).toBeNull()
  })

  it('opens the phone’s screen on a phone, with no second link to find', async () => {
    onAPhone()
    renderQueue()

    expect(await phoneHeading()).toBeVisible()
    expect(screen.queryByRole('heading', { name: fr.moderation.title })).toBeNull()
  })

  it('swaps to the phone’s screen on request, puts the keyboard on its title and remembers it', async () => {
    renderQueue()

    await userEvent.click(await screen.findByRole('button', { name: fr.moderation.openMobile }))

    const heading = await phoneHeading()
    await waitFor(() => {
      expect(heading).toHaveFocus()
    })
    expect(localStorage.getItem(STORAGE_KEY)).toBe('phone')
    expect(screen.getByTestId('where')).toHaveTextContent(`/admin/events/${SLUG}/moderation`)
  })

  it('swaps back to the laptop’s console from a phone the detection got wrong, and remembers it', async () => {
    onAPhone()
    renderQueue()

    await userEvent.click(
      await screen.findByRole('button', { name: fr.mobileModeration.openConsole }),
    )

    expect(await laptopHeading()).toBeVisible()
    expect(localStorage.getItem(STORAGE_KEY)).toBe('desktop')
  })

  it('opens the screen this device chose last time, whatever the detection says', async () => {
    localStorage.setItem(STORAGE_KEY, 'desktop')
    onAPhone()
    renderQueue()

    expect(await laptopHeading()).toBeVisible()
  })

  it('keeps the phone’s old address working, as the choice of the phone’s screen, query included', async () => {
    renderQueue(`/admin/events/${SLUG}/moderation/mobile?vue=messages`)

    expect(await phoneHeading()).toBeVisible()
    expect(screen.getByTestId('where')).toHaveTextContent(
      `/admin/events/${SLUG}/moderation?vue=messages`,
    )
    expect(localStorage.getItem(STORAGE_KEY)).toBe('phone')
  })
})
