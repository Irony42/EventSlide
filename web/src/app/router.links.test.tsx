import { describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from './router'
import { de } from '../lib/i18n/de'
import { fr } from '../lib/i18n/fr'
import { SUPPORTED_LOCALES, type Locale } from '../lib/i18n/locale'
import { TRANSLATIONS } from '../lib/i18n/translations'
import {
  anAbout,
  aPrivacyNoticeState,
  aPublicEvent,
  aSessionUser,
  aWallResponse,
  fakeApi,
  renderWithProviders,
} from '../testing/renderWithProviders'
import { rememberGuestSession } from '../lib/guestSession'
import type { Api } from '../lib/api/client'
import type { SessionResponse, UploadResponse } from '../lib/api/dto'
import { at, asHost } from './testing/routerHarness'

/**
 * AGPL section 13, on screen (roadmap G1-04 / P1-05): the link to the source is on the
 * guest and host surfaces and **not** on the projected wall. The footer is mounted by the
 * layouts, so these are about which layout does and does not carry it — the one place
 * somebody removing it, or adding it to the wall, would be making an edit nobody reads.
 */
describe('the source offer', () => {
  const SOURCE_LINK = new RegExp(fr.about.sourceCode.replace(/[()]/g, '\\$&'), 'i')
  const sourceLink = () => screen.findByRole('link', { name: SOURCE_LINK })

  it.each([
    ['the join screen', '/join'],
    ['a resolved join code', '/join/H7K2QM'],
    ['a dead end under /join, which is still the guest’s surface', '/join/a/b'],
    ['a dead end under an event', '/e/camille-et-sacha/nothing/here'],
    ['the shared gallery', '/g/a-token'],
    ['the login screen', '/login'],
    ['an invitation', '/invite/a-token'],
    ['the forgotten-password form', '/password/forgot'],
    ['a reset link', '/password/reset/a-token'],
    ['an address that does not exist', '/nowhere'],
  ])('is offered on %s', async (_name, route) => {
    at(route)

    expect(await sourceLink()).toBeVisible()
  })

  it('is offered on the guest upload screen, under the composer', async () => {
    rememberGuestSession({ event: aPublicEvent(), displayName: null, privacyNotice: null })

    at('/e/camille-et-sacha/upload')

    expect(await screen.findByRole('heading', { name: 'Camille & Sacha' })).toBeVisible()
    expect(await sourceLink()).toBeVisible()
  })

  it.each(['/admin', '/admin/events/mariage/moderation', '/admin/password'])(
    'is offered on the host console at %s',
    async (route) => {
      asHost(route)

      expect(await sourceLink()).toBeVisible()
    },
  )

  it('is not on the projected wall, which is for the room and has nobody to read it', async () => {
    at('/e/camille-et-sacha/display')

    // The wall has rendered once its empty state is on screen; asserting absence before
    // that would be asserting it of a blank page.
    expect(await screen.findByText(fr.wall.empty)).toBeVisible()
    expect(screen.queryByRole('link', { name: SOURCE_LINK })).toBeNull()
    expect(screen.queryByRole('contentinfo')).toBeNull()
  })

  it('points at the address the server offered, wherever it is shown', async () => {
    const api = fakeApi({
      about: vi.fn(async () => anAbout({ sourceUrl: 'https://git.example.org/our/fork' })),
    })
    renderWithProviders(<AppRoutes />, { api, route: '/join' })

    await waitFor(async () =>
      expect(await sourceLink()).toHaveAttribute('href', 'https://git.example.org/our/fork'),
    )
  })

  it('serves /about with the version, the licence and the source, with no session', async () => {
    at('/about')

    expect(await screen.findByRole('heading', { level: 1, name: fr.about.title })).toBeVisible()
    expect(screen.getByText('AGPL-3.0-only')).toBeVisible()
  })

  it('carries the footer on /about as well, which lives under the guest layout', async () => {
    at('/about')

    await screen.findByRole('heading', { level: 1, name: fr.about.title })

    expect(screen.getByRole('contentinfo')).toBeVisible()
  })
})

/**
 * The support link (roadmap G4-02): shown to a host, on `/about`, and nowhere a guest or the
 * room can be. The footer is mounted by the layouts and the host's card by the event page,
 * so these are about which layout does and does not carry it — the one place somebody
 * "just adding it everywhere" would be making an edit nobody reads.
 *
 * Every absence below is asserted **after** `GET /api/about` has been answered with a
 * donation address and applied: an absence asserted while the request is still in flight
 * would pass on a layout that was about to render the link.
 */
describe('the support link', () => {
  const DONATE_URL = 'https://opencollective.com/eventslide'
  const BUDGET_URL = 'https://opencollective.com/eventslide/budget'

  const donating = (overrides: Partial<Api> = {}) =>
    fakeApi({
      about: vi.fn(async () => anAbout({ links: { donate: DONATE_URL, budget: BUDGET_URL } })),
      ...overrides,
    })

  const signedIn = {
    session: vi.fn(async (): Promise<SessionResponse> => ({
      authenticated: true,
      user: aSessionUser(),
    })),
  }

  const supportName = (locale: Locale) =>
    new RegExp(TRANSLATIONS[locale].about.supportLink.replace(/[()]/g, '\\$&'), 'i')
  const supportLink = () => screen.queryByRole('link', { name: supportName('fr') })

  /** Every address a link on the page leads to. */
  const hrefs = () => screen.queryAllByRole('link').map((link) => link.getAttribute('href'))

  /**
   * Lets every promise the fake API has already resolved reach the screen. The fakes answer
   * in a microtask, so one macrotask is enough and nothing here waits on a clock.
   */
  const settle = () =>
    act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    })

  /** Nothing on the page names the donation page, in any language, by address or by words. */
  const expectNoSupportAnywhere = () => {
    expect(hrefs()).not.toContain(DONATE_URL)
    expect(hrefs()).not.toContain(BUDGET_URL)
    for (const locale of SUPPORTED_LOCALES) {
      expect(screen.queryByText(TRANSLATIONS[locale].about.supportNoCounterpart)).toBeNull()
      expect(screen.queryByRole('link', { name: supportName(locale) })).toBeNull()
    }
  }

  describe('where it is offered', () => {
    it.each([
      ['the login screen', '/login'],
      ['the host console', '/admin'],
      ['the host’s password screen', '/admin/password'],
    ])('is in the footer on %s, once the operator has set DONATION_URL', async (_name, route) => {
      renderWithProviders(<AppRoutes />, { api: donating(signedIn), route })

      await waitFor(() =>
        expect(
          within(screen.getByRole('contentinfo')).getByRole('link', { name: supportName('fr') }),
        ).toHaveAttribute('href', DONATE_URL),
      )
    })

    it('is on /about, in the page, with the promise that a donation unlocks nothing', async () => {
      renderWithProviders(<AppRoutes />, { api: donating(), route: '/about' })

      expect(await screen.findByText(fr.about.supportNoCounterpart)).toBeVisible()
      expect(supportLink()).toHaveAttribute('href', DONATE_URL)
      expect(screen.getByRole('link', { name: new RegExp(fr.about.budgetLink) })).toHaveAttribute(
        'href',
        BUDGET_URL,
      )
    })

    it('is not in the footer of /about, which is the guest layout: the page carries it, the footer does not', async () => {
      renderWithProviders(<AppRoutes />, { api: donating(), route: '/about' })
      await screen.findByText(fr.about.supportNoCounterpart)

      expect(
        within(screen.getByRole('contentinfo')).queryByRole('link', { name: supportName('fr') }),
      ).toBeNull()
    })

    it.each([
      ['the login screen', '/login'],
      ['the host console', '/admin'],
      ['/about', '/about'],
    ])('is nowhere on %s of an instance whose operator set nothing', async (_name, route) => {
      const api = fakeApi({ about: vi.fn(async () => anAbout({ links: {} })), ...signedIn })
      renderWithProviders(<AppRoutes />, { api, route })

      await screen.findByRole('contentinfo')
      await settle()

      expect(supportLink()).toBeNull()
      expect(screen.queryByText(fr.about.supportTitle)).toBeNull()
    })
  })

  describe('where it never is', () => {
    it.each([
      ['a card printed against 1.0’s /upload address', '/upload'],
      ['a path with an event name and no prefix', '/photos/camille'],
      ['an address that does not exist', '/nowhere'],
    ])(
      'is not under the host footer’s catch-all, where a guest with a stale address lands: %s',
      async (_name, route) => {
        // The not-found screen is answered by `HostLayout`, so its footer is the host's. The
        // source offer is there; the donation link is not, because nobody here is a host.
        renderWithProviders(<AppRoutes />, { api: donating(signedIn), route })

        expect(await screen.findByRole('heading', { name: fr.shell.notFoundTitle })).toBeVisible()
        await screen.findByRole('link', {
          name: new RegExp(fr.about.sourceCode.replace(/[()]/g, '\\$&')),
        })
        await settle()

        expectNoSupportAnywhere()
      },
    )

    it.each([
      ['the join screen', '/join'],
      ['a resolved join code', '/join/H7K2QM'],
      ['a dead end under /join', '/join/a/b'],
      ['a dead end under an event', '/e/camille-et-sacha/nothing/here'],
      ['the shared gallery', '/g/a-token'],
    ])('is not on a guest surface: %s', async (_name, route) => {
      renderWithProviders(<AppRoutes />, { api: donating(), route })

      // The footer is the one thing every guest screen has in common, so its arrival says
      // the layout has rendered; `settle` then lets the donation answer reach it.
      await screen.findByRole('contentinfo')
      await settle()

      expectNoSupportAnywhere()
    })

    it('is not on the guest upload screen', async () => {
      rememberGuestSession({ event: aPublicEvent(), displayName: null, privacyNotice: null })
      renderWithProviders(<AppRoutes />, { api: donating(), route: '/e/camille-et-sacha/upload' })

      expect(await screen.findByRole('heading', { name: 'Camille & Sacha' })).toBeVisible()
      await screen.findByRole('contentinfo')
      await settle()

      expectNoSupportAnywhere()
    })

    it('is not on the guest upload screen while photographs are going up', async () => {
      // The moment a link would cost most: a thumb brushing the footer unmounts the page
      // and aborts every send in flight. So the screen is driven into the middle of one.
      rememberGuestSession({
        event: aPublicEvent(),
        displayName: 'Léa',
        privacyNotice: aPrivacyNoticeState(),
      })
      const api = donating({
        uploadPhotos: vi.fn(async (_slug: string, input) => {
          input.onProgress?.({ loaded: 600_000, total: 1_000_000, percent: 60 })
          return new Promise<UploadResponse>(() => {})
        }),
      })
      // jsdom has no IndexedDB, so the outbox falls back to memory and says so; that
      // fallback is the production path in private browsing and is not the subject here.
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      renderWithProviders(<AppRoutes />, { api, route: '/e/camille-et-sacha/upload' })

      await userEvent.upload(
        await screen.findByLabelText(fr.upload.addPhotos),
        new File([new Uint8Array([0xff, 0xd8, 0xff])], 'confettis.jpg', { type: 'image/jpeg' }),
      )
      await userEvent.click(screen.getByRole('button', { name: /Envoyer/ }))
      expect(
        await screen.findByRole('progressbar', { name: fr.upload.itemProgress(1) }),
      ).toBeVisible()
      await settle()

      // The footer was asked and answered, so the absence below is about the answer.
      expect(api.about).toHaveBeenCalled()
      expectNoSupportAnywhere()
    })

    it('is not on the projected wall, which is for the room and has nobody to be asked', async () => {
      renderWithProviders(<AppRoutes />, { api: donating(), route: '/e/camille-et-sacha/display' })

      // The wall has rendered once its empty state is on screen; asserting absence before
      // that would be asserting it of a blank page.
      expect(await screen.findByText(fr.wall.empty)).toBeVisible()
      await settle()

      expectNoSupportAnywhere()
      expect(screen.queryByRole('contentinfo')).toBeNull()
    })

    it('is not on a wall that speaks another language either', async () => {
      const api = donating({
        wall: vi.fn(async () => aWallResponse({ wallLanguage: 'de' })),
      })
      renderWithProviders(<AppRoutes />, { api, route: '/e/camille-et-sacha/display' })

      expect(await screen.findByText(de.wall.empty)).toBeVisible()
      await settle()

      expectNoSupportAnywhere()
    })
  })
})
