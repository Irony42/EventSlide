import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../lib/http'
import { useNavigate } from 'react-router-dom'
import { AppRoutes } from './router'
import { fr } from '../lib/i18n/fr'
import {
  anAbout,
  anInvitationAccepted,
  aSessionUser,
  fakeApi,
  renderWithProviders,
} from '../testing/renderWithProviders'
import type { Api } from '../lib/api/client'
import type { SessionResponse } from '../lib/api/dto'

/**
 * What the app asks the server once, and what it must ask again.
 *
 * `GET /api/auth/me` and `GET /api/about` used to be read by every component that wanted
 * them: a load of any `/admin/**` page asked for the session three times (the header menu,
 * `RequireAuth`, then the must-change-password gate, which mounts only once `RequireAuth` has
 * answered, so two spinners in a row), and `/api/about` up to eight. The answer is shared now,
 * and sharing makes the opposite mistake possible: a session read before somebody signed in,
 * out, or changed their password would be served to a screen that must see the new one.
 * Both halves are held here, through the real route table.
 */

const host = (overrides: Partial<ReturnType<typeof aSessionUser>> = {}): SessionResponse => ({
  authenticated: true,
  user: aSessionUser(overrides),
})

const NOBODY: SessionResponse = { authenticated: false }

/**
 * `session: false`: the provider `HostLayout` mounts is the one under test. With the
 * harness's own above it, a layout that forgot its provider would still pass.
 */
const openAdmin = (api: Api, route: string) =>
  renderWithProviders(<AppRoutes />, { api, route, session: false })

const TOKEN = 'Z7q-Mx0Ld3Tn9VbRk2YcHs8WfAe5GuJi4PoXz1NvB6E'

const signInForm = async (email: string) => {
  await userEvent.type(await screen.findByLabelText(fr.auth.email), email)
  await userEvent.type(screen.getByLabelText(fr.auth.password), 'un-mot-de-passe-long')
  await userEvent.click(screen.getByRole('button', { name: fr.auth.submit }))
}

describe('what is asked once', () => {
  it('reads the session once for a load of an admin page, not once per component', async () => {
    const api = fakeApi({ session: vi.fn(async () => host()) })

    openAdmin(api, '/admin')

    expect(await screen.findByRole('heading', { name: fr.admin.events })).toBeVisible()
    // The menu is up too: the header, the gate and the page all read the same answer.
    expect(await screen.findByRole('button', { name: fr.auth.accountMenu })).toBeVisible()
    expect(api.session).toHaveBeenCalledTimes(1)
  })

  it('shows one wait while the session is being read, not two in a row', async () => {
    const pending: ((session: SessionResponse) => void)[] = []
    const api = fakeApi({
      session: vi.fn(() => new Promise<SessionResponse>((resolve) => pending.push(resolve))),
    })

    openAdmin(api, '/admin')
    expect(await screen.findByRole('status')).toHaveTextContent(fr.shell.sessionChecking)
    for (const answer of pending) answer(host())

    // Once answered the page is next: the gate has nothing left to ask, so no second spinner
    // between the wait for the session and the dashboard.
    expect(await screen.findByRole('heading', { name: fr.admin.events })).toBeVisible()
    expect(api.session).toHaveBeenCalledTimes(1)
  })

  it('asks about the box once per load, whichever of its readers are on screen', async () => {
    // The router (is there a client space?), the footer, the event page's links: three readers.
    const api = fakeApi({
      session: vi.fn(async () => host()),
      about: vi.fn(async () => anAbout({ features: { siteAdmin: true, forgotPassword: false } })),
    })

    openAdmin(api, '/admin/events/mariage')

    expect(await screen.findByRole('heading', { name: 'Camille & Sacha' })).toBeVisible()
    await waitFor(() => expect(api.about).toHaveBeenCalled())
    expect(api.about).toHaveBeenCalledTimes(1)
  })

  it('reads the session once on the sign-in page, to send on somebody who is already in (H13)', async () => {
    const api = fakeApi()

    openAdmin(api, '/login')

    expect(await screen.findByRole('heading', { name: fr.auth.title })).toBeVisible()
    await waitFor(() => expect(api.session).toHaveBeenCalledTimes(1))
  })

  it('asks again, once, when the host presses retry after a failure to ask', async () => {
    const session = vi
      .fn<Api['session']>()
      .mockRejectedValueOnce(ApiError.network())
      .mockResolvedValue(host())
    const api = fakeApi({ session })

    openAdmin(api, '/admin')
    await userEvent.click(await screen.findByRole('button', { name: fr.app.retry }))

    expect(await screen.findByRole('heading', { name: fr.admin.events })).toBeVisible()
    expect(session).toHaveBeenCalledTimes(2)
  })
})

describe('what is asked again because the answer changed', () => {
  it('lets a host in after signing in, though the page had already been told nobody was', async () => {
    // `/admin` asks the session, is told "nobody", and sends the host to the form; the answer
    // it kept must not outlive the sign-in, or the host is bounced back to the form they just
    // filled in.
    let signedIn = false
    const api = fakeApi({
      session: vi.fn(async (): Promise<SessionResponse> => (signedIn ? host() : NOBODY)),
      login: vi.fn(async () => {
        signedIn = true
        return aSessionUser()
      }),
    })

    openAdmin(api, '/admin')
    await signInForm('organisation@example.com')

    expect(await screen.findByRole('heading', { name: fr.admin.events })).toBeVisible()
    expect(screen.queryByRole('heading', { name: fr.auth.title })).toBeNull()
  })

  it('lets a host in after the second step of a sign-in, for the same reason', async () => {
    let signedIn = false
    const api = fakeApi({
      session: vi.fn(async (): Promise<SessionResponse> => (signedIn ? host() : NOBODY)),
      login: vi.fn(async () => ({ secondFactorRequired: true as const })),
      loginSecondFactor: vi.fn(async () => {
        signedIn = true
        return aSessionUser()
      }),
    })

    openAdmin(api, '/admin')
    await signInForm('organisation@example.com')
    await userEvent.type(await screen.findByLabelText(fr.auth.secondFactorCode), '123456')
    await userEvent.click(screen.getByRole('button', { name: fr.auth.secondFactorSubmit }))

    expect(await screen.findByRole('heading', { name: fr.admin.events })).toBeVisible()
  })

  it('shows the next account, not the last one, when somebody else signs in after a sign-out', async () => {
    // A laptop handed to the next person at a venue. The menu names the account whose session
    // it is; it must never name the one that just left.
    let current: SessionResponse = host({ email: 'premiere@example.org' })
    const api = fakeApi({
      session: vi.fn(async () => current),
      logout: vi.fn(async () => {
        current = NOBODY
      }),
      login: vi.fn(async () => {
        current = host({ email: 'seconde@example.org' })
        return aSessionUser()
      }),
    })

    openAdmin(api, '/admin')
    await userEvent.click(await screen.findByRole('button', { name: fr.auth.accountMenu }))
    expect(screen.getByText(fr.auth.accountSignedInAs('premiere@example.org'))).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: fr.auth.logout }))
    await signInForm('seconde@example.org')

    await userEvent.click(await screen.findByRole('button', { name: fr.auth.accountMenu }))
    expect(screen.getByText(fr.auth.accountSignedInAs('seconde@example.org'))).toBeVisible()
  })

  it('lets a new invitee into the event they have just accepted, though the page had been told nobody was signed in', async () => {
    // The invitation page is the first reader and caches "nobody"; accepting starts a
    // session and navigates into `/admin`, where `RequireAuth` reads the same shared
    // answer. Served as it was, it would send a person with a valid session to the form.
    let signedIn = false
    const api = fakeApi({
      session: vi.fn(async (): Promise<SessionResponse> => (signedIn ? host() : NOBODY)),
      acceptInvitation: vi.fn(async () => {
        signedIn = true
        return anInvitationAccepted()
      }),
    })

    openAdmin(api, `/invite/${TOKEN}`)
    await userEvent.type(await screen.findByLabelText(fr.auth.invitationName), 'Camille')
    await userEvent.type(screen.getByLabelText(fr.auth.password), 'une-phrase-de-passe-longue')
    await userEvent.type(
      screen.getByLabelText(fr.auth.invitationConfirmPassword),
      'une-phrase-de-passe-longue',
    )
    await userEvent.click(screen.getByRole('button', { name: fr.auth.invitationSubmit }))

    // A moderator starts on the queue they were invited to work (decision 2).
    expect(await screen.findByRole('heading', { name: fr.moderation.title })).toBeVisible()
    expect(screen.queryByRole('heading', { name: fr.auth.title })).toBeNull()
  })

  it.each([
    ['a password', false],
    ['a password and a second step', true],
  ])(
    'offers the account, not the form for a stranger, to somebody who signed in with %s from the invitation’s own link',
    async (_name, withSecondStep) => {
      // "I already have an account": the page reads nobody, sends the person to the form with a
      // way back, and the way back is a page that must now see them. Nothing here crosses the
      // border of `/admin`, so only the sign-in itself can say the answer went stale.
      let signedIn = false
      const api = fakeApi({
        session: vi.fn(async (): Promise<SessionResponse> => (signedIn ? host() : NOBODY)),
        login: vi.fn(async () => {
          if (withSecondStep) return { secondFactorRequired: true as const }
          signedIn = true
          return aSessionUser()
        }),
        loginSecondFactor: vi.fn(async () => {
          signedIn = true
          return aSessionUser()
        }),
      })

      openAdmin(api, `/invite/${TOKEN}`)
      await userEvent.click(await screen.findByRole('link', { name: fr.auth.submit }))
      await signInForm('organisation@example.com')
      if (withSecondStep) {
        await userEvent.type(await screen.findByLabelText(fr.auth.secondFactorCode), '123456')
        await userEvent.click(screen.getByRole('button', { name: fr.auth.secondFactorSubmit }))
      }

      expect(
        await screen.findByText(fr.auth.invitationSignedInAs('organisation@example.com')),
      ).toBeVisible()
    },
  )

  it('does not show the console to the account that left when the browser goes back', async () => {
    // Signing out replaces the page it was done from, so the entry before it is still a console
    // whose session is gone. Leaving `/admin` ends the answer, so that console is asked about
    // again, and the form is what comes back.
    let current: SessionResponse = host()
    const api = fakeApi({
      session: vi.fn(async () => current),
      logout: vi.fn(async () => {
        current = NOBODY
      }),
    })
    function Moves() {
      const navigate = useNavigate()
      return (
        <>
          <button type="button" onClick={() => navigate('/admin/events/mariage')}>
            aller
          </button>
          <button type="button" onClick={() => navigate(-1)}>
            retour
          </button>
        </>
      )
    }

    renderWithProviders(
      <>
        <AppRoutes />
        <Moves />
      </>,
      { api, route: '/admin', session: false },
    )
    expect(await screen.findByRole('heading', { name: fr.admin.events })).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'aller' }))
    expect(await screen.findByRole('heading', { name: 'Camille & Sacha' })).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: fr.auth.accountMenu }))
    await userEvent.click(screen.getByRole('button', { name: fr.auth.logout }))
    expect(await screen.findByRole('heading', { name: fr.auth.title })).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'retour' }))

    expect(await screen.findByRole('heading', { name: fr.auth.title })).toBeVisible()
    expect(screen.queryByRole('heading', { name: fr.admin.events })).toBeNull()
  })

  it('does not keep the account that left, whichever address of the console it left from', async () => {
    // A typo in an admin address is the not-found screen under the same header, so the menu is
    // there and `RequireAuth` is not: signing out from it must still end the answer.
    let current: SessionResponse = host({ email: 'premiere@example.org' })
    const api = fakeApi({
      session: vi.fn(async () => current),
      logout: vi.fn(async () => {
        current = NOBODY
      }),
      login: vi.fn(async () => {
        current = host({ email: 'seconde@example.org' })
        return aSessionUser()
      }),
    })

    openAdmin(api, '/admin/inconnu')
    await userEvent.click(await screen.findByRole('button', { name: fr.auth.accountMenu }))
    await userEvent.click(screen.getByRole('button', { name: fr.auth.logout }))
    await signInForm('seconde@example.org')

    await userEvent.click(await screen.findByRole('button', { name: fr.auth.accountMenu }))
    expect(screen.getByText(fr.auth.accountSignedInAs('seconde@example.org'))).toBeVisible()
  })

  it('lets a host through the gate once they have chosen their own password', async () => {
    // The gate holds an invited moderator on the change screen until `mustChangePassword` is
    // false. It has to read that again after the change, or the moderator is sent back to the
    // screen they have just finished.
    let mustChangePassword = true
    const api = fakeApi({
      session: vi.fn(async () => host({ mustChangePassword })),
      changePassword: vi.fn(async () => {
        mustChangePassword = false
      }),
    })

    openAdmin(api, '/admin')
    await userEvent.type(
      await screen.findByLabelText(fr.auth.currentPassword),
      'le-mot-de-passe-recu',
    )
    await userEvent.type(screen.getByLabelText(fr.auth.newPassword), 'une-phrase-de-passe-solide')
    await userEvent.type(
      screen.getByLabelText(fr.auth.confirmPassword),
      'une-phrase-de-passe-solide',
    )
    await userEvent.click(screen.getByRole('button', { name: fr.app.save }))

    expect(await screen.findByRole('heading', { name: fr.admin.events })).toBeVisible()
  })
})
