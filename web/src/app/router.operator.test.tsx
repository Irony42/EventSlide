import { describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../lib/http'
import { AppRoutes } from './router'
import { fr } from '../lib/i18n/fr'
import {
  anAbout,
  aPublicEvent,
  aSessionUser,
  fakeApi,
  renderWithProviders,
} from '../testing/renderWithProviders'
import { rememberGuestSession } from '../lib/guestSession'
import type { Api } from '../lib/api/client'
import type { SessionResponse } from '../lib/api/dto'
import { at } from './testing/routerHarness'

/**
 * The operator's links (roadmap G2-17 / P3-18): the report link on the guests' screens, the
 * help page on the host's, the three legal pages on both, and none of them on the wall.
 *
 * Which layout carries which is the whole claim, so every case here reads the footer the
 * layout built, **after** `GET /api/about` has been answered with all five addresses — an
 * absence asserted while the request is in flight would pass on a layout about to render it.
 */
describe('the operator’s links', () => {
  const ADDRESSES = {
    terms: 'https://hosted.example.org/legal/cgu',
    privacy: 'https://hosted.example.org/legal/confidentialite',
    legalNotice: '/legal/mentions',
    support: '/legal/avant-evenement',
    report: '/legal/signaler',
  } as const

  const operating = (overrides: Partial<Api> = {}) =>
    fakeApi({ about: vi.fn(async () => anAbout({ links: ADDRESSES })), ...overrides })

  const signedIn = {
    session: vi.fn(async (): Promise<SessionResponse> => ({
      authenticated: true,
      user: aSessionUser(),
    })),
  }

  const named = (label: string) => new RegExp(label.replace(/[()]/g, '\\$&'), 'i')
  const inFooter = () => within(screen.getByRole('contentinfo'))
  const settle = () =>
    act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    })

  /** The footer has heard the answer: the legal three are the first thing it adds. */
  const answered = () => screen.findAllByRole('link', { name: named(fr.about.termsLink) })

  describe('the report link, "Signaler un contenu"', () => {
    it.each([
      ['the join screen', '/join'],
      ['a resolved join code', '/join/H7K2QM'],
      ['a dead end under /join', '/join/a/b'],
      ['the shared gallery', '/g/a-token'],
      ['/about, which lives under the guest layout', '/about'],
    ])('is in the footer on %s', async (_name, route) => {
      renderWithProviders(<AppRoutes />, { api: operating(), route })

      await answered()

      expect(inFooter().getByRole('link', { name: named(fr.about.reportLink) })).toHaveAttribute(
        'href',
        ADDRESSES.report,
      )
    })

    it('is in the footer of the guest upload screen', async () => {
      rememberGuestSession({ event: aPublicEvent(), displayName: null, privacyNotice: null })
      renderWithProviders(<AppRoutes />, { api: operating(), route: '/e/camille-et-sacha/upload' })

      expect(await screen.findByRole('heading', { name: 'Camille & Sacha' })).toBeVisible()
      await answered()

      expect(inFooter().getByRole('link', { name: named(fr.about.reportLink) })).toHaveAttribute(
        'href',
        ADDRESSES.report,
      )
    })

    it.each([
      ['the login screen', '/login'],
      ['the host console', '/admin'],
      ['a stale address that lands under the host footer', '/nowhere'],
    ])('is not in the host’s footer: %s', async (_name, route) => {
      renderWithProviders(<AppRoutes />, { api: operating(signedIn), route })

      await answered()
      await settle()

      expect(inFooter().queryByRole('link', { name: named(fr.about.reportLink) })).toBeNull()
    })

    it('is not on the projected wall, which has no footer and nobody to press it', async () => {
      renderWithProviders(<AppRoutes />, {
        api: operating(),
        route: '/e/camille-et-sacha/display',
      })

      expect(await screen.findByText(fr.wall.empty)).toBeVisible()
      await settle()

      expect(screen.queryByRole('contentinfo')).toBeNull()
      expect(screen.queryByRole('link', { name: named(fr.about.reportLink) })).toBeNull()
    })
  })

  describe('the help page, SUPPORT_URL', () => {
    it.each([
      ['the login screen', '/login'],
      ['the host console', '/admin'],
    ])('is in the footer on %s', async (_name, route) => {
      renderWithProviders(<AppRoutes />, { api: operating(signedIn), route })

      await answered()

      expect(inFooter().getByRole('link', { name: named(fr.about.helpLink) })).toHaveAttribute(
        'href',
        ADDRESSES.support,
      )
    })

    it.each([
      ['the join screen', '/join'],
      ['the shared gallery', '/g/a-token'],
      ['a stale address that lands under the host footer', '/nowhere'],
    ])('is not in the footer on %s', async (_name, route) => {
      renderWithProviders(<AppRoutes />, { api: operating(signedIn), route })

      await answered()
      await settle()

      expect(inFooter().queryByRole('link', { name: named(fr.about.helpLink) })).toBeNull()
    })
  })

  describe('the terms, the privacy policy and the legal notice', () => {
    it.each([
      ['the join screen', '/join'],
      ['the shared gallery', '/g/a-token'],
      ['the login screen', '/login'],
      ['the host console', '/admin'],
      ['a stale address under the host footer', '/nowhere'],
    ])('are in the footer on %s', async (_name, route) => {
      renderWithProviders(<AppRoutes />, { api: operating(signedIn), route })

      await answered()

      expect(inFooter().getByRole('link', { name: named(fr.about.privacyLink) })).toHaveAttribute(
        'href',
        ADDRESSES.privacy,
      )
      expect(
        inFooter().getByRole('link', { name: named(fr.about.legalNoticeLink) }),
      ).toHaveAttribute('href', ADDRESSES.legalNotice)
    })
  })

  describe('on an instance whose operator set nothing', () => {
    it.each([
      ['the join screen', '/join'],
      ['the shared gallery', '/g/a-token'],
      ['/about', '/about'],
      ['the login screen', '/login'],
      ['the host console', '/admin'],
    ])('the footer on %s has the two links it always had', async (_name, route) => {
      const api = fakeApi({ about: vi.fn(async () => anAbout({ links: {} })), ...signedIn })
      renderWithProviders(<AppRoutes />, { api, route })

      await screen.findByRole('contentinfo')
      await waitFor(() => expect(api.about).toHaveBeenCalled())
      await settle()

      expect(inFooter().getAllByRole('link')).toHaveLength(2)
    })
  })
})

describe('the pages a link opens', () => {
  const TOKEN = 'Z7q-Mx0Ld3Tn9VbRk2YcHs8WfAe5GuJi4PoXz1NvB6E'

  it('serves the invitation to somebody with no session, who is not sent to the sign-in', async () => {
    // The link is the credential: a gate in front of it would make every invitation end on a
    // sign-in page for an account that does not exist yet.
    const api = fakeApi()
    renderWithProviders(<AppRoutes />, { api, route: `/invite/${TOKEN}` })

    expect(await screen.findByLabelText(fr.auth.invitationName)).toBeVisible()
    expect(api.invitation).toHaveBeenCalledWith(TOKEN, expect.any(AbortSignal))
    expect(screen.queryByRole('heading', { name: fr.auth.title })).toBeNull()
  })

  it('serves the invitation in the host layout, with the language picker and the source offer', async () => {
    at(`/invite/${TOKEN}`)

    await screen.findByLabelText(fr.auth.invitationName)

    expect(screen.getByRole('combobox', { name: fr.app.language })).toBeVisible()
    // The AGPL offer is on every screen with a footer, and these are screens with one.
    expect(
      await screen.findByRole('link', {
        name: new RegExp(fr.about.sourceCode.replace(/[()]/g, '\\$&'), 'i'),
      }),
    ).toBeVisible()
  })

  it('answers a dead invitation with the one sentence, inside the same layout', async () => {
    const api = fakeApi({
      invitation: vi.fn(() => Promise.reject(new ApiError(404, 'invitation.notFound'))),
    })
    renderWithProviders(<AppRoutes />, { api, route: `/invite/${TOKEN}` })

    expect(await screen.findByRole('heading', { name: fr.auth.deadLinkTitle })).toBeVisible()
    expect(screen.getByRole('combobox', { name: fr.app.language })).toBeVisible()
  })

  it('serves the forgotten-password form with no session, on a box that can send mail', async () => {
    const api = fakeApi({
      about: vi.fn(async () => anAbout({ features: { siteAdmin: false, forgotPassword: true } })),
    })
    renderWithProviders(<AppRoutes />, { api, route: '/password/forgot' })

    expect(await screen.findByRole('heading', { name: fr.auth.forgotTitle })).toBeVisible()
    expect(await screen.findByLabelText(fr.auth.email)).toBeVisible()
  })

  it('says a box with no mail relay cannot reset a password, on the same address', async () => {
    const api = fakeApi({
      about: vi.fn(async () => anAbout({ features: { siteAdmin: false, forgotPassword: false } })),
    })
    renderWithProviders(<AppRoutes />, { api, route: '/password/forgot' })

    expect(await screen.findByText(fr.auth.forgotUnavailable)).toBeVisible()
    expect(screen.queryByLabelText(fr.auth.email)).toBeNull()
  })

  it('serves the reset form for the token in the path, with no session', async () => {
    const api = fakeApi()
    renderWithProviders(<AppRoutes />, { api, route: `/password/reset/${TOKEN}` })

    await userEvent.type(await screen.findByLabelText(fr.auth.newPassword), 'une-phrase-longue-1')
    await userEvent.type(screen.getByLabelText(fr.auth.confirmPassword), 'une-phrase-longue-1')
    await userEvent.click(screen.getByRole('button', { name: fr.auth.resetSubmit }))

    await waitFor(() =>
      expect(api.confirmPasswordReset).toHaveBeenCalledWith(TOKEN, 'une-phrase-longue-1'),
    )
  })

  it.each(['/invite', '/invite/', '/password', '/password/reset', '/password/reset/'])(
    'answers %s, which carries no token, with the 404 rather than a form',
    async (route) => {
      at(route)

      expect(await screen.findByRole('heading', { name: fr.shell.notFoundTitle })).toBeVisible()
    },
  )

  it('answers a token with a segment too many with the 404 too', async () => {
    at(`/invite/${TOKEN}/extra`)

    expect(await screen.findByRole('heading', { name: fr.shell.notFoundTitle })).toBeVisible()
  })
})
