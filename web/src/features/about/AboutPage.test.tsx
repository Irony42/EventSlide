import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { AboutPage } from './AboutPage'
import { fr } from '../../lib/i18n/fr'
import { anAbout, fakeApi, renderWithProviders } from '../../testing/renderWithProviders'

/**
 * Ring 5. `/about`: the long form of the footer's one-line AGPL section 13 offer — which
 * build this is, under which licence, and where its source is.
 */

const BUILD_VERSION = '0.0.0-build'
const BUILD_SOURCE_URL = 'https://source.test/eventslide/tree/v0.0.0-build'

const silentServer = () => fakeApi({ about: vi.fn(() => new Promise<never>(() => undefined)) })

describe('AboutPage', () => {
  it('shows the build’s own version and source at once, with no loading state', () => {
    renderWithProviders(<AboutPage />, { api: silentServer() })

    expect(screen.getByRole('heading', { level: 1, name: fr.about.title })).toBeVisible()
    expect(screen.getByText(BUILD_VERSION)).toBeVisible()
    expect(screen.getByRole('link', { name: new RegExp(BUILD_SOURCE_URL) })).toHaveAttribute(
      'href',
      BUILD_SOURCE_URL,
    )
  })

  it('names the licence', () => {
    renderWithProviders(<AboutPage />, { api: silentServer() })

    expect(screen.getByText(fr.about.licenseLabel)).toBeVisible()
    expect(screen.getByText('AGPL-3.0-only')).toBeVisible()
  })

  it('shows what the server says once it has said it', async () => {
    renderWithProviders(<AboutPage />, {
      api: fakeApi({
        about: vi.fn(async () =>
          anAbout({ version: '3.1.4', sourceUrl: 'https://git.example.org/our/fork' }),
        ),
      }),
    })

    expect(await screen.findByText('3.1.4')).toBeVisible()
    expect(screen.getByRole('link', { name: /git\.example\.org\/our\/fork/ })).toHaveAttribute(
      'href',
      'https://git.example.org/our/fork',
    )
  })

  it('keeps the build’s answer when the server cannot be reached', async () => {
    const about = vi.fn(async () => {
      throw new Error('offline')
    })
    renderWithProviders(<AboutPage />, { api: fakeApi({ about }) })

    await waitFor(() => expect(about).toHaveBeenCalled())

    expect(screen.getByText(BUILD_VERSION)).toBeVisible()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('opens the source in a tab of its own, with rel="noopener noreferrer"', () => {
    renderWithProviders(<AboutPage />, { api: silentServer() })

    const link = screen.getByRole('link', { name: new RegExp(BUILD_SOURCE_URL) })

    expect(link).toHaveAttribute('target', '_blank')
    expect(link.getAttribute('rel')?.split(/\s+/)).toEqual(
      expect.arrayContaining(['noopener', 'noreferrer']),
    )
  })

  it('reads in the reader’s language', () => {
    renderWithProviders(<AboutPage />, { api: silentServer(), locale: 'de' })

    expect(screen.getByRole('heading', { level: 1, name: 'Über EventSlide' })).toBeVisible()
  })
})
