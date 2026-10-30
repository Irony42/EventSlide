import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fr } from '../../../lib/i18n/fr'
import { renderWithProviders } from '../../../testing/renderWithProviders'
import { OfflineNotice } from './OfflineNotice'

/**
 * The one thing on the guest surface that survives a reload, a closed tab and an
 * evening of bad Wi-Fi. What it must never do is appear when there is nothing to say,
 * or read as an error when nothing has gone wrong.
 */

describe('OfflineNotice', () => {
  it('says nothing at all when the device is holding nothing', () => {
    // An empty reassurance sitting above the picker all evening is noise, and it would
    // push the composer off a short screen.
    renderWithProviders(
      <OfflineNotice waiting={0} draining={false} onSendNow={vi.fn()} canCloseSafely />,
    )

    expect(screen.queryByTestId('offline-notice')).not.toBeInTheDocument()
  })

  it('counts the photos still waiting', () => {
    renderWithProviders(
      <OfflineNotice waiting={3} draining={false} onSendNow={vi.fn()} canCloseSafely />,
    )

    expect(screen.getByText(fr.upload.offlineTitle(3))).toBeInTheDocument()
  })

  it('promises the photos will go, and that the page may be closed', () => {
    // The sentence that lets a guest put the phone away. Without it they stand in the
    // corridor holding a loading screen.
    renderWithProviders(
      <OfflineNotice waiting={1} draining={false} onSendNow={vi.fn()} canCloseSafely />,
    )

    expect(screen.getByText(fr.upload.offlineHint)).toBeInTheDocument()
  })

  it('tells a phone with no Background Sync to keep the page open, not to close it', () => {
    // Every iPhone: the photos leave only while a page of the app is open, so "you can close this
    // page" would send the guest home with the evening's photos still on their phone (INV-8).
    renderWithProviders(
      <OfflineNotice waiting={1} draining={false} onSendNow={vi.fn()} canCloseSafely={false} />,
    )

    expect(screen.getByText(fr.upload.offlineHintNoSync)).toBeInTheDocument()
    expect(screen.queryByText(fr.upload.offlineHint)).not.toBeInTheDocument()
  })

  it('says it is working while a drain runs', () => {
    renderWithProviders(<OfflineNotice waiting={2} draining onSendNow={vi.fn()} canCloseSafely />)

    expect(screen.getByText(fr.upload.offlineSending)).toBeInTheDocument()
  })

  it('lets a guest who can see a bar of signal try immediately', async () => {
    const onSendNow = vi.fn()
    renderWithProviders(
      <OfflineNotice waiting={1} draining={false} onSendNow={onSendNow} canCloseSafely />,
    )

    await userEvent.click(screen.getByRole('button', { name: fr.upload.offlineRetry }))

    expect(onSendNow).toHaveBeenCalled()
  })

  it('is a status, not an alert: nothing has gone wrong', () => {
    // The photos are safe. An alert would interrupt whatever a screen-reader user was
    // doing to tell them so.
    renderWithProviders(
      <OfflineNotice waiting={1} draining={false} onSendNow={vi.fn()} canCloseSafely />,
    )

    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})
