import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { ErrorBoundary } from './ErrorBoundary'
import { AppRoutes } from './router'
import { fr } from '../lib/i18n/fr'
import { aSessionUser, fakeApi, renderWithProviders } from '../testing/renderWithProviders'
import type { SessionResponse } from '../lib/api/dto'

/**
 * A host surface whose JavaScript chunk never arrives.
 *
 * This is the failure the lazy split buys and has to pay for: the admin screens are
 * separate chunks with hashed names, so a host who left a tab open across a deploy gets
 * a 404 for the file the route asks for, and venue Wi-Fi produces the same rejection
 * without any deploy at all. What `main.tsx` promises is that the outcome is a screen
 * with a way back, never a white rectangle.
 *
 * `vi.mock` on an internal module, which this repo otherwise bans (docs/TESTING.md §3):
 * a module loader failure has no seam to inject. Nothing about the *application* is
 * faked here — the mock only makes `import()` reject exactly as a missing chunk does —
 * and it is confined to this file, which contains the one test that needs it.
 */
vi.mock('../features/admin/DashboardPage', () => {
  throw new Error('Failed to fetch dynamically imported module: /assets/DashboardPage-3f9a2c.js')
})

const asHost = (route: string) => {
  const api = fakeApi({
    session: vi.fn(async (): Promise<SessionResponse> => ({
      authenticated: true,
      user: aSessionUser(),
    })),
  })
  return renderWithProviders(
    <ErrorBoundary>
      <AppRoutes />
    </ErrorBoundary>,
    { api, route },
  )
}

describe('AppRoutes with a chunk that cannot be loaded', () => {
  it('shows a way back instead of a white screen', async () => {
    // React logs every error it hands to a boundary; the boundary's own behaviour is
    // what is under test.
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})

    asHost('/admin')

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.shell.crashTitle)
    expect(screen.getByRole('button', { name: fr.app.retry })).toBeVisible()
    log.mockRestore()
  })

  it('never puts the loader’s own message in front of the host', async () => {
    // "Failed to fetch dynamically imported module" is a sentence about a build, in
    // English, and a host at a wedding can do nothing with it.
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})

    asHost('/admin')

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.shell.crashHint)
    expect(screen.queryByText(/dynamically imported module/)).toBeNull()
    log.mockRestore()
  })
})
