import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { AccountMenu } from './AccountMenu'
import { ApiError } from '../lib/http'
import { fr } from '../lib/i18n/fr'
import { aSessionUser, fakeApi, renderWithProviders } from '../testing/renderWithProviders'
import type { Api } from '../lib/api/client'
import type { SessionResponse } from '../lib/api/dto'

const signedIn = (overrides: Partial<Api> = {}): Api =>
  fakeApi({
    session: vi.fn(async (): Promise<SessionResponse> => ({
      authenticated: true,
      user: aSessionUser({ email: 'camille@example.org' }),
    })),
    ...overrides,
  })

/** Real routes: "went to the sign-in" is what the person ends up looking at. */
const renderMenu = (api: Api) =>
  renderWithProviders(
    <Routes>
      <Route
        path="/admin"
        element={
          <>
            <AccountMenu />
            {/* What follows it in the real header: the language picker. */}
            <button type="button">Après</button>
          </>
        }
      />
      <Route path="/login" element={<p>Écran de connexion</p>} />
      <Route path="/admin/password" element={<p>Écran de mot de passe</p>} />
    </Routes>,
    { api, route: '/admin' },
  )

const trigger = () => screen.findByRole('button', { name: fr.auth.accountMenu })

const open = async () => {
  await userEvent.click(await trigger())
}

describe('AccountMenu: who sees it', () => {
  it('shows nothing to somebody who is not signed in', async () => {
    const api = fakeApi()
    renderMenu(api)

    await waitFor(() => expect(api.session).toHaveBeenCalled())

    expect(screen.queryByRole('button', { name: fr.auth.accountMenu })).toBeNull()
  })

  it('shows nothing while it does not yet know, rather than a menu that may be wrong', () => {
    renderMenu(fakeApi({ session: vi.fn(() => new Promise<never>(() => undefined)) }))

    expect(screen.queryByRole('button', { name: fr.auth.accountMenu })).toBeNull()
  })

  it('shows nothing when the session could not be asked for', async () => {
    const api = fakeApi({ session: vi.fn(() => Promise.reject(ApiError.network())) })
    renderMenu(api)

    await waitFor(() => expect(api.session).toHaveBeenCalled())

    expect(screen.queryByRole('button', { name: fr.auth.accountMenu })).toBeNull()
  })

  it('shows a closed menu to a signed-in account, and says which account', async () => {
    renderMenu(signedIn())

    const button = await trigger()
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(fr.auth.logout)).toBeNull()

    await userEvent.click(button)

    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(fr.auth.accountSignedInAs('camille@example.org'))).toBeVisible()
  })
})

describe('AccountMenu: what it offers', () => {
  it('offers the password page, signing out, and signing out everywhere', async () => {
    renderMenu(signedIn())
    await open()

    expect(screen.getByRole('link', { name: fr.auth.changePassword })).toHaveAttribute(
      'href',
      '/admin/password',
    )
    expect(screen.getByRole('button', { name: fr.auth.logout })).toBeVisible()
    expect(screen.getByRole('button', { name: fr.auth.logoutEverywhere })).toBeVisible()
  })

  it('opens and closes from the control that owns it, and says which list it controls', async () => {
    renderMenu(signedIn())
    const button = await trigger()

    await userEvent.click(button)
    const panelId = button.getAttribute('aria-controls')
    expect(panelId).not.toBeNull()
    expect(document.getElementById(panelId ?? '')).toContainElement(
      screen.getByRole('button', { name: fr.auth.logout }),
    )

    await userEvent.click(button)
    expect(screen.queryByRole('button', { name: fr.auth.logout })).toBeNull()
  })

  it('closes on Escape and gives the keyboard back to the control that opened it', async () => {
    renderMenu(signedIn())
    await open()
    await userEvent.tab()
    expect(screen.getByRole('link', { name: fr.auth.changePassword })).toHaveFocus()

    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('button', { name: fr.auth.logout })).toBeNull()
    expect(screen.getByRole('button', { name: fr.auth.accountMenu })).toHaveFocus()
  })

  it('closes when the pointer goes down anywhere else', async () => {
    renderMenu(signedIn())
    await open()

    await userEvent.click(document.body)

    expect(screen.queryByRole('button', { name: fr.auth.logout })).toBeNull()
  })

  it('stays open for a press inside it, which is how it can be used at all', async () => {
    renderMenu(signedIn())
    await open()

    await userEvent.click(screen.getByText(fr.auth.accountSignedInAs('camille@example.org')))

    expect(screen.getByRole('button', { name: fr.auth.logout })).toBeVisible()
  })

  it('closes when the keyboard moves on past its last entry', async () => {
    renderMenu(signedIn())
    await open()

    await userEvent.tab() // password link
    await userEvent.tab() // sign out
    await userEvent.tab() // sign out everywhere
    await userEvent.tab() // out, onto whatever follows
    expect(screen.getByRole('button', { name: 'Après' })).toHaveFocus()

    expect(screen.queryByRole('button', { name: fr.auth.logout })).toBeNull()
  })

  it('goes to the password page when that entry is followed, and closes', async () => {
    renderMenu(signedIn())
    await open()

    await userEvent.click(screen.getByRole('link', { name: fr.auth.changePassword }))

    expect(await screen.findByText('Écran de mot de passe')).toBeVisible()
  })
})

describe('AccountMenu: signing out', () => {
  it('ends the session on the server, then goes to the sign-in', async () => {
    const api = signedIn()
    renderMenu(api)
    await open()

    await userEvent.click(screen.getByRole('button', { name: fr.auth.logout }))

    expect(await screen.findByText('Écran de connexion')).toBeVisible()
    expect(api.logout).toHaveBeenCalledTimes(1)
    expect(api.revokeOtherSessions).not.toHaveBeenCalled()
  })

  it('does not leave until the server has answered, so a failure leaves nothing half-done', async () => {
    let finish: () => void = () => undefined
    const api = signedIn({
      logout: vi.fn(() => new Promise<void>((resolve) => (finish = resolve))),
    })
    renderMenu(api)
    await open()

    await userEvent.click(screen.getByRole('button', { name: fr.auth.logout }))
    await waitFor(() => expect(api.logout).toHaveBeenCalled())
    expect(screen.queryByText('Écran de connexion')).toBeNull()

    finish()
    expect(await screen.findByText('Écran de connexion')).toBeVisible()
  })

  it('says so, and stays where it is, when the server could not be reached', async () => {
    const api = signedIn({ logout: vi.fn(() => Promise.reject(ApiError.network())) })
    renderMenu(api)
    await open()

    await userEvent.click(screen.getByRole('button', { name: fr.auth.logout }))

    expect(await screen.findByText(fr.errors.network)).toBeVisible()
    expect(screen.queryByText('Écran de connexion')).toBeNull()
  })
})

describe('AccountMenu: signing out everywhere', () => {
  const choose = async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: fr.auth.logoutEverywhere }))
    return screen.findByRole('dialog', { name: fr.auth.logoutEverywhereTitle })
  }

  it('asks first, and says what it will do, this device included', async () => {
    const api = signedIn()
    renderMenu(api)

    const dialog = await choose()

    expect(within(dialog).getByText(fr.auth.logoutEverywhereHint)).toBeVisible()
    expect(fr.auth.logoutEverywhereHint).toContain('celui-ci compris')
    // Nothing has happened yet: the question is the whole point.
    expect(api.revokeOtherSessions).not.toHaveBeenCalled()
    expect(api.logout).not.toHaveBeenCalled()
  })

  it('puts the keyboard on the safe answer, so a reflexive Enter cancels', async () => {
    renderMenu(signedIn())

    const dialog = await choose()

    expect(within(dialog).getByRole('button', { name: fr.app.cancel })).toHaveFocus()
  })

  it('does nothing when the person changes their mind', async () => {
    const api = signedIn()
    renderMenu(api)
    const dialog = await choose()

    await userEvent.click(within(dialog).getByRole('button', { name: fr.app.cancel }))

    expect(screen.queryByRole('dialog', { name: fr.auth.logoutEverywhereTitle })).toBeNull()
    expect(api.revokeOtherSessions).not.toHaveBeenCalled()
    expect(api.logout).not.toHaveBeenCalled()
    expect(screen.queryByText('Écran de connexion')).toBeNull()
  })

  it('revokes every other session, then ends this one, in that order, then goes to the sign-in', async () => {
    const api = signedIn()
    renderMenu(api)
    const dialog = await choose()

    await userEvent.click(within(dialog).getByRole('button', { name: fr.auth.logoutEverywhere }))

    expect(await screen.findByText('Écran de connexion')).toBeVisible()
    // The first call needs the session the second destroys: the order is the feature.
    const revoked = vi.mocked(api.revokeOtherSessions).mock.invocationCallOrder[0] ?? Infinity
    const loggedOut = vi.mocked(api.logout).mock.invocationCallOrder[0] ?? -Infinity
    expect(revoked).toBeLessThan(loggedOut)
    expect(api.revokeOtherSessions).toHaveBeenCalledTimes(1)
    expect(api.logout).toHaveBeenCalledTimes(1)
  })

  it('does not end this session when the others could not be revoked, and says so', async () => {
    const api = signedIn({
      revokeOtherSessions: vi.fn(() => Promise.reject(new ApiError(500, 'unknown'))),
    })
    renderMenu(api)
    const dialog = await choose()

    await userEvent.click(within(dialog).getByRole('button', { name: fr.auth.logoutEverywhere }))

    expect(await screen.findByText(fr.errors.unknown)).toBeVisible()
    // Half of "everywhere" would be worse than none: the person would believe it done.
    expect(api.logout).not.toHaveBeenCalled()
    expect(screen.queryByText('Écran de connexion')).toBeNull()
  })

  it('says so, and stays, when this session could not be ended after the others were', async () => {
    const api = signedIn({ logout: vi.fn(() => Promise.reject(ApiError.network())) })
    renderMenu(api)
    const dialog = await choose()

    await userEvent.click(within(dialog).getByRole('button', { name: fr.auth.logoutEverywhere }))

    expect(await screen.findByText(fr.errors.network)).toBeVisible()
    expect(api.revokeOtherSessions).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Écran de connexion')).toBeNull()
  })
})
