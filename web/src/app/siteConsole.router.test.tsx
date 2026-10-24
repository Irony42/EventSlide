import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fr } from '../lib/i18n/fr'
import { ApiError } from '../lib/http'
import type { Api } from '../lib/api/client'
import { aSessionUser, anAbout } from '../testing/renderWithProviders'
import { aSiteClient, CLIENT_ID } from '../testing/siteFixtures'
import { consoleApi, openConsole, operatorSession } from '../testing/siteConsole'

/**
 * Who is shown the operator's console, and who is not.
 *
 * Two flags answer two different questions and neither is an authorisation: `features.siteAdmin`
 * on `GET /api/about` is whether this box has a console at all, and `canOperateSite` on `GET
 * /api/auth/me` is whether this account operates the box. A box with `SITE_ADMIN=off` still tells
 * its operator `canOperateSite: true`, so an entry that read the one flag would point an operator
 * at a console that is not there. The server judges every request under `/api/site` on its own;
 * what is held here is that the SPA **offers** the console to the one account that can use it, on
 * the one kind of box that has it, and answers everyone else as it answers an address nobody wrote.
 */

const ordinaryHost = () =>
  consoleApi({
    session: vi.fn(async () => ({
      authenticated: true as const,
      user: aSessionUser({ canOperateSite: false }),
    })),
  })

const operatorOnBoxWithoutConsole = () =>
  consoleApi({
    about: vi.fn(async () => anAbout({ features: { siteAdmin: false, forgotPassword: false } })),
  })

const menuButton = () => screen.findByRole('button', { name: fr.auth.accountMenu })

describe('the account menu’s entry to the console', () => {
  it('offers it to the account that operates a box that has a console', async () => {
    openConsole('/admin', consoleApi())

    await userEvent.click(await menuButton())

    expect(await screen.findByRole('link', { name: fr.site.menuLink })).toHaveAttribute(
      'href',
      '/admin/site',
    )
  })

  it('does not offer it to an account that does not operate the box, on a box that has a console', async () => {
    openConsole('/admin', ordinaryHost())

    await userEvent.click(await menuButton())

    expect(screen.getByRole('link', { name: fr.auth.changePassword })).toBeVisible()
    expect(screen.queryByRole('link', { name: fr.site.menuLink })).toBeNull()
  })

  it('does not offer it to the operator of a box with no console, where canOperateSite is true all the same', async () => {
    const api = operatorOnBoxWithoutConsole()
    openConsole('/admin', api)

    await userEvent.click(await menuButton())

    expect(screen.getByRole('link', { name: fr.auth.changePassword })).toBeVisible()
    expect(screen.queryByRole('link', { name: fr.site.menuLink })).toBeNull()
    await expect(api.session()).resolves.toMatchObject({ user: { canOperateSite: true } })
  })
})

describe('the console’s address', () => {
  it('opens for the account that operates a box that has a console', async () => {
    openConsole('/admin/site', consoleApi())

    expect(await screen.findByRole('heading', { name: fr.site.clientsTitle })).toBeVisible()
    expect(screen.getByText(fr.site.consoleIntro)).toBeVisible()
  })

  it('is the not-found screen, and asks the server for nothing, for an account that does not operate the box', async () => {
    const api = ordinaryHost()
    openConsole('/admin/site', api)

    expect(await screen.findByRole('heading', { name: fr.shell.notFoundTitle })).toBeVisible()
    expect(screen.queryByText(fr.site.consoleIntro)).toBeNull()
    expect(api.siteClients).not.toHaveBeenCalled()
  })

  it('is the not-found screen, and asks the server for nothing, on a box with no console, whoever asks', async () => {
    const api = operatorOnBoxWithoutConsole()
    openConsole('/admin/site', api)

    expect(await screen.findByRole('heading', { name: fr.shell.notFoundTitle })).toBeVisible()
    expect(api.siteClients).not.toHaveBeenCalled()
  })

  it('is the not-found screen for every address under it, for an account that does not operate the box', async () => {
    for (const route of [
      '/admin/site/accounts',
      '/admin/site/audit',
      `/admin/site/clients/${CLIENT_ID}`,
    ]) {
      const api = ordinaryHost()
      const { unmount } = openConsole(route, api)

      expect(await screen.findByRole('heading', { name: fr.shell.notFoundTitle })).toBeVisible()
      expect(api.siteAccounts).not.toHaveBeenCalled()
      expect(api.siteAudit).not.toHaveBeenCalled()
      expect(api.siteClients).not.toHaveBeenCalled()
      unmount()
    }
  })

  it('waits for the box to say whether it has a console, and is not "not found" in the meantime', async () => {
    // A reload of the console's address: the box has not answered yet, so the console's routes do
    // not exist yet, and that is not the same as an address nobody wrote.
    let answer: (value: ReturnType<typeof anAbout>) => void = () => undefined
    const api = consoleApi({
      about: vi.fn(() => new Promise<ReturnType<typeof anAbout>>((resolve) => (answer = resolve))),
    })
    openConsole('/admin/site', api)

    expect(await screen.findByRole('status')).toHaveTextContent(fr.app.loading)
    expect(screen.queryByRole('heading', { name: fr.shell.notFoundTitle })).toBeNull()

    answer(anAbout({ features: { siteAdmin: true, forgotPassword: false } }))

    expect(await screen.findByRole('heading', { name: fr.site.clientsTitle })).toBeVisible()
    expect(screen.queryByRole('heading', { name: fr.shell.notFoundTitle })).toBeNull()
  })

  it('is the not-found screen when the box never answers, which is the strict reading', async () => {
    const api = consoleApi({ about: vi.fn(async () => Promise.reject(new ApiError(0, 'network'))) })
    openConsole('/admin/site', api)

    expect(await screen.findByRole('heading', { name: fr.shell.notFoundTitle })).toBeVisible()
    expect(api.siteClients).not.toHaveBeenCalled()
  })

  it('does not hold an address that only starts like the console’s back for the box’s answer', async () => {
    const api = consoleApi({ about: vi.fn(() => new Promise<never>(() => {})) })
    openConsole('/admin/sitemap', api)

    expect(await screen.findByRole('heading', { name: fr.shell.notFoundTitle })).toBeVisible()
  })

  it('does not hold any other address back for the box’s answer', async () => {
    const api = consoleApi({ about: vi.fn(() => new Promise<never>(() => {})) })
    openConsole('/admin/nothing-here', api)

    expect(await screen.findByRole('heading', { name: fr.shell.notFoundTitle })).toBeVisible()
  })

  it('sends somebody who is not signed in to the sign-in page, not to the not-found screen', async () => {
    const api = consoleApi({
      session: vi.fn(async () => ({ authenticated: false as const })),
    })
    openConsole('/admin/site', api)

    expect(await screen.findByRole('heading', { name: fr.auth.title })).toBeVisible()
    expect(api.siteClients).not.toHaveBeenCalled()
  })

  it('answers an address under the console that nobody wrote as any other, even to the operator', async () => {
    openConsole('/admin/site/nothing-here', consoleApi())

    expect(await screen.findByRole('heading', { name: fr.shell.notFoundTitle })).toBeVisible()
  })
})

describe('the console’s sections', () => {
  it('links the three sections, and marks the one that is open', async () => {
    openConsole('/admin/site/accounts', consoleApi())

    const nav = await screen.findByRole('navigation', { name: fr.site.navLabel })

    expect(nav.querySelectorAll('a')).toHaveLength(3)
    expect(screen.getByRole('link', { name: fr.site.navAccounts })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('link', { name: fr.site.navClients })).not.toHaveAttribute(
      'aria-current',
    )
    expect(screen.getByRole('link', { name: fr.site.navAudit })).toHaveAttribute(
      'href',
      '/admin/site/audit',
    )
  })

  it('keeps "Clients" open on a client’s own page, which belongs to it', async () => {
    openConsole(
      `/admin/site/clients/${CLIENT_ID}`,
      consoleApi({ siteClients: vi.fn(async () => ({ items: [aSiteClient()], next: null })) }),
    )

    await screen.findByRole('heading', { level: 1, name: 'Atelier Alpha' })

    expect(screen.getByRole('link', { name: fr.site.navClients })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('walks from one section to the next without leaving the console’s layout', async () => {
    openConsole('/admin/site', consoleApi())
    await screen.findByRole('heading', { name: fr.site.clientsTitle })

    await userEvent.click(screen.getByRole('link', { name: fr.site.navAudit }))

    expect(await screen.findByRole('heading', { name: fr.site.auditTitle })).toBeVisible()
    expect(screen.getByText(fr.site.consoleIntro)).toBeVisible()
  })
})

describe('the second factor, where the box requires one', () => {
  const session = (secondFactor: {
    readonly enrolled: boolean
    readonly verified: boolean
    readonly required: boolean
  }) => vi.fn(async () => operatorSession({ secondFactor: { available: true, ...secondFactor } }))

  it('shows the console to a session that passed it', async () => {
    openConsole(
      '/admin/site',
      consoleApi({ session: session({ enrolled: true, verified: true, required: true }) }),
    )

    expect(await screen.findByRole('heading', { name: fr.site.clientsTitle })).toBeVisible()
  })

  it('shows the console on a box that asks for none, whatever the session says about it', async () => {
    openConsole(
      '/admin/site',
      consoleApi({ session: session({ enrolled: false, verified: false, required: false }) }),
    )

    expect(await screen.findByRole('heading', { name: fr.site.clientsTitle })).toBeVisible()
  })

  it('sends an operator who has not enrolled to enrol, and reads nothing from the server meanwhile', async () => {
    const api = consoleApi({
      session: session({ enrolled: false, verified: false, required: true }),
    })
    openConsole('/admin/site', api)

    expect(await screen.findByRole('heading', { name: fr.site.factorTitle })).toBeVisible()
    expect(screen.getByText(fr.site.factorEnrol)).toBeVisible()
    expect(screen.getByRole('link', { name: fr.site.factorEnrolLink })).toHaveAttribute(
      'href',
      '/admin/security',
    )
    expect(screen.queryByRole('heading', { name: fr.site.clientsTitle })).toBeNull()
    expect(api.siteClients).not.toHaveBeenCalled()
  })

  it('asks an operator whose session skipped the code to sign in again, where it is asked', async () => {
    const api = consoleApi({
      session: session({ enrolled: true, verified: false, required: true }),
    })
    openConsole('/admin/site', api)

    expect(await screen.findByRole('heading', { name: fr.site.factorTitle })).toBeVisible()
    expect(screen.getByText(fr.site.factorSignIn)).toBeVisible()
    expect(api.siteClients).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: fr.site.factorSignOut }))

    await waitFor(() => expect(api.logout).toHaveBeenCalledTimes(1))
    expect(await screen.findByRole('heading', { name: fr.auth.title })).toBeVisible()
  })

  it('says why, and stays, when signing out failed', async () => {
    const api: Api = consoleApi({
      session: session({ enrolled: true, verified: false, required: true }),
      logout: vi.fn(async () => Promise.reject(new ApiError(0, 'network'))),
    })
    openConsole('/admin/site', api)

    await userEvent.click(await screen.findByRole('button', { name: fr.site.factorSignOut }))

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors.network)
    expect(screen.getByRole('heading', { name: fr.site.factorTitle })).toBeVisible()
  })
})
