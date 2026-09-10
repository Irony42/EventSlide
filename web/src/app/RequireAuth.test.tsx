import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { RequireAuth } from './RequireAuth'
import { ApiError } from '../lib/http'
import { fr } from '../lib/i18n/fr'
import { aSessionUser, fakeApi, renderWithProviders } from '../testing/renderWithProviders'
import type { Api } from '../lib/api/client'
import type { SessionResponse } from '../lib/api/dto'

const CONSOLE = 'Console de modération'

const renderGuarded = (api: Api) =>
  renderWithProviders(
    <Routes>
      <Route path="/login" element={<p>Connexion</p>} />
      <Route element={<RequireAuth />}>
        <Route path="/admin/events/mariage/moderation" element={<p>{CONSOLE}</p>} />
      </Route>
    </Routes>,
    { api, route: '/admin/events/mariage/moderation' },
  )

const signedIn = async (): Promise<SessionResponse> => ({
  authenticated: true,
  user: aSessionUser(),
})

describe('RequireAuth', () => {
  it('waits while the session resolves, without flashing the protected page', () => {
    const api = fakeApi({ session: vi.fn(() => new Promise<SessionResponse>(() => {})) })

    renderGuarded(api)

    expect(screen.getByRole('status')).toHaveTextContent(fr.shell.sessionChecking)
    expect(screen.queryByText(CONSOLE)).toBeNull()
    expect(screen.queryByText('Connexion')).toBeNull()
  })

  it('renders the protected page once the host is known', async () => {
    const api = fakeApi({ session: vi.fn(signedIn) })

    renderGuarded(api)

    expect(await screen.findByText(CONSOLE)).toBeVisible()
  })

  it('sends an anonymous visitor to the login page', async () => {
    renderGuarded(fakeApi())

    expect(await screen.findByText('Connexion')).toBeVisible()
    expect(screen.queryByText(CONSOLE)).toBeNull()
  })

  it('offers a retry when the session could not be asked for at all', async () => {
    const session = vi.fn(signedIn)
    session.mockRejectedValueOnce(ApiError.network())
    const api = fakeApi({ session })

    renderGuarded(api)

    // A dropped venue Wi-Fi must not read as "logged out": bouncing the host to the
    // login form makes them hunt for a password in the middle of an event.
    expect(await screen.findByText(fr.shell.sessionFailed)).toBeVisible()
    expect(screen.queryByText('Connexion')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: fr.app.retry }))

    expect(await screen.findByText(CONSOLE)).toBeVisible()
  })

  it('guards an explicit child as well as an outlet', async () => {
    const api = fakeApi({ session: vi.fn(signedIn) })

    renderWithProviders(
      <RequireAuth>
        <p>{CONSOLE}</p>
      </RequireAuth>,
      { api, route: '/admin' },
    )

    expect(await screen.findByText(CONSOLE)).toBeVisible()
  })
})
