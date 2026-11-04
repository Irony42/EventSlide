import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fr } from '../../lib/i18n/fr'
import {
  aWallItem,
  aWallResponse,
  fakeApi,
  renderWithProviders,
} from '../../testing/renderWithProviders'
import { CURSOR_IDLE_MS } from './hooks/useIdleCursor'
import { WallPage } from './WallPage'

const hover = (none: boolean) =>
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: none && query === '(hover: none)',
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
    })),
  )

const renderWall = () => {
  const api = fakeApi({
    wall: vi.fn(async () =>
      aWallResponse({
        items: [aWallItem()],
        sound: { enabled: true, tone: 'chime', volume: 50 },
      }),
    ),
  })
  renderWithProviders(<WallPage />, {
    api,
    route: '/e/camille-et-sacha/display',
    path: '/e/:slug/display',
  })
}

const idle = () => new Promise((resolve) => setTimeout(resolve, CURSOR_IDLE_MS + 300))

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the wall sound button on a screen without a pointer (spec 12)', () => {
  it('stays reachable on a touch screen, where no pointer ever moves', async () => {
    hover(true)
    renderWall()
    const name = fr.wall.soundActivate
    await screen.findByRole('button', { name })

    await idle()

    expect(screen.getByRole('button', { name })).toBeVisible()
  })

  it('still goes away with the idle cursor where there is a mouse', async () => {
    hover(false)
    renderWall()
    const name = fr.wall.soundActivate
    await screen.findByRole('button', { name })

    await idle()

    expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
  })
})
