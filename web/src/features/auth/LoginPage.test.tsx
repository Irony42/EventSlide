import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Navigate, Route, Routes } from 'react-router-dom'
import { LoginPage } from './LoginPage'
import { ApiError } from '../../lib/http'
import { fr } from '../../lib/i18n/fr'
import { aSessionUser, fakeApi, renderWithProviders } from '../../testing/renderWithProviders'
import type { Api } from '../../lib/api/client'
import type { SessionUserDto } from '../../lib/api/dto'

const DASHBOARD = 'Tableau de bord'
const MODERATION = 'Console de modération'

/** Real routes, so "went to /admin" is asserted by what the host ends up looking at. */
const renderLogin = (api: Api, route = '/login') =>
  renderWithProviders(
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/admin" element={<p>{DASHBOARD}</p>} />
      <Route path="/admin/events/mariage/moderation" element={<p>{MODERATION}</p>} />
    </Routes>,
    { api, route },
  )

/** The same routes, entered through a redirect that carries a `from` in its state. */
const renderArrivingFrom = (api: Api, from: string) =>
  renderWithProviders(
    <Routes>
      <Route path="/depart" element={<Navigate to="/login" replace state={{ from }} />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/admin" element={<p>{DASHBOARD}</p>} />
      <Route path="/admin/events/mariage/moderation" element={<p>{MODERATION}</p>} />
    </Routes>,
    { api, route: '/depart' },
  )

const signIn = async (email = 'organisation@example.com', password = 'un-mot-de-passe-long') => {
  await userEvent.type(screen.getByLabelText(fr.auth.email), email)
  await userEvent.type(screen.getByLabelText(fr.auth.password), password)
  await userEvent.click(screen.getByRole('button', { name: fr.auth.submit }))
}

describe('LoginPage', () => {
  it('signs the host in and lands them on the dashboard', async () => {
    const api = fakeApi()

    renderLogin(api)
    await signIn()

    expect(api.login).toHaveBeenCalledWith('organisation@example.com', 'un-mot-de-passe-long')
    expect(await screen.findByText(DASHBOARD)).toBeVisible()
  })

  it('offers a password manager the fields it needs', async () => {
    renderLogin(fakeApi())

    // Without these two the manager fills nothing, and a host at a venue has to read a
    // generated password off their phone one character at a time.
    expect(screen.getByLabelText(fr.auth.email)).toHaveAttribute('autocomplete', 'username')
    expect(screen.getByLabelText(fr.auth.password)).toHaveAttribute(
      'autocomplete',
      'current-password',
    )
  })

  it('shows one generic failure and keeps what was typed', async () => {
    const api = fakeApi({
      login: vi.fn(() => Promise.reject(new ApiError(401, 'auth.invalidCredentials'))),
    })

    renderLogin(api)
    await signIn('camille@example.com', 'mauvais-mot-de-passe')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(fr.errors['auth.invalidCredentials'])
    // The same sentence for an unknown address and a wrong password: the server sends
    // one code for both, and telling them apart here would enumerate accounts.
    expect(screen.queryByText(DASHBOARD)).toBeNull()
    expect(screen.getByLabelText(fr.auth.email)).toHaveValue('camille@example.com')
    expect(screen.getByLabelText(fr.auth.password)).toHaveValue('mauvais-mot-de-passe')
  })

  it('says what to do next when the venue network dropped instead of blaming the password', async () => {
    const api = fakeApi({ login: vi.fn(() => Promise.reject(ApiError.network())) })

    renderLogin(api)
    await signIn()

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors.network)
  })

  it('says something readable when the failure carries no error code at all', async () => {
    // Anything that is not an `ApiError` is a bug in this build, and its message is an
    // internal English string. Putting one on the login form would leave a host at a
    // wedding reading a stack-trace fragment instead of a sentence.
    const api = fakeApi({
      login: vi.fn(() => Promise.reject(new TypeError('e.json is not a function'))),
    })

    renderLogin(api)
    await signIn()

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors.unknown)
    expect(screen.queryByText(/is not a function/)).toBeNull()
  })

  it('returns the host to the page they were trying to reach', async () => {
    // RequireAuth records it in the navigation state, so a bookmarked console does not
    // become "click through the dashboard again" in the middle of an event.
    const api = fakeApi({ login: vi.fn(async () => aSessionUser()) })

    renderArrivingFrom(api, '/admin/events/mariage/moderation')
    await signIn()

    expect(await screen.findByText(MODERATION)).toBeVisible()
  })

  it('ignores a destination that is not an address inside the app', async () => {
    // History state survives a reload and can come from an older build; honouring an
    // absolute URL from it would make the login form an open redirect.
    renderArrivingFrom(fakeApi(), 'https://ailleurs.example/phishing')
    await signIn()

    expect(await screen.findByText(DASHBOARD)).toBeVisible()
  })

  it('ignores a destination opening with a backslash, which a browser reads as a slash', async () => {
    // One character apart from the case above and it used to pass: `/\ailleurs.example`
    // resolves to `//ailleurs.example`, so refusing only `//` refused nothing. It is the
    // bypass react-router hardened against in 7.18.0, and the value reaches this
    // function out of history state before any router has looked at it.
    renderArrivingFrom(fakeApi(), '/\\ailleurs.example/phishing')
    await signIn()

    expect(await screen.findByText(DASHBOARD)).toBeVisible()
  })

  it('keeps the button labelled while the request is in flight', async () => {
    const api = fakeApi({ login: vi.fn(() => new Promise<SessionUserDto>(() => {})) })

    renderLogin(api)
    await signIn()

    // A spinner that replaced the label would announce nothing and drop the button out
    // of the tab order at exactly the moment the host is waiting on it.
    const button = screen.getByRole('button', { name: fr.auth.submit })
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toBeDisabled()
  })

  describe('an account with an authenticator', () => {
    const challenged = () =>
      fakeApi({ login: vi.fn(async () => ({ secondFactorRequired: true as const })) })

    it('asks for the second step in place of the form, and does not go anywhere yet', async () => {
      renderLogin(challenged())
      await signIn()

      expect(await screen.findByRole('heading', { name: fr.auth.secondFactorTitle })).toBeVisible()
      expect(screen.queryByLabelText(fr.auth.password)).toBeNull()
      expect(screen.queryByText(DASHBOARD)).toBeNull()
    })

    it('lands the host where they were going once the code is accepted', async () => {
      const api = challenged()
      renderArrivingFrom(api, '/admin/events/mariage/moderation')
      await signIn()

      await userEvent.type(await screen.findByLabelText(fr.auth.secondFactorCode), '123456')
      await userEvent.click(screen.getByRole('button', { name: fr.auth.secondFactorSubmit }))

      expect(api.loginSecondFactor).toHaveBeenCalledWith({ code: '123456' })
      expect(await screen.findByText(MODERATION)).toBeVisible()
    })

    it('goes back to the password with the reason when the server ends the sign-in, and keeps the address', async () => {
      const api = fakeApi({
        login: vi.fn(async () => ({ secondFactorRequired: true as const })),
        loginSecondFactor: vi.fn(() =>
          Promise.reject(new ApiError(401, 'auth.secondFactorExpired')),
        ),
      })
      renderLogin(api)
      await signIn('camille@example.com', 'un-mot-de-passe-long')

      await userEvent.type(await screen.findByLabelText(fr.auth.secondFactorCode), '000000')
      await userEvent.click(screen.getByRole('button', { name: fr.auth.secondFactorSubmit }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        fr.errors['auth.secondFactorExpired'],
      )
      expect(screen.getByLabelText(fr.auth.email)).toHaveValue('camille@example.com')
      // Typed again: a half-finished sign-in holds nothing worth resubmitting.
      expect(screen.getByLabelText(fr.auth.password)).toHaveValue('')
    })

    it('goes back to the password without a reason when the host chooses to', async () => {
      renderLogin(challenged())
      await signIn()

      await userEvent.click(
        await screen.findByRole('button', { name: fr.auth.secondFactorRestart }),
      )

      expect(await screen.findByLabelText(fr.auth.password)).toBeVisible()
      expect(screen.queryByRole('alert')).toBeNull()
    })

    it('forgets a reason once the password is sent again', async () => {
      const api = fakeApi({
        login: vi.fn(async () => ({ secondFactorRequired: true as const })),
        loginSecondFactor: vi.fn(() =>
          Promise.reject(new ApiError(401, 'auth.secondFactorExpired')),
        ),
      })
      renderLogin(api)
      await signIn()
      await userEvent.type(await screen.findByLabelText(fr.auth.secondFactorCode), '000000')
      await userEvent.click(screen.getByRole('button', { name: fr.auth.secondFactorSubmit }))
      await screen.findByRole('alert')

      await userEvent.type(screen.getByLabelText(fr.auth.password), 'un-mot-de-passe-long')
      await userEvent.click(screen.getByRole('button', { name: fr.auth.submit }))

      expect(await screen.findByRole('heading', { name: fr.auth.secondFactorTitle })).toBeVisible()
      expect(screen.queryByRole('alert')).toBeNull()
    })
  })
})
