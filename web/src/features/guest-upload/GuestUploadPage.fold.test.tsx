import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GuestUploadPage } from './GuestUploadPage'
import { FOLD_DISTANCE } from './hooks/useFoldOnScroll'
import { rememberGuestSession } from '../../lib/guestSession'
import { fr } from '../../lib/i18n/fr'
import {
  aPrivacyNoticeState,
  aPublicEvent,
  fakeApi,
  renderWithProviders,
} from '../../testing/renderWithProviders'

/**
 * The pane folded into a bar (spec 19): what folding keeps, what it never does, and where the
 * focus goes. Heights belong to the e2e spec (jsdom has no layout).
 */

const SLUG = 'camille-et-sacha'
const aPhotoFile = (name: string): File =>
  new File([new Uint8Array([0xff, 0xd8, 0xff])], name, { type: 'image/jpeg' })

const scrollTo = (y: number): void => {
  Object.defineProperty(window, 'scrollY', { configurable: true, value: y })
  act(() => {
    fireEvent.scroll(window)
  })
}

describe('GuestUploadPage: folding the pane', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      configurable: true,
      value: 5000,
    })
    scrollTo(1000)
    rememberGuestSession({
      event: aPublicEvent(),
      displayName: 'Léa',
      privacyNotice: aPrivacyNoticeState(),
    })
  })

  const renderUpload = () =>
    renderWithProviders(<GuestUploadPage />, {
      api: fakeApi({ myPhotos: vi.fn(async () => ({ items: [] })) }),
      route: `/e/${SLUG}/upload`,
      path: '/e/:slug/upload',
    })

  const fold = () => screen.getByRole('button', { name: fr.upload.foldPane })
  const bar = () => screen.getByTestId('folded-bar')

  it('folds with "Réduire", exposes aria-expanded both ways and moves the focus to the bar', async () => {
    renderUpload()
    expect(fold()).toHaveAttribute('aria-expanded', 'true')
    expect(screen.queryByTestId('folded-bar')).toBeNull()

    await userEvent.click(fold())

    const open = within(bar()).getByRole('button', { name: fr.upload.openPane })
    expect(open).toHaveAttribute('aria-expanded', 'false')
    expect(open).toHaveFocus()
    // Out of the accessibility tree and the tab order, not merely off screen.
    expect(screen.queryByRole('button', { name: fr.upload.foldPane })).toBeNull()
    expect(screen.getByTestId('upload-composer')).toHaveAttribute('data-folded')
  })

  it('reopens on a tap and puts the focus on the first useful action', async () => {
    renderUpload()
    await userEvent.click(fold())
    await userEvent.click(within(bar()).getByRole('button', { name: fr.upload.openPane }))

    expect(screen.queryByTestId('folded-bar')).toBeNull()
    expect(fold()).toBeVisible()
    expect(screen.getByLabelText(fr.upload.addPhotos)).toHaveFocus()
  })

  it('keeps the selection through a fold: thumbnails and a badge on the bar, and the same rows on reopening', async () => {
    renderUpload()
    await userEvent.upload(screen.getByLabelText(fr.upload.addPhotos), [
      aPhotoFile('un.jpg'),
      aPhotoFile('deux.jpg'),
      aPhotoFile('trois.jpg'),
    ])
    await userEvent.click(fold())

    expect(within(bar()).getByTestId('folded-badge')).toHaveTextContent('3')
    const reopen = within(bar()).getByRole('button', { name: fr.upload.openPaneReady(3) })
    expect(reopen).toHaveAttribute('aria-expanded', 'false')
    expect(within(bar()).getByRole('button', { name: fr.upload.sendCount(3) })).toBeInTheDocument()

    await userEvent.click(reopen)
    expect(screen.getByTestId('upload-item-2')).toBeVisible()
    expect(screen.getByRole('button', { name: fr.upload.sendCount(3) })).toHaveFocus()
    // Removing is still the cross of a row, and only that.
    expect(screen.getByRole('button', { name: fr.upload.removeItem(1) })).toBeVisible()
  })

  it('folds when the guest scrolls back up by a real distance, and never opens by itself', () => {
    renderUpload()
    scrollTo(1000 - FOLD_DISTANCE + 1)
    expect(screen.queryByTestId('folded-bar')).toBeNull()

    scrollTo(1000 - FOLD_DISTANCE - 5)
    expect(bar()).toBeInTheDocument()
    // A fold by scroll moves no focus.
    expect(document.activeElement).toBe(document.body)

    scrollTo(3000)
    scrollTo(10)
    expect(bar()).toBeInTheDocument()
  })

  it('does not add up a tremor: a step down forgets the way up', () => {
    renderUpload()
    scrollTo(1000 - 30)
    scrollTo(1000 - 20)
    scrollTo(1000 - 50)
    expect(screen.queryByTestId('folded-bar')).toBeNull()
  })

  it('does not fold by scroll while a caption is being typed', async () => {
    renderUpload()
    await userEvent.click(screen.getByRole('button', { name: fr.upload.captionLabel }))
    expect(screen.getByLabelText(/Légende/)).toHaveFocus()

    scrollTo(100)

    expect(screen.queryByTestId('folded-bar')).toBeNull()
  })
})
