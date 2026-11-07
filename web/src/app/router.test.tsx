import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppRoutes } from './router'
import { de } from '../lib/i18n/de'
import { fr } from '../lib/i18n/fr'
import {
  aClientLimits,
  anAbout,
  aPublicEvent,
  aSessionUser,
  fakeApi,
  renderWithProviders,
} from '../testing/renderWithProviders'
import { rememberGuestSession } from '../lib/guestSession'
import type { SessionResponse } from '../lib/api/dto'
import { at, asHost } from './testing/routerHarness'

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

  it('serves the photographs of the evening to a joined guest', async () => {
    rememberGuestSession({ event: aPublicEvent(), displayName: null, privacyNotice: null })

    at('/e/camille-et-sacha/photos')

    expect(await screen.findByRole('heading', { name: fr.feed.title })).toBeVisible()
  })

  it('serves the wall without a session, because a projector has nobody to log it in', async () => {
    at('/e/camille-et-sacha/display')

    // Not a heading query: on the wall the h1 is the event *name*, because that is what
    // the room reads from the back. This line is the supporting copy beneath it.
    //
    // An explicit timeout: the route awaits a lazy `WallPage` import, and on a loaded
    // machine (CI, or several test runs at once) that import alone outlasts the 1 000 ms a
    // `findBy` allows by default, which is what made this test fail one run in a few.
    expect(await screen.findByText(fr.wall.empty, undefined, { timeout: 5000 })).toBeVisible()
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

  it('sends an anonymous visitor away from the ambiance editor', async () => {
    at('/admin/events/mariage/settings/ambiance')

    expect(await screen.findByRole('heading', { name: fr.auth.title })).toBeVisible()
    expect(screen.queryByRole('heading', { name: fr.admin.customAmbianceTitle })).toBeNull()
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
    ['/admin/events/mariage/settings/ambiance', fr.admin.customAmbianceTitle],
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
    expect(screen.queryByRole('heading', { name: fr.upload.notJoinedTitle })).toBeNull()
  })

  it('answers an unknown guest-looking address with a 404 too', async () => {
    at('/e/camille-et-sacha/album')

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
 * A stale link a guest followed, which is not the same screen as a mistyped admin URL.
 *
 * The catch-all lives under the host layout, which is right for `/admin/evenements` — a
 * host mistyping their own console gets a 404 at host width. It is wrong for the address
 * printed on a card a year ago: that guest is holding a phone and a laptop-width empty
 * state is not what they need. The guest-shaped addresses get their own catch-all inside
 * the guest layout, so the surface and the width follow the reader as the language
 * already does.
 */
/**
 * The client's own space is registered only on a box that has one (G2-16 / P3-17, G2-00 /
 * P3-21): with `SITE_ADMIN=off` a direct visit to its address is the not-found screen, as for
 * any address nobody wrote.
 */
describe('the client space address', () => {
  const asHostOnBox = (siteAdmin: boolean) =>
    renderWithProviders(<AppRoutes />, {
      route: '/admin/client',
      api: fakeApi({
        session: vi.fn(async (): Promise<SessionResponse> => ({
          authenticated: true,
          user: aSessionUser(),
        })),
        about: vi.fn(async () => anAbout({ features: { siteAdmin, forgotPassword: false } })),
        myLimits: vi.fn(async () => ({ clients: [aClientLimits()] })),
      }),
    })

  it('is the not-found screen when the box has no client space', async () => {
    asHostOnBox(false)

    expect(await screen.findByRole('heading', { name: fr.shell.notFoundTitle })).toBeVisible()
    expect(screen.queryByRole('heading', { name: fr.clientSpace.spaceTitle })).toBeNull()
  })

  it('serves the client space when the box has one', async () => {
    asHostOnBox(true)

    expect(await screen.findByRole('heading', { name: fr.clientSpace.spaceTitle })).toBeVisible()
  })
})

describe('an address that no longer exists', () => {
  it('answers a guest in their own language', async () => {
    renderWithProviders(<AppRoutes />, { route: '/join/H7K2QM/extra', locale: 'de' })

    expect(await screen.findByRole('heading', { name: de.shell.notFoundTitle })).toBeVisible()
  })

  it('answers a guest under an event address in their own language too', async () => {
    renderWithProviders(<AppRoutes />, { route: '/e/camille-et-sacha/album', locale: 'de' })

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

describe('the account menu', () => {
  const signedInApi = () =>
    fakeApi({
      session: vi.fn(async (): Promise<SessionResponse> => ({
        authenticated: true,
        user: aSessionUser({ email: 'camille@example.org' }),
      })),
    })

  it('is in the header of the signed-in area, beside the language picker', async () => {
    renderWithProviders(<AppRoutes />, { api: signedInApi(), route: '/admin' })

    expect(await screen.findByRole('button', { name: fr.auth.accountMenu })).toBeVisible()
    expect(screen.getByRole('combobox', { name: fr.app.language })).toBeVisible()
  })

  it('is after the language picker, at the end of the line, so its list stays on a phone', async () => {
    // The list is anchored to the menu's end edge: put before the picker, the trigger is a
    // picker's width from the edge and a list as wide as its longest entry hangs off the other
    // side of a 360 px screen. jsdom has no geometry, so the order is what can be asserted here
    // and tests/e2e/journeys/moderator-invitation.spec.ts measures the box.
    renderWithProviders(<AppRoutes />, { api: signedInApi(), route: '/admin' })

    const menu = await screen.findByRole('button', { name: fr.auth.accountMenu })
    const picker = screen.getByRole('combobox', { name: fr.app.language })

    expect(picker.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('is not on the sign-in screen, even for a browser that still holds a session', async () => {
    renderWithProviders(<AppRoutes />, { api: signedInApi(), route: '/login' })

    await screen.findByRole('heading', { name: fr.auth.title })

    expect(screen.queryByRole('button', { name: fr.auth.accountMenu })).toBeNull()
  })

  it('is not on the guest surface', async () => {
    renderWithProviders(<AppRoutes />, { api: signedInApi(), route: '/join' })

    await screen.findByRole('heading', { name: fr.join.title })

    expect(screen.queryByRole('button', { name: fr.auth.accountMenu })).toBeNull()
  })

  it('is not offered to an anonymous visitor, who is sent to the sign-in instead', async () => {
    at('/admin')

    await screen.findByRole('heading', { name: fr.auth.title })

    expect(screen.queryByRole('button', { name: fr.auth.accountMenu })).toBeNull()
  })

  it('signs out from the console and lands on the sign-in screen', async () => {
    // Signed out for real: the sign-in page asks the session, and a session that is still good
    // would send the person back into the console (H13).
    let signedIn = true
    const api = fakeApi({
      session: vi.fn(async (): Promise<SessionResponse> =>
        signedIn
          ? { authenticated: true, user: aSessionUser({ email: 'camille@example.org' }) }
          : { authenticated: false },
      ),
      logout: vi.fn(async () => {
        signedIn = false
      }),
    })
    renderWithProviders(<AppRoutes />, { api, route: '/admin' })

    await userEvent.click(await screen.findByRole('button', { name: fr.auth.accountMenu }))
    await userEvent.click(screen.getByRole('button', { name: fr.auth.logout }))

    expect(await screen.findByRole('heading', { name: fr.auth.title })).toBeVisible()
    expect(api.logout).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: fr.auth.accountMenu })).toBeNull()
  })
})
