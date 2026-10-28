import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { LoginPage } from './LoginPage'
import { LANDING_TIMEOUT_MS } from './hooks/useLanding'
import { ApiError } from '../../lib/http'
import { fr } from '../../lib/i18n/fr'
import {
  aClientLimits,
  anAbout,
  anEventDto,
  aSessionUser,
  fakeApi,
  renderWithProviders,
} from '../../testing/renderWithProviders'
import type { Api } from '../../lib/api/client'
import type {
  About,
  CurrentUserDto,
  EventSummaryDto,
  SessionResponse,
  SessionUserDto,
} from '../../lib/api/dto'

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

describe("LoginPage: 'Mot de passe oublié ?'", () => {
  const canMail = (canMail: boolean) =>
    fakeApi({
      about: vi.fn(async () =>
        anAbout({ features: { siteAdmin: false, forgotPassword: canMail } }),
      ),
    })

  it('offers the link when the box can send mail, and it leads to the forgot page', async () => {
    const api = canMail(true)
    renderLogin(api)

    const link = await screen.findByRole('link', { name: fr.auth.forgotLink })

    expect(link).toHaveAttribute('href', '/password/forgot')
  })

  it('offers no link when the box cannot send mail, because the page behind it could not work', async () => {
    const api = canMail(false)
    renderLogin(api)

    await waitFor(() => expect(api.about).toHaveBeenCalled())
    // Let the answer land before asserting an absence: an absence checked before the answer
    // arrives is true of every version of this page.
    await screen.findByLabelText(fr.auth.email)
    await waitFor(() => expect(api.about).toHaveBeenCalledTimes(1))

    expect(screen.queryByRole('link', { name: fr.auth.forgotLink })).toBeNull()
  })

  it('offers no link when the server never says, which is what a server older than the flag does', async () => {
    const api = fakeApi({
      about: vi.fn(
        async () => ({ ...anAbout(), features: { siteAdmin: true } }) as unknown as About,
      ),
    })
    renderLogin(api)

    await waitFor(() => expect(api.about).toHaveBeenCalled())

    expect(screen.queryByRole('link', { name: fr.auth.forgotLink })).toBeNull()
  })

  it('offers no link while the server has not answered yet', async () => {
    const api = fakeApi({ about: vi.fn(() => new Promise<never>(() => undefined)) })
    renderLogin(api)

    expect(screen.queryByRole('link', { name: fr.auth.forgotLink })).toBeNull()
    expect(screen.getByLabelText(fr.auth.email)).toBeVisible()
  })

  it('is reachable after the link, by keyboard, without leaving the form', async () => {
    renderLogin(canMail(true))

    const link = await screen.findByRole('link', { name: fr.auth.forgotLink })
    await userEvent.tab()
    await userEvent.tab()
    await userEvent.tab()
    await userEvent.tab()

    // Tab order: skip-less here (no shell), e-mail, password, submit, then the link.
    expect(link).toHaveFocus()
  })
})

/**
 * Navigation pass, batch D: where the host lands (H12, H14), what an open session does to the
 * form (H13), and the two small ways out of the sign-in (H16).
 */
const summary = (slug: string): EventSummaryDto => ({
  id: `id-${slug}`,
  slug,
  name: slug,
  status: 'live',
  photoCount: 0,
  pendingCount: 0,
  guestCount: 0,
  usedBytes: 0,
  createdAt: '2026-06-20T21:04:11.031Z',
  // The landing reads the role from the event itself (`GET /api/events/:slug`), not from the list.
  role: 'owner',
})

describe('LoginPage: where the host lands', () => {
  /** Shows the address it was reached at, query included. */
  function Where() {
    const { pathname, search } = useLocation()
    return <p>{`Arrivé ${pathname}${search}`}</p>
  }

  const open = (api: Api, state?: unknown) =>
    renderWithProviders(
      <Routes>
        <Route path="/depart" element={<Navigate to="/login" replace state={state} />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/admin" element={<Where />} />
        <Route path="/admin/site" element={<Where />} />
        <Route path="/admin/site/audit" element={<Where />} />
        <Route path="/admin/events/:slug/moderation" element={<Where />} />
        <Route path="/admin/events/:slug/moderation/mobile" element={<Where />} />
      </Routes>,
      { api, route: '/depart' },
    )

  const withEvents = (slugs: readonly string[], role: 'owner' | 'moderator') =>
    fakeApi({
      listEvents: vi.fn(async () => ({ items: slugs.map(summary) })),
      getEvent: vi.fn(async (slug: string) => anEventDto({ slug, role })),
    })

  const aboutWithConsole = () =>
    vi.fn(async () => anAbout({ features: { siteAdmin: true, forgotPassword: false } }))

  const original = window.matchMedia
  afterEach(() => {
    window.matchMedia = original
  })

  it('keeps the query of the page the host was heading for, an audit filtered to one client for one', async () => {
    open(fakeApi(), { from: '/admin/site/audit?clientId=c-1' })
    await signIn()

    expect(await screen.findByText('Arrivé /admin/site/audit?clientId=c-1')).toBeVisible()
  })

  it('asks the server nothing about where to land when the host chose a page', async () => {
    const api = withEvents(['mariage'], 'moderator')
    open(api, { from: '/admin/site/audit?clientId=c-1' })
    await signIn()

    await screen.findByText(/Arrivé/)
    expect(api.listEvents).not.toHaveBeenCalled()
  })

  it('lands a moderator of one event on that event’s moderation queue', async () => {
    open(withEvents(['mariage'], 'moderator'))
    await signIn()

    expect(await screen.findByText('Arrivé /admin/events/mariage/moderation')).toBeVisible()
  })

  it('lands them on the phone’s queue when the screen is a phone’s', async () => {
    window.matchMedia = vi.fn(() => ({ matches: true }) as MediaQueryList)
    open(withEvents(['mariage'], 'moderator'))
    await signIn()

    expect(await screen.findByText('Arrivé /admin/events/mariage/moderation/mobile')).toBeVisible()
  })

  it('treats the dashboard as no choice at all, so a bounce from /admin still lands the moderator on the queue', async () => {
    open(withEvents(['mariage'], 'moderator'), { from: '/admin' })
    await signIn()

    expect(await screen.findByText('Arrivé /admin/events/mariage/moderation')).toBeVisible()
  })

  it('lands the owner of one event on the list of events', async () => {
    open(withEvents(['mariage'], 'owner'))
    await signIn()

    expect(await screen.findByText('Arrivé /admin')).toBeVisible()
  })

  it('lands a moderator of two events on the list, where they choose', async () => {
    open(withEvents(['mariage', 'gala'], 'moderator'))
    await signIn()

    expect(await screen.findByText('Arrivé /admin')).toBeVisible()
  })

  it('lands an operator with no event and no client on the console', async () => {
    // Nobody before the form is sent, the operator once it has been: the sign-in page reads the
    // session when it opens, and the landing reads it again for the account's authority.
    const session = vi
      .fn<Api['session']>()
      .mockResolvedValueOnce({ authenticated: false })
      .mockResolvedValue({ authenticated: true, user: aSessionUser({ canOperateSite: true }) })
    open(fakeApi({ about: aboutWithConsole(), session }))
    await signIn()

    expect(await screen.findByText('Arrivé /admin/site')).toBeVisible()
  })

  it('lands a client’s member on the list of events, not on a console that is not theirs', async () => {
    open(
      fakeApi({
        about: aboutWithConsole(),
        myLimits: vi.fn(async () => ({ clients: [aClientLimits({ role: 'member' })] })),
      }),
    )
    await signIn()

    expect(await screen.findByText('Arrivé /admin')).toBeVisible()
  })

  it('lands an account that does not operate the box on the list, though the box has a console', async () => {
    open(fakeApi({ about: aboutWithConsole() }))
    await signIn()

    expect(await screen.findByText('Arrivé /admin')).toBeVisible()
  })

  it('lands the host on the list, and does not keep them on the form, when the reads fail', async () => {
    open(fakeApi({ listEvents: vi.fn(() => Promise.reject(ApiError.network())) }))
    await signIn()

    expect(await screen.findByText('Arrivé /admin')).toBeVisible()
  })
})

describe('LoginPage: a session that is still good (H13)', () => {
  const inAs = (overrides: Partial<CurrentUserDto> = {}) =>
    vi.fn(async (): Promise<SessionResponse> => ({
      authenticated: true,
      user: aSessionUser(overrides),
    }))

  it('sends the host on instead of showing a form for an account they are in', async () => {
    renderLogin(fakeApi({ session: inAs() }))

    expect(await screen.findByText(DASHBOARD)).toBeVisible()
    expect(screen.queryByLabelText(fr.auth.password)).toBeNull()
  })

  it('sends them where they were heading when they chose a page', async () => {
    renderArrivingFrom(fakeApi({ session: inAs() }), '/admin/events/mariage/moderation')

    expect(await screen.findByText(MODERATION)).toBeVisible()
  })

  it('sends a moderator of one event to the queue', async () => {
    renderLogin(
      fakeApi({
        session: inAs(),
        listEvents: vi.fn(async () => ({ items: [summary('mariage')] })),
        getEvent: vi.fn(async () => anEventDto({ slug: 'mariage', role: 'moderator' })),
      }),
    )

    expect(await screen.findByText(MODERATION)).toBeVisible()
  })

  it('shows the form to somebody who is not signed in, without waiting for the answer', async () => {
    renderLogin(fakeApi({ session: vi.fn(() => new Promise<never>(() => undefined)) }))

    expect(screen.getByLabelText(fr.auth.email)).toBeVisible()
  })

  it('keeps the very same form while the session is read, so what is being typed is not lost', async () => {
    // A form that re-mounted when the answer arrived would drop a keystroke, and a journey filling
    // it (Playwright holds the element) would find it detached.
    let answer: (session: SessionResponse) => void = () => undefined
    const api = fakeApi({
      session: vi.fn(() => new Promise<SessionResponse>((resolve) => (answer = resolve))),
    })
    renderLogin(api)
    const email = screen.getByLabelText(fr.auth.email)
    await userEvent.type(email, 'camille@example.com')

    await act(async () => answer({ authenticated: false }))

    expect(screen.getByLabelText(fr.auth.email)).toBe(email)
    expect(email.isConnected).toBe(true)
    expect(email).toHaveValue('camille@example.com')
  })

  it('does not read the session again once it has been read, whatever the form does after', async () => {
    const api = fakeApi()
    renderLogin(api)
    await waitFor(() => expect(api.session).toHaveBeenCalledTimes(1))

    await userEvent.type(screen.getByLabelText(fr.auth.email), 'camille@example.com')
    await userEvent.type(screen.getByLabelText(fr.auth.password), 'x')

    expect(api.session).toHaveBeenCalledTimes(1)
  })

  it('shows the form when the session could not be asked for', async () => {
    const api = fakeApi({ session: vi.fn(() => Promise.reject(ApiError.network())) })
    renderLogin(api)

    await waitFor(() => expect(api.session).toHaveBeenCalled())

    expect(screen.getByLabelText(fr.auth.email)).toBeVisible()
  })
})

describe('LoginPage: the small ways out (H16)', () => {
  const mailAbout = (forgotPassword: boolean) =>
    fakeApi({
      about: vi.fn(async () => anAbout({ features: { siteAdmin: false, forgotPassword } })),
    })

  it('says how a forgotten password is handled on a box that cannot send mail', async () => {
    renderLogin(mailAbout(false))

    expect(await screen.findByText(fr.auth.forgotNoMail)).toBeVisible()
    expect(screen.queryByRole('link', { name: fr.auth.forgotLink })).toBeNull()
  })

  it('offers the link, and not that sentence, on a box that can', async () => {
    renderLogin(mailAbout(true))

    expect(await screen.findByRole('link', { name: fr.auth.forgotLink })).toBeVisible()
    expect(screen.queryByText(fr.auth.forgotNoMail)).toBeNull()
  })

  it('says nothing about mail until the box has said what it can do', async () => {
    renderLogin(fakeApi({ about: vi.fn(() => new Promise<never>(() => undefined)) }))

    expect(screen.getByLabelText(fr.auth.email)).toBeVisible()
    expect(screen.queryByText(fr.auth.forgotNoMail)).toBeNull()
  })

  describe('the code step', () => {
    const challenged = (overrides: Partial<Api> = {}) =>
      fakeApi({ login: vi.fn(async () => ({ secondFactorRequired: true as const })), ...overrides })

    function BackButton() {
      const navigate = useNavigate()
      return (
        <button type="button" onClick={() => navigate(-1)}>
          navigateur: retour
        </button>
      )
    }

    /** The code step restored from history, as a reload leaves it. */
    const restored = (api: Api) =>
      renderWithProviders(
        <Routes>
          <Route
            path="/depart"
            element={<Navigate to="/login" replace state={{ step: 'code' }} />}
          />
          <Route path="/login" element={<LoginPage />} />
        </Routes>,
        { api, route: '/depart' },
      )

    it('is a history entry of its own, so Back returns to the password with what was typed', async () => {
      renderWithProviders(
        <>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
          </Routes>
          <BackButton />
        </>,
        { api: challenged(), route: '/login' },
      )
      await signIn('camille@example.com')
      await screen.findByRole('heading', { name: fr.auth.secondFactorTitle })

      await userEvent.click(screen.getByRole('button', { name: 'navigateur: retour' }))

      expect(await screen.findByLabelText(fr.auth.email)).toHaveValue('camille@example.com')
      expect(screen.queryByRole('heading', { name: fr.auth.secondFactorTitle })).toBeNull()
    })

    it('is still there after a reload, which keeps the entry’s state', async () => {
      restored(challenged())

      expect(await screen.findByRole('heading', { name: fr.auth.secondFactorTitle })).toBeVisible()
    })

    it('fails clearly back to the password step when the half-finished sign-in is gone', async () => {
      // A restored step with no cookie behind it: the server says the sign-in is over.
      restored(
        challenged({
          loginSecondFactor: vi.fn(() =>
            Promise.reject(new ApiError(401, 'auth.secondFactorExpired')),
          ),
        }),
      )

      await userEvent.type(await screen.findByLabelText(fr.auth.secondFactorCode), '123456')
      await userEvent.click(screen.getByRole('button', { name: fr.auth.secondFactorSubmit }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        fr.errors['auth.secondFactorExpired'],
      )
      expect(screen.getByLabelText(fr.auth.password)).toBeVisible()
    })
  })
})

describe('LoginPage: the landing of a session that is still good (H13), on the details', () => {
  const operator = () =>
    vi.fn(async (): Promise<SessionResponse> => ({
      authenticated: true,
      user: aSessionUser({ canOperateSite: true }),
    }))

  const render = (api: Api) =>
    renderWithProviders(
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/admin" element={<p>Arrivé /admin</p>} />
        <Route path="/admin/site" element={<p>Arrivé /admin/site</p>} />
      </Routes>,
      { api, route: '/login' },
    )

  it('sends an operator with nothing of their own to the console', async () => {
    render(
      fakeApi({
        session: operator(),
        about: vi.fn(async () => anAbout({ features: { siteAdmin: true, forgotPassword: false } })),
      }),
    )

    expect(await screen.findByText('Arrivé /admin/site')).toBeVisible()
  })

  it('waits for the box to say whether it has a console before deciding, which is a guess until then', async () => {
    const api = fakeApi({
      session: operator(),
      about: vi.fn(() => new Promise<never>(() => undefined)),
    })
    render(api)

    await waitFor(() => expect(api.session).toHaveBeenCalled())
    // Let the page settle: an absence checked before it could have appeared proves nothing.
    expect(await screen.findByRole('status')).toHaveTextContent(fr.auth.alreadySignedIn)
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(api.listEvents).not.toHaveBeenCalled()
  })

  it('sends them to the list of events when the reads never answer, instead of leaving a spinner', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const api = fakeApi({
        session: operator(),
        listEvents: vi.fn(() => new Promise<never>(() => undefined)),
      })
      render(api)
      await waitFor(() => expect(api.listEvents).toHaveBeenCalled())

      await vi.advanceTimersByTimeAsync(LANDING_TIMEOUT_MS)

      expect(await screen.findByText('Arrivé /admin')).toBeVisible()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not hold the form busy for a destination that is the sign-in page itself', async () => {
    renderWithProviders(
      <Routes>
        <Route
          path="/depart"
          element={<Navigate to="/login" replace state={{ from: '/login' }} />}
        />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/admin" element={<p>Arrivé /admin</p>} />
      </Routes>,
      { api: fakeApi(), route: '/depart' },
    )
    await signIn()

    expect(await screen.findByText('Arrivé /admin')).toBeVisible()
  })
})
