import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../lib/http'
import { AppRoutes } from './router'
import { de } from '../lib/i18n/de'
import { fr } from '../lib/i18n/fr'
import { it as italian } from '../lib/i18n/it'
import {
  aSessionUser,
  aWallResponse,
  fakeApi,
  renderWithProviders,
} from '../testing/renderWithProviders'
import type { EventSummaryDto, SessionResponse } from '../lib/api/dto'
import { langWhenShown } from './testing/routerHarness'

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
    // The reader the old rule forgot: a moderator invited by e-mail, who installed nothing
    // and has no reason to read French.
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
    // `live`: ending the evening is the one lifecycle move that is a single click away (opening
    // and archiving ask first).
    status: 'live',
    photoCount: 0,
    pendingCount: 0,
    guestCount: 0,
    usedBytes: 0,
    createdAt: '2026-06-20T21:04:11.031Z',
    role: 'owner',
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

    await userEvent.click(await screen.findByRole('button', { name: de.admin.closeEvent }))

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
