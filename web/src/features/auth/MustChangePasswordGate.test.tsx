import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { MustChangePasswordGate } from './MustChangePasswordGate'
import { ApiError } from '../../lib/http'
import { fr } from '../../lib/i18n/fr'
import { aSessionUser, fakeApi, renderWithProviders } from '../../testing/renderWithProviders'
import type { Api } from '../../lib/api/client'
import type { SessionResponse } from '../../lib/api/dto'

const DASHBOARD = 'Tableau de bord'
const CHANGE_PASSWORD = 'Changer de mot de passe'

const sessionWith = (mustChangePassword: boolean) => async (): Promise<SessionResponse> => ({
  authenticated: true,
  user: aSessionUser({ mustChangePassword }),
})

const renderGated = (api: Api, route = '/admin') =>
  renderWithProviders(
    <Routes>
      <Route element={<MustChangePasswordGate />}>
        <Route path="/admin" element={<p>{DASHBOARD}</p>} />
        <Route path="/admin/events/mariage/moderation" element={<p>Modération</p>} />
        <Route path="/admin/password" element={<p>{CHANGE_PASSWORD}</p>} />
      </Route>
    </Routes>,
    { api, route },
  )

describe('MustChangePasswordGate', () => {
  it('waits for the session instead of flashing the page it may redirect away from', () => {
    const api = fakeApi({ session: vi.fn(() => new Promise<SessionResponse>(() => {})) })

    renderGated(api)

    expect(screen.getByRole('status')).toHaveTextContent(fr.shell.sessionChecking)
    expect(screen.queryByText(DASHBOARD)).toBeNull()
  })

  it('sends a moderator who has never chosen a password to the change screen', async () => {
    const api = fakeApi({ session: vi.fn(sessionWith(true)) })

    renderGated(api)

    expect(await screen.findByText(CHANGE_PASSWORD)).toBeVisible()
    expect(screen.queryByText(DASHBOARD)).toBeNull()
  })

  it('redirects from every admin address, not only the dashboard', async () => {
    // An invited moderator must not be able to publish photos to a room of two hundred
    // people with a password somebody else chose and e-mailed them.
    const api = fakeApi({ session: vi.fn(sessionWith(true)) })

    renderGated(api, '/admin/events/mariage/moderation')

    expect(await screen.findByText(CHANGE_PASSWORD)).toBeVisible()
    expect(screen.queryByText('Modération')).toBeNull()
  })

  it('leaves the change screen itself reachable, or the redirect would loop', async () => {
    const api = fakeApi({ session: vi.fn(sessionWith(true)) })

    renderGated(api, '/admin/password')

    expect(await screen.findByText(CHANGE_PASSWORD)).toBeVisible()
  })

  it('lets a host with a password of their own through', async () => {
    const api = fakeApi({ session: vi.fn(sessionWith(false)) })

    renderGated(api)

    expect(await screen.findByText(DASHBOARD)).toBeVisible()
  })

  it('does not lock a host out because the session could not be asked for', async () => {
    // RequireAuth above owns what an unreachable session means. Treating "could not
    // ask" as "must change password" would take the console away mid-event over one
    // dropped request on venue Wi-Fi.
    const api = fakeApi({ session: vi.fn(() => Promise.reject(ApiError.network())) })

    renderGated(api)

    expect(await screen.findByText(DASHBOARD)).toBeVisible()
  })

  it('guards an explicit child as well as an outlet', async () => {
    const api = fakeApi({ session: vi.fn(sessionWith(false)) })

    renderWithProviders(
      <MustChangePasswordGate>
        <p>{DASHBOARD}</p>
      </MustChangePasswordGate>,
      { api, route: '/admin' },
    )

    expect(await screen.findByText(DASHBOARD)).toBeVisible()
  })
})
