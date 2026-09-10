import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { AppRoutes } from './router'
import { fr } from '../lib/i18n/fr'
import {
  aPublicEvent,
  aSessionUser,
  fakeApi,
  renderWithProviders,
} from '../testing/renderWithProviders'
import { rememberGuestSession } from '../lib/guestSession'
import type { SessionResponse } from '../lib/api/dto'

const at = (route: string) => renderWithProviders(<AppRoutes />, { route })

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
    const api = fakeApi({
      session: vi.fn(async (): Promise<SessionResponse> => ({
        authenticated: true,
        user: aSessionUser(),
      })),
    })

    renderWithProviders(<AppRoutes />, { api, route: '/admin/events/mariage/moderation' })

    expect(await screen.findByRole('heading', { name: fr.moderation.title })).toBeVisible()
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
