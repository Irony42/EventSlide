import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../lib/http'
import { AppRoutes } from './router'
import { de } from '../lib/i18n/de'
import { fr } from '../lib/i18n/fr'
import { it as italian } from '../lib/i18n/it'
import {
  aPublicEvent,
  aSessionUser,
  aWallResponse,
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
 * Which language each surface speaks, asserted through the real route table.
 *
 * This is the decision from `web/src/lib/i18n/translations.ts` at the one place that
 * enforces it, and it is no longer one rule for two halves of the app. Two of the three
 * surfaces follow the **reader** — a guest and a host are each a person with a browser —
 * and the third follows the **event**, because a projector has nobody in front of it.
 *
 * Getting this wrong does not crash anything. It puts a room's wall in the language of
 * whichever laptop was plugged into it, which is a sentence no exception ever throws, so
 * nothing but a test finds it.
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
    // The reader this reverses the old rule for: a moderator invited by e-mail address and
    // handed a temporary password, who installed nothing and has no reason to read French.
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
    // One picker, one stored preference, both surfaces. A host at their own wedding is a
    // guest twenty minutes later.
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
    renderWithProviders(<AppRoutes />, {
      api,
      route: '/e/camille-et-sacha/display',
      locale: 'de',
    })

    await screen.findByText(italian.wall.empty)
    expect(document.documentElement.lang).toBe('it')
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
    renderWithProviders(<AppRoutes />, {
      api,
      route: '/e/camille-et-sacha/display',
      locale: 'de',
    })

    await screen.findByText(italian.wall.empty)

    // The region is inside `DeferredLocale`, so anything it ever renders is Italian.
    expect(document.documentElement.lang).toBe('it')
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
