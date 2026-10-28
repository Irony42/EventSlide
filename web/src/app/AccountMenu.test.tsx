import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useLocation } from 'react-router-dom'
import { AccountMenu } from './AccountMenu'
import { ApiError } from '../lib/http'
import { fr } from '../lib/i18n/fr'
import {
  aClientLimits,
  aSessionUser,
  anAbout,
  fakeApi,
  renderWithProviders,
} from '../testing/renderWithProviders'
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

  it('offers the list of events, the way to a new one, from any page of the console', async () => {
    renderMenu(signedIn())
    await open()

    expect(screen.getByRole('link', { name: fr.admin.events })).toHaveAttribute('href', '/admin')
  })

  it('offers the list of events to an account that only moderates, and nothing it cannot open', async () => {
    // A moderator holds no client and does not operate the box: the list is theirs all the same,
    // because it holds the events they moderate, so it is the one entry above the password page.
    renderMenu(
      signedIn({
        session: vi.fn(async (): Promise<SessionResponse> => ({
          authenticated: true,
          user: aSessionUser({ email: 'moderateur@example.org', canOperateSite: false }),
        })),
      }),
    )
    await open()

    expect(screen.getByRole('link', { name: fr.admin.events })).toHaveAttribute('href', '/admin')
    expect(screen.queryByRole('link', { name: fr.site.menuLink })).toBeNull()
    expect(screen.queryByRole('link', { name: fr.clientSpace.spaceLink })).toBeNull()
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

  it('names no list while it is closed, because an id that names nothing is a dangling reference', async () => {
    renderMenu(signedIn())
    const button = await trigger()

    expect(button).not.toHaveAttribute('aria-controls')

    await userEvent.click(button)
    expect(button).toHaveAttribute('aria-controls')
  })

  it('closes on Escape and gives the keyboard back to the control that opened it', async () => {
    renderMenu(signedIn())
    await open()
    await userEvent.tab() // the list of events
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

    await userEvent.tab() // the list of events
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

  it('hands the keyboard back to the entry that asked the question when it is cancelled', async () => {
    // The menu stays open behind the question precisely so that there is somewhere to go back
    // to: closing it first left the dialog's opener unmounted and the keyboard on the document.
    renderMenu(signedIn())
    const dialog = await choose()

    await userEvent.click(within(dialog).getByRole('button', { name: fr.app.cancel }))

    expect(screen.getByRole('button', { name: fr.auth.logoutEverywhere })).toHaveFocus()
  })

  it('keeps the menu open, and the keyboard on that entry, when the others could not be revoked', async () => {
    const api = signedIn({
      revokeOtherSessions: vi.fn(() => Promise.reject(new ApiError(500, 'unknown'))),
    })
    renderMenu(api)
    const dialog = await choose()

    await userEvent.click(within(dialog).getByRole('button', { name: fr.auth.logoutEverywhere }))

    await screen.findByText(fr.errors.unknown)
    expect(screen.queryByRole('dialog', { name: fr.auth.logoutEverywhereTitle })).toBeNull()
    expect(screen.getByRole('button', { name: fr.auth.logoutEverywhere })).toHaveFocus()
  })

  it('asks the server once, however often the confirmation is pressed while it answers', async () => {
    let finish: () => void = () => undefined
    const api = signedIn({
      revokeOtherSessions: vi.fn(() => new Promise<void>((resolve) => (finish = resolve))),
    })
    renderMenu(api)
    const dialog = await choose()
    const confirm = within(dialog).getByRole('button', { name: fr.auth.logoutEverywhere })

    await userEvent.click(confirm)
    await userEvent.click(confirm)
    await userEvent.click(confirm)

    expect(api.revokeOtherSessions).toHaveBeenCalledTimes(1)
    finish()
    expect(await screen.findByText('Écran de connexion')).toBeVisible()
    expect(api.logout).toHaveBeenCalledTimes(1)
  })

  it('leaves the menu alone while the question is up: only the question answers a press outside it', async () => {
    renderMenu(signedIn())
    await choose()

    await userEvent.click(document.body)

    expect(screen.getByRole('button', { name: fr.auth.logout })).toBeVisible()
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

/** The client space entry (G2-16 / P3-17): a member of a client, on a box that has one. */
describe('AccountMenu: the client space', () => {
  const onBox = (clients: ReturnType<typeof aClientLimits>[], siteAdmin = true) =>
    signedIn({
      about: vi.fn(async () => anAbout({ features: { siteAdmin, forgotPassword: false } })),
      myLimits: vi.fn(async () => ({ clients })),
    })

  it('leads a member of a client to their space', async () => {
    renderMenu(onBox([aClientLimits()]))
    await open()

    expect(await screen.findByRole('link', { name: fr.clientSpace.spaceLink })).toHaveAttribute(
      'href',
      '/admin/client',
    )
  })

  it('offers nothing to an account that is in no client', async () => {
    const api = onBox([])
    renderMenu(api)
    await waitFor(() => expect(api.myLimits).toHaveBeenCalled())
    await open()

    expect(screen.queryByRole('link', { name: fr.clientSpace.spaceLink })).toBeNull()
  })

  it('asks nothing and offers nothing on a box with no client space', async () => {
    const api = onBox([aClientLimits()], false)
    renderMenu(api)
    await open()

    expect(screen.queryByRole('link', { name: fr.clientSpace.spaceLink })).toBeNull()
    expect(api.myLimits).not.toHaveBeenCalled()
  })

  it('asks nothing of somebody who is not signed in', async () => {
    const api = fakeApi({
      about: vi.fn(async () => anAbout({ features: { siteAdmin: true, forgotPassword: false } })),
      myLimits: vi.fn(async () => ({ clients: [aClientLimits()] })),
    })
    renderMenu(api)

    await waitFor(() => expect(api.session).toHaveBeenCalled())
    await waitFor(() => expect(api.about).toHaveBeenCalled())

    expect(api.myLimits).not.toHaveBeenCalled()
  })
})

/**
 * Navigation pass, batch D (H7, H15, H17): the second factor's page, the page you are on, and the
 * menu while the password must be changed.
 */
describe('AccountMenu: security, the current page and a forced password change', () => {
  const FACTOR = { available: true, enrolled: false, verified: false, required: false }

  const as = (user: Parameters<typeof aSessionUser>[0], overrides: Partial<Api> = {}) =>
    fakeApi({
      session: vi.fn(async (): Promise<SessionResponse> => ({
        authenticated: true,
        user: aSessionUser({ email: 'camille@example.org', ...user }),
      })),
      ...overrides,
    })

  /** Shows what the page a link opened was handed. */
  const Arrival = () => <p data-testid="arrival">{JSON.stringify(useLocation().state)}</p>

  /** The menu at an address of the console, with the pages it links to as stubs. */
  const renderAt = (api: Api, route: string) =>
    renderWithProviders(
      <>
        <AccountMenu />
        <Routes>
          <Route path="/admin/password" element={<Arrival />} />
          <Route path="*" element={<p>Page</p>} />
        </Routes>
      </>,
      { api, route },
    )

  it('offers the security page where the box has a key to enrol with', async () => {
    renderAt(as({ secondFactor: FACTOR }), '/admin')
    await open()

    expect(screen.getByRole('link', { name: fr.auth.securityTitle })).toHaveAttribute(
      'href',
      '/admin/security',
    )
  })

  it('offers it to an account that has enrolled, whatever the box says now', async () => {
    renderAt(as({ secondFactor: { ...FACTOR, available: false, enrolled: true } }), '/admin')
    await open()

    expect(screen.getByRole('link', { name: fr.auth.securityTitle })).toBeVisible()
  })

  it('offers it to nobody on a box with no key and an account with no authenticator', async () => {
    renderAt(as({}), '/admin')
    await open()

    expect(screen.queryByRole('link', { name: fr.auth.securityTitle })).toBeNull()
  })

  it('marks the entry of the page you are on, and only that one', async () => {
    renderAt(as({ secondFactor: FACTOR }), '/admin/security')
    await open()

    expect(screen.getByRole('link', { name: fr.auth.securityTitle })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('link', { name: fr.admin.events })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('link', { name: fr.auth.changePassword })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('marks the console for every page of the console, not only its front page', async () => {
    renderAt(
      as(
        { canOperateSite: true },
        {
          about: vi.fn(async () =>
            anAbout({ features: { siteAdmin: true, forgotPassword: false } }),
          ),
        },
      ),
      '/admin/site/accounts',
    )
    await open()

    expect(await screen.findByRole('link', { name: fr.site.menuLink })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('sends the page it leaves along, so the password and security pages can bring the person back', async () => {
    renderAt(as({ secondFactor: FACTOR }), '/admin/site/audit?clientId=c-1')
    await open()
    await userEvent.click(screen.getByRole('link', { name: fr.auth.changePassword }))

    expect(await screen.findByTestId('arrival')).toHaveTextContent(
      JSON.stringify({ from: '/admin/site/audit?clientId=c-1' }),
    )
  })

  describe('while the password must be changed', () => {
    const forced = () => as({ mustChangePassword: true, secondFactor: FACTOR })

    it('offers no page of the console, since every one of them leads back to the same screen', async () => {
      renderAt(forced(), '/admin/password')
      await open()

      expect(screen.queryByRole('link', { name: fr.admin.events })).toBeNull()
      expect(screen.queryByRole('link', { name: fr.auth.securityTitle })).toBeNull()
      expect(screen.queryByRole('link', { name: fr.auth.changePassword })).toBeNull()
    })

    it('says why, and keeps the two ways out', async () => {
      renderAt(forced(), '/admin/password')
      await open()

      expect(screen.getByText(fr.auth.menuMustChange)).toBeVisible()
      expect(screen.getByRole('button', { name: fr.auth.logout })).toBeVisible()
      expect(screen.getByRole('button', { name: fr.auth.logoutEverywhere })).toBeVisible()
    })

    it('does not ask for the client space, which the server would refuse', async () => {
      const api = as(
        { mustChangePassword: true },
        {
          about: vi.fn(async () =>
            anAbout({ features: { siteAdmin: true, forgotPassword: false } }),
          ),
        },
      )
      renderAt(api, '/admin/password')
      await open()

      expect(api.myLimits).not.toHaveBeenCalled()
    })
  })
})
