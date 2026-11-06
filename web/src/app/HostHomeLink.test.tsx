import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { aSessionUser, fakeApi, renderWithProviders } from '../testing/renderWithProviders'
import type { Api } from '../lib/api/client'
import type { SessionResponse } from '../lib/api/dto'

const signedIn = (): Api =>
  fakeApi({
    session: vi.fn(async (): Promise<SessionResponse> => ({
      authenticated: true,
      user: aSessionUser(),
    })),
  })
import { fr } from '../lib/i18n/fr'
import { HostHomeLink } from './HostHomeLink'

describe('HostHomeLink', () => {
  it('is a link to the host events list, named for where it goes', async () => {
    renderWithProviders(<HostHomeLink />, { api: signedIn() })

    const link = await screen.findByRole('link', { name: `${fr.app.name} · ${fr.shell.hostHome}` })
    expect(link).toHaveAttribute('href', '/admin')
  })

  it('draws the mark alone and decorative, so the name is read once', async () => {
    const { container } = renderWithProviders(<HostHomeLink />, { api: signedIn() })

    await screen.findByRole('link', { name: `${fr.app.name} · ${fr.shell.hostHome}` })
    expect(screen.queryByRole('img')).toBeNull()
    expect(container.querySelector('svg')).toHaveAttribute('viewBox', '0 0 100 100')
  })
})

describe('HostHomeLink without a session', () => {
  it('shows nothing to somebody the server does not know', async () => {
    const api = fakeApi({
      session: vi.fn(async (): Promise<SessionResponse> => ({ authenticated: false })),
    })
    renderWithProviders(<HostHomeLink />, { api })

    await vi.waitFor(() => expect(api.session).toHaveBeenCalled())
    expect(screen.queryByRole('link')).toBeNull()
  })
})
