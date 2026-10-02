import { describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../lib/http'
import { AppRoutes } from './router'
import { de } from '../lib/i18n/de'
import { fr } from '../lib/i18n/fr'
import { it as italian } from '../lib/i18n/it'
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
import type { EventSummaryDto, SessionResponse, UploadResponse } from '../lib/api/dto'

const at = (route: string) => renderWithProviders(<AppRoutes />, { route })

/** A host with a resolved session, which is what every `/admin/**` address needs. */
const asHost = (route: string) => {
  const api = fakeApi({
    session: vi.fn(async (): Promise<SessionResponse> => ({
      authenticated: true,
      user: aSessionUser(),
    })),
  })
  return renderWithProviders(<AppRoutes />, { api, route })
}

/**
 * The value of `<html lang>` at the moment `text` first reaches the DOM.
 *
 * Not "once `findByText` resolves", which is a later moment by an amount nobody controls:
 * whether React's passive effects have run by then depends on the order of two timers
 * that Node does not fix, and `main` went red on exactly that once, green on a re-run.
 * A MutationObserver callback is a microtask queued by the commit itself, so it reads the
 * attribute before anything scheduled after that commit has had a turn — a screen reader
 * arriving on the first frame hears what this sees.
 *
 * It gives up after `timeoutMs` with the text it was waiting for, rather than hanging to
 * the test's own timeout with a message that names nothing, and it disconnects either way
 * so an abandoned observer cannot resolve on a later test's DOM.
 */
const langWhenShown = (text: string, timeoutMs = 3_000): Promise<string> =>
  new Promise((resolve, reject) => {
    const observer = new MutationObserver(() => {
      if (!document.body.textContent?.includes(text)) return
      stop()
      resolve(document.documentElement.lang)
    })
    const timer = setTimeout(() => {
      stop()
      reject(new Error(`"${text}" never reached the DOM within ${timeoutMs} ms`))
    }, timeoutMs)
    const stop = (): void => {
      observer.disconnect()
      clearTimeout(timer)
    }
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  })

describe('AppRoutes', () => {
  it('opens on the guest join screen', async () => {
    at('/')

    expect(await screen.findByRole('heading', { name: fr.join.title })).toBeVisible()
  })

  it('resolves a join code from the path', async () => {
    // 1.0 emitted `?partyname=` and read `?party`, so every guest silently uploaded to
    // the default event. The code is a path segment now, and the screen it resolves to
    // names the event, so a wrong resolution is visible rather than silent.
    at('/join/H7K2QM')

    expect(
      await screen.findByRole('heading', { name: fr.join.welcome('Camille & Sacha') }),
    ).toBeVisible()
  })

  it('serves the guest upload screen for an event', async () => {
    // The screen renders the event the join step returned, so the route is exercised
    // from a joined guest's state rather than a cold one.
    rememberGuestSession({ event: aPublicEvent(), displayName: null, privacyNotice: null })

    at('/e/camille-et-sacha/upload')

    expect(await screen.findByRole('heading', { name: 'Camille & Sacha' })).toBeVisible()
  })

  it('serves the wall without a session, because a projector has nobody to log it in', async () => {
    at('/e/camille-et-sacha/display')

    // Not a heading query: on the wall the h1 is the event *name*, because that is what
    // the room reads from the back. This line is the supporting copy beneath it.
    expect(await screen.findByText(fr.wall.empty)).toBeVisible()
  })

  it('serves the login screen', async () => {
    at('/login')

    expect(await screen.findByRole('heading', { name: fr.auth.title })).toBeVisible()
  })

  it('sends an anonymous visitor away from the admin surface', async () => {
    at('/admin')

    expect(await screen.findByRole('heading', { name: fr.auth.title })).toBeVisible()
    expect(screen.queryByRole('heading', { name: fr.admin.events })).toBeNull()
  })

  it('serves the moderation console to a signed-in host', async () => {
    asHost('/admin/events/mariage/moderation')

    expect(await screen.findByRole('heading', { name: fr.moderation.title })).toBeVisible()
  })

  /**
   * One case per admin address.
   *
   * Every one of these is a separate lazily-loaded chunk declared in a block of
   * near-identical `lazy()` calls, and the failure mode is a copy-paste: two addresses
   * resolving to the same screen. Naming the heading each address must produce is what
   * makes that a red test instead of a host wondering why "Nouvel évènement" opens the
   * dashboard.
   */
  it.each([
    ['/admin', fr.admin.events],
    ['/admin/events/new', fr.admin.newEvent],
    ['/admin/events/mariage', 'Camille & Sacha'],
    ['/admin/events/mariage/settings', fr.admin.settings],
    // The phone console is a second address over the same queue, so its heading is
    // deliberately not the console's — two addresses that render the same title are
    // exactly the copy-paste this table exists to catch.
    ['/admin/events/mariage/moderation/mobile', fr.mobileModeration.title],
    ['/admin/password', fr.auth.changePassword],
  ])('serves %s to a signed-in host', async (route, heading) => {
    asHost(route)

    expect(await screen.findByRole('heading', { name: heading })).toBeVisible()
  })

  it('answers an unknown address with a 404 rather than the guest upload page', async () => {
    // 1.0 redirected everything to /upload, so a typo in an admin URL silently landed
    // a host on a guest screen and looked like a deleted event.
    at('/admin/evenements')

    expect(await screen.findByRole('heading', { name: fr.shell.notFoundTitle })).toBeVisible()
    expect(screen.queryByRole('heading', { name: fr.upload.title })).toBeNull()
  })

  it('answers an unknown guest-looking address with a 404 too', async () => {
    at('/e/camille-et-sacha/photos')

    expect(await screen.findByRole('heading', { name: fr.shell.notFoundTitle })).toBeVisible()
  })

  it('opens the shared gallery for the token in the path, with no session', async () => {
    // Roadmap §4.1: the token is a path segment, like the join code, and it is the whole
    // credential. The page is a lazy chunk under the guest layout, so this is also the
    // case that proves the layout gave it a place to load into.
    const { api } = at(`/g/${'Q'.repeat(43)}`)

    expect(await screen.findByRole('heading', { level: 1, name: 'Camille & Sacha' })).toBeVisible()
    expect(api.gallery).toHaveBeenCalledWith('Q'.repeat(43), expect.any(AbortSignal))
    expect(api.session).not.toHaveBeenCalled()
  })

  it('answers a gallery address with a segment too many with a 404', async () => {
    at(`/g/${'Q'.repeat(43)}/extra`)

    expect(await screen.findByRole('heading', { name: fr.shell.notFoundTitle })).toBeVisible()
  })
})

/**
 * Which language each surface speaks, asserted through the real route table.
 *
 * Two of the three surfaces follow the **reader**; the third follows the **event**,
 * because a projector has nobody in front of it. Getting it wrong crashes nothing — it
 * puts a room's wall in the language of whichever laptop was plugged in, which is a
 * sentence no exception ever throws.
 */
describe('which language each surface speaks', () => {
  it('renders the guest join screen in the language the guest is in', async () => {
    renderWithProviders(<AppRoutes />, { route: '/join', locale: 'de' })

    expect(await screen.findByRole('heading', { name: de.join.title })).toBeVisible()
  })

  it('offers the language picker on the guest surface', async () => {
    renderWithProviders(<AppRoutes />, { route: '/join', locale: 'de' })

    expect(await screen.findByRole('combobox', { name: de.app.language })).toBeVisible()
  })

  it('renders the host console in the language the host is in', async () => {
    // The reader the old rule forgot: a moderator invited by e-mail and handed a
    // temporary password, who installed nothing and has no reason to read French.
    const api = fakeApi({
      session: vi.fn(async (): Promise<SessionResponse> => ({
        authenticated: true,
        user: aSessionUser(),
      })),
    })
    renderWithProviders(<AppRoutes />, { api, route: '/admin', locale: 'de' })

    expect(await screen.findByRole('heading', { name: de.admin.events })).toBeVisible()
  })

  it('offers the language picker on the host console too', async () => {
    // One picker, one stored preference: a host at their own wedding is a guest later.
    const api = fakeApi({
      session: vi.fn(async (): Promise<SessionResponse> => ({
        authenticated: true,
        user: aSessionUser(),
      })),
    })
    renderWithProviders(<AppRoutes />, { api, route: '/admin', locale: 'de' })

    expect(await screen.findByRole('combobox', { name: de.app.language })).toBeVisible()
  })

  it('renders the projected wall in the event’s language, not the reader’s', async () => {
    // The one surface that does not follow the browser. The reader here is whoever
    // plugged the laptop in, and the room was promised the language the host set on the
    // event — so a German browser showing an Italian event must show Italian.
    const api = fakeApi({
      wall: vi.fn(async () => aWallResponse({ wallLanguage: 'it' })),
    })
    renderWithProviders(<AppRoutes />, {
      api,
      route: '/e/camille-et-sacha/display',
      locale: 'de',
    })

    expect(await screen.findByText(italian.wall.empty)).toBeVisible()
    expect(screen.queryByText(de.wall.empty)).toBeNull()
  })

  it('offers no language picker on the wall, because nobody there can be asked', async () => {
    renderWithProviders(<AppRoutes />, { route: '/e/camille-et-sacha/display', locale: 'de' })

    expect(await screen.findByText(fr.wall.empty)).toBeVisible()
    expect(screen.queryByRole('combobox', { name: de.app.language })).toBeNull()
  })

  it('puts the event’s language on <html lang>, so a screen reader pronounces it right', async () => {
    const api = fakeApi({
      wall: vi.fn(async () => aWallResponse({ wallLanguage: 'it' })),
    })
    const lang = langWhenShown(italian.wall.empty)
    renderWithProviders(<AppRoutes />, {
      api,
      route: '/e/camille-et-sacha/display',
      locale: 'de',
    })

    expect(await lang).toBe('it')
  })

  /**
   * Two ways the response can fail to name a language the client has words for, and the
   * one answer that must not be given to either.
   *
   * `WallPage` narrows `wallLanguage` through `parseLocale` rather than casting it, and
   * that was a rule in a comment with nothing behind it until these two cases: a cast
   * compiles, and on a French machine it looks fine. What it actually produces is
   * `translationsFor('pt')`, which is `undefined`, on a projector.
   *
   * The reader's language is German in both, so falling back to the browser — the one
   * answer this whole mechanism exists to refuse — is distinguishable from falling back
   * to the default.
   */
  it('falls back to the default for a language this build has no table for', async () => {
    // A projector left open across a deploy that added a sixth language, or rolled one
    // back. The tag is valid to the server and unknown here.
    const api = fakeApi({
      wall: vi.fn(async () => aWallResponse({ wallLanguage: 'pt' as 'fr' })),
    })
    const lang = langWhenShown(fr.wall.empty)
    renderWithProviders(<AppRoutes />, {
      api,
      route: '/e/camille-et-sacha/display',
      locale: 'de',
    })

    expect(await screen.findByText(fr.wall.empty)).toBeVisible()
    expect(screen.queryByText(de.wall.empty)).toBeNull()
    expect(await lang).toBe('fr')
  })

  it('falls back to the default for a server build that sends no language at all', async () => {
    const { wallLanguage: _absent, ...withoutLanguage } = aWallResponse()
    const api = fakeApi({ wall: vi.fn(async () => withoutLanguage) })
    renderWithProviders(<AppRoutes />, {
      api,
      route: '/e/camille-et-sacha/display',
      locale: 'de',
    })

    expect(await screen.findByText(fr.wall.empty)).toBeVisible()
    expect(screen.queryByText(de.wall.empty)).toBeNull()
  })
})

/**
 * The toast region, which is the one piece of shared chrome that escaped the boundary.
 *
 * `ToastProvider` renders its region itself, so a provider above the router renders one
 * region for three surfaces — and `Toast` reads its own copy from the active table.
 * While the consoles were French this showed up as a German dismiss control inside a
 * French moderation toast; now that they are not, the surviving case is the **wall**,
 * whose language belongs to the event while the region above it would carry the language
 * of whoever plugged the laptop in. It is invisible unless somebody is using a screen
 * reader, which is exactly when it matters.
 *
 * So this drives a **real toast through the real route table**: the failure is
 * positional, and a test that asserted where the provider sits would pass on a tree that
 * still rendered the wrong language.
 */
describe('the toast region', () => {
  /** `GET /api/events` answers with summaries; the shared harness has no factory for them. */
  const aSummary = (): EventSummaryDto => ({
    id: 'event-1',
    slug: 'camille-et-sacha',
    name: 'Camille & Sacha',
    // `draft` is the one status whose primary action is a single click away.
    status: 'draft',
    photoCount: 0,
    pendingCount: 0,
    guestCount: 0,
    usedBytes: 0,
    createdAt: '2026-06-20T21:04:11.031Z',
  })

  it('speaks the host’s own language on the host console', async () => {
    const api = fakeApi({
      session: vi.fn(async (): Promise<SessionResponse> => ({
        authenticated: true,
        user: aSessionUser(),
      })),
      listEvents: vi.fn(async () => ({ items: [aSummary()] })),
      setEventStatus: vi.fn(async () => {
        throw ApiError.network()
      }),
    })
    renderWithProviders(<AppRoutes />, { api, route: '/admin', locale: 'de' })

    await userEvent.click(await screen.findByRole('button', { name: de.admin.goLive }))

    // The toast itself, and the control on it. Both German, because the host is reading
    // German — the console and the chrome over it are one screen.
    expect(await screen.findByText(de.errors.network)).toBeVisible()
    expect(screen.getByRole('button', { name: de.ui.dismissNotification })).toBeVisible()
    expect(screen.queryByRole('button', { name: fr.ui.dismissNotification })).toBeNull()
  })

  it('speaks the event’s language over the wall, not the reader’s', async () => {
    // The case the provider's placement now exists for. Nothing on the wall raises a
    // toast on its own, so this renders the region directly under the wall's own locale
    // boundary rather than inventing a projector failure that does not exist.
    const api = fakeApi({
      wall: vi.fn(async () => aWallResponse({ wallLanguage: 'it' })),
    })
    const lang = langWhenShown(italian.wall.empty)
    renderWithProviders(<AppRoutes />, {
      api,
      route: '/e/camille-et-sacha/display',
      locale: 'de',
    })

    // The region is inside `DeferredLocale`, so anything it ever renders is Italian.
    expect(await lang).toBe('it')
  })
})

/**
 * A stale link a guest followed, which is not the same screen as a mistyped admin URL.
 *
 * The catch-all lives under the host layout, which is right for `/admin/evenements` — a
 * host mistyping their own console gets a 404 at host width. It is wrong for the address
 * printed on a card a year ago: that guest is holding a phone and a laptop-width empty
 * state is not what they need. The guest-shaped addresses get their own catch-all inside
 * the guest layout, so the surface and the width follow the reader as the language
 * already does.
 */
describe('an address that no longer exists', () => {
  it('answers a guest in their own language', async () => {
    renderWithProviders(<AppRoutes />, { route: '/join/H7K2QM/extra', locale: 'de' })

    expect(await screen.findByRole('heading', { name: de.shell.notFoundTitle })).toBeVisible()
  })

  it('answers a guest under an event address in their own language too', async () => {
    renderWithProviders(<AppRoutes />, { route: '/e/camille-et-sacha/photos', locale: 'de' })

    expect(await screen.findByRole('heading', { name: de.shell.notFoundTitle })).toBeVisible()
  })

  it('answers a mistyped admin address in the host’s language, at host width', async () => {
    // The half of this comment that was about language is gone: the host catch-all reads
    // the same table the guest one does now. What is left is the width, which is why the
    // two catch-alls still exist.
    renderWithProviders(<AppRoutes />, { route: '/admin/evenements', locale: 'de' })

    expect(await screen.findByRole('heading', { name: de.shell.notFoundTitle })).toBeVisible()
  })
})

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
