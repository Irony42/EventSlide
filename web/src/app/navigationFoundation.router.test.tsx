import { describe, expect, it, vi } from 'vitest'
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useLocation } from 'react-router-dom'
import { announceSessionExpired } from '../lib/sessionExpiry'
import { fr } from '../lib/i18n/fr'
import { rememberGuestSession } from '../lib/guestSession'
import {
  aPublicEvent,
  aSessionUser,
  fakeApi,
  renderWithProviders,
} from '../testing/renderWithProviders'
import { AppRoutes } from './router'
import { SessionExpiredBanner } from './SessionExpiredBanner'
import type { SessionResponse } from '../lib/api/dto'

/**
 * Navigation pass, batch B: the foundations every other batch stands on, through the real route
 * table. The error screens' own behaviour is in `ErrorBoundary.test.tsx` and
 * `routerChunkFailure.test.tsx`; the transport's half of the expired session is in `http.test.ts`.
 */

const signedIn = (): SessionResponse => ({ authenticated: true, user: aSessionUser() })

const asHost = (route: string) => {
  const api = fakeApi({ session: vi.fn(async () => signedIn()) })
  return renderWithProviders(<AppRoutes />, { api, route })
}

const asVisitor = (route: string) => renderWithProviders(<AppRoutes />, { route })

describe('the 404 a signed-in host sees (H4)', () => {
  it('offers the host their own home, not the guest screen', async () => {
    asHost('/admin/evenements')

    expect(await screen.findByRole('link', { name: fr.shell.hostHome })).toHaveAttribute(
      'href',
      '/admin',
    )
    expect(screen.queryByRole('link', { name: fr.shell.notFoundHome })).toBeNull()
  })

  it('offers it on an address outside /admin as well, where the host mistyped the domain path', async () => {
    asHost('/tableau-de-bord')

    expect(await screen.findByRole('link', { name: fr.shell.hostHome })).toBeVisible()
  })

  it('offers the guest start to somebody who is not signed in', async () => {
    asVisitor('/admin/evenements')

    expect(await screen.findByRole('link', { name: fr.shell.notFoundHome })).toHaveAttribute(
      'href',
      '/',
    )
    expect(screen.queryByRole('link', { name: fr.shell.hostHome })).toBeNull()
  })

  it('asks the server nothing on the guest layout’s own dead ends', async () => {
    const { api } = asVisitor('/join/ABC123/de/trop')

    expect(await screen.findByRole('link', { name: fr.shell.notFoundHome })).toBeVisible()
    expect(api.session).not.toHaveBeenCalled()
  })
})

describe('/admin/events (H18)', () => {
  it('is the dashboard for a signed-in host, not a 404', async () => {
    asHost('/admin/events')

    expect(await screen.findByRole('heading', { name: fr.admin.events })).toBeVisible()
    expect(screen.queryByRole('heading', { name: fr.shell.notFoundTitle })).toBeNull()
  })

  it('goes through the sign-in for somebody who is not', async () => {
    asVisitor('/admin/events')

    expect(await screen.findByRole('heading', { name: fr.auth.title })).toBeVisible()
  })
})

describe('/e/:slug with nothing after it (A8)', () => {
  it('opens the upload page of the event instead of a 404', async () => {
    rememberGuestSession({ event: aPublicEvent(), displayName: null, privacyNotice: null })

    asVisitor('/e/camille-et-sacha')

    expect(await screen.findByRole('heading', { name: 'Camille & Sacha' })).toBeVisible()
    expect(screen.queryByRole('heading', { name: fr.shell.notFoundTitle })).toBeNull()
  })

  it('still answers a longer unknown path with the 404', async () => {
    asVisitor('/e/camille-et-sacha/album')

    expect(await screen.findByRole('heading', { name: fr.shell.notFoundTitle })).toBeVisible()
  })
})

describe('an expired session (H2)', () => {
  it('shows a banner over the page, which stays', async () => {
    asHost('/admin')
    expect(await screen.findByRole('heading', { name: fr.admin.events })).toBeVisible()

    act(() => announceSessionExpired())

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.shell.sessionExpired)
    expect(screen.getByRole('heading', { name: fr.admin.events })).toBeVisible()
  })

  it('does not drop the host back to the sign-in form by itself', async () => {
    const { api } = asHost('/admin')
    await screen.findByRole('heading', { name: fr.admin.events })
    const asked = vi.mocked(api.session).mock.calls.length

    act(() => announceSessionExpired())

    await screen.findByRole('alert')
    expect(screen.queryByRole('heading', { name: fr.auth.title })).toBeNull()
    // The answer already held is not thrown away and asked for again: that is what would redirect.
    expect(vi.mocked(api.session).mock.calls.length).toBe(asked)
  })

  it('is the notice and its link and nothing else: no stray text around them', async () => {
    asHost('/admin')
    await screen.findByRole('heading', { name: fr.admin.events })

    act(() => announceSessionExpired())

    const alert = await screen.findByRole('alert')
    expect(alert.parentElement?.textContent).toBe(
      `${fr.shell.sessionExpired} ${fr.shell.sessionExpiredAction}`,
    )
  })

  it('says nothing on the sign-in page, where there is no session to have lost', async () => {
    asVisitor('/login')
    await screen.findByRole('heading', { name: fr.auth.title })

    act(() => announceSessionExpired())

    expect(screen.queryByText(fr.shell.sessionExpired)).toBeNull()
  })

  it('takes the host to sign in and brings them back to the page they were on', async () => {
    asHost('/admin/events/new')
    await screen.findByRole('heading', { name: fr.admin.newEvent })
    act(() => announceSessionExpired())

    await userEvent.click(await screen.findByRole('link', { name: fr.shell.sessionExpiredAction }))
    await userEvent.type(await screen.findByLabelText(fr.auth.email), 'organisation@example.com')
    await userEvent.type(screen.getByLabelText(fr.auth.password), 'un-mot-de-passe-long')
    await userEvent.click(screen.getByRole('button', { name: fr.auth.submit }))

    expect(await screen.findByRole('heading', { name: fr.admin.newEvent })).toBeVisible()
    expect(screen.queryByText(fr.shell.sessionExpired)).toBeNull()
  })
})

describe('the sign-in link of the expired-session banner', () => {
  /** Shows what `LoginPage` would be handed, which is the whole contract with batch D. */
  const Arrival = () => <p data-testid="arrival">{JSON.stringify(useLocation().state)}</p>

  it('carries the path and the query of the page, in the `from` the sign-in already reads', async () => {
    renderWithProviders(
      <Routes>
        <Route path="/login" element={<Arrival />} />
        <Route path="*" element={<SessionExpiredBanner />} />
      </Routes>,
      { route: '/admin/site/audit?client=c-1&page=2' },
    )
    act(() => announceSessionExpired())

    await userEvent.click(await screen.findByRole('link', { name: fr.shell.sessionExpiredAction }))

    expect(await screen.findByTestId('arrival')).toHaveTextContent(
      JSON.stringify({ from: '/admin/site/audit?client=c-1&page=2' }),
    )
  })
})
