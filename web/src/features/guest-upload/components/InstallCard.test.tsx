import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fr } from '../../../lib/i18n/fr'
import { renderWithProviders } from '../../../testing/renderWithProviders'
import { InstallCard } from './InstallCard'

/**
 * Two platforms, two shapes, and one browser family that gets nothing at all.
 */

describe('InstallCard', () => {
  it('renders nothing when there is nothing to offer', () => {
    renderWithProviders(
      <InstallCard offer={{ kind: 'none' }} onInstall={vi.fn()} onDismiss={vi.fn()} />,
    )

    expect(screen.queryByTestId('install-card')).not.toBeInTheDocument()
  })

  it('says what the icon is for rather than what it is', () => {
    // "Installer l'application" invites a question a guest at a wedding will not stop
    // to answer.
    renderWithProviders(
      <InstallCard offer={{ kind: 'prompt' }} onInstall={vi.fn()} onDismiss={vi.fn()} />,
    )

    expect(screen.getByText(fr.upload.installHint)).toBeVisible()
  })

  it('offers a button where the browser will raise a prompt', async () => {
    const onInstall = vi.fn()
    renderWithProviders(
      <InstallCard offer={{ kind: 'prompt' }} onInstall={onInstall} onDismiss={vi.fn()} />,
    )

    await userEvent.click(screen.getByRole('button', { name: fr.upload.installAction }))

    expect(onInstall).toHaveBeenCalled()
  })

  it('offers instructions and no button on iOS', () => {
    // There is no API to call there, and a button that did nothing would be worse than
    // none at all.
    renderWithProviders(
      <InstallCard offer={{ kind: 'instructions' }} onInstall={vi.fn()} onDismiss={vi.fn()} />,
    )

    expect(screen.getByText(fr.upload.installIosHint)).toBeVisible()
    expect(screen.queryByRole('button', { name: fr.upload.installAction })).not.toBeInTheDocument()
  })

  it('can always be dismissed, on either platform', async () => {
    const onDismiss = vi.fn()
    renderWithProviders(
      <InstallCard offer={{ kind: 'instructions' }} onInstall={vi.fn()} onDismiss={onDismiss} />,
    )

    await userEvent.click(screen.getByRole('button', { name: fr.upload.installDismiss }))

    expect(onDismiss).toHaveBeenCalled()
  })

  it('is a region a screen reader can find by name', () => {
    renderWithProviders(
      <InstallCard offer={{ kind: 'prompt' }} onInstall={vi.fn()} onDismiss={vi.fn()} />,
    )

    expect(screen.getByRole('region', { name: fr.upload.installTitle })).toBeInTheDocument()
  })
})
