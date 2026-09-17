import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../lib/http'
import { AppRoutes } from './router'
import { de } from '../lib/i18n/de'
import { fr } from '../lib/i18n/fr'
import {
  aPublicEvent,
  aSessionUser,
  fakeApi,
  renderWithProviders,
} from '../testing/renderWithProviders'
import { rememberGuestSession } from '../lib/guestSession'
import type { EventSummaryDto, SessionResponse } from '../lib/api/dto'

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
    rememberGuestSession({ event: aPublicEvent(), displayName: null })

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
})

/**
 * Which surfaces the guest's language reaches, asserted through the real route table.
 *
 * This is the scope decision from `web/src/lib/i18n/translations.ts` at the one place
 * that enforces it: `GuestLayout` renders inside the language the guest chose, and
 * `HostLayout` and `WallLayout` put it back to French. Getting this wrong does not
 * crash anything — it half-translates an admin console — so nothing but a test finds it.
 */
describe('which surfaces speak the guest’s language', () => {
  it('renders the guest join screen in the language the guest is in', async () => {
    renderWithProviders(<AppRoutes />, { route: '/join', locale: 'de' })

    expect(await screen.findByRole('heading', { name: de.join.title })).toBeVisible()
  })

  it('offers the language picker on the guest surface', async () => {
    renderWithProviders(<AppRoutes />, { route: '/join', locale: 'de' })

    expect(await screen.findByRole('combobox', { name: de.app.language })).toBeVisible()
  })

  it('keeps the projected wall French, because there is one wall and a room in front of it', async () => {
    renderWithProviders(<AppRoutes />, { route: '/e/camille-et-sacha/display', locale: 'de' })

    expect(await screen.findByText(fr.wall.empty)).toBeVisible()
  })

  it('keeps the host console French, and offers no language to change it to', async () => {
    const api = fakeApi({
      session: vi.fn(async (): Promise<SessionResponse> => ({
        authenticated: true,
        user: aSessionUser(),
      })),
    })
    renderWithProviders(<AppRoutes />, { api, route: '/admin', locale: 'de' })

    expect(await screen.findByRole('heading', { name: fr.admin.events })).toBeVisible()
    expect(screen.queryByRole('combobox', { name: de.app.language })).toBeNull()
  })
})

/**
 * The toast region, which is the one piece of shared chrome that escaped the boundary.
 *
 * `ToastProvider` renders its region itself, so while it lived above the router in
 * `main.tsx` that region was above every `FrenchSurface` — and `Toast` reads its own copy
 * from the active table. A host whose browser is set to German got a German dismiss
 * control inside an otherwise French moderation toast, having chosen nothing, because
 * detection reads `navigator.languages`. It is invisible unless somebody is using a
 * screen reader, which is exactly when it matters.
 *
 * So this drives a **real toast through the real route table**: the failure was
 * positional, and a test that asserted where the provider sits would pass on a tree that
 * still rendered the wrong language. It opens `/admin` in a German browser, makes a
 * lifecycle change fail, and reads the control the host would actually reach for.
 *
 * There is no guest half to assert because no guest screen raises a toast today. That is
 * also why the provider went into all three layouts rather than into the host one: the
 * day a guest screen does raise one, it is already in the right language.
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

  it('speaks French on the host console, in a browser asking for German', async () => {
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

    await userEvent.click(await screen.findByRole('button', { name: fr.admin.goLive }))

    // The toast itself, and the control on it. Both French, on a surface the guest's
    // choice must not reach.
    expect(await screen.findByText(fr.errors.network)).toBeVisible()
    expect(screen.getByRole('button', { name: fr.ui.dismissNotification })).toBeVisible()
    expect(screen.queryByRole('button', { name: de.ui.dismissNotification })).toBeNull()
  })
})

/**
 * A stale link a guest followed, which is not the same screen as a mistyped admin URL.
 *
 * The catch-all lives under the host layout, which is right for `/admin/evenements` —
 * a host mistyping their own console gets a French 404 at host width. It is wrong for
 * the address printed on a card a year ago: that guest is holding a phone, they may not
 * read French, and "this address does not exist, go here instead" is the one sentence on
 * that screen worth anything. The guest-shaped addresses get their own catch-all inside
 * the guest layout, so the surface, the width and the language all follow the reader.
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

  it('still answers a mistyped admin address in French, at host width', async () => {
    renderWithProviders(<AppRoutes />, { route: '/admin/evenements', locale: 'de' })

    expect(await screen.findByRole('heading', { name: fr.shell.notFoundTitle })).toBeVisible()
  })
})
