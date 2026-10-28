import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GuestUploadPage } from './GuestUploadPage'
import { MAX_SHARE_PROPERTY } from './hooks/useOversizedPane'
import { rememberGuestSession } from '../../lib/guestSession'
import { fr } from '../../lib/i18n/fr'
import {
  aPrivacyNoticeState,
  aPublicEvent,
  fakeApi,
  renderWithProviders,
} from '../../testing/renderWithProviders'

/**
 * The upload pane, as the guest fills its queue: pinned while it is short, in the flow once the
 * photos they picked have made it taller than the screen allows.
 *
 * jsdom has no layout, so the pane's height is a stand-in that grows with the rows inside it —
 * which is the one property of the real pane this test is about. That it really does grow, and
 * that a pane in the flow really leaves the guest's own photos uncovered, is
 * `tests/e2e/journeys/guest-upload-pane.spec.ts`.
 */

const SLUG = 'camille-et-sacha'
const VIEWPORT = 1000
const SHARE = 0.5
const BARE_PANE = 400
const PER_ROW = 100

const observers: Array<{ fire: () => void }> = []

class FakeResizeObserver {
  private watching = false
  constructor(private readonly callback: () => void) {
    observers.push({
      fire: () => {
        if (this.watching) this.callback()
      },
    })
  }
  observe(): void {
    this.watching = true
  }
  unobserve(): void {}
  disconnect(): void {}
}

const aPhotoFile = (name: string): File =>
  new File([new Uint8Array([0xff, 0xd8, 0xff])], name, { type: 'image/jpeg' })

const paneMeasured = (): void => {
  act(() => {
    for (const observer of observers) observer.fire()
  })
}

describe('GuestUploadPage: the pane at the bottom', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    observers.length = 0
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: VIEWPORT })
    document.documentElement.style.setProperty(MAX_SHARE_PROPERTY, String(SHARE))
    // The pane is as tall as what is in it: a bare pane, plus a row for each photo.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const rows = this.querySelectorAll('[data-testid^="upload-item-"]').length
      return { height: BARE_PANE + PER_ROW * rows } as DOMRect
    })
    rememberGuestSession({
      event: aPublicEvent(),
      displayName: 'Léa',
      privacyNotice: aPrivacyNoticeState(),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    document.documentElement.style.removeProperty(MAX_SHARE_PROPERTY)
  })

  const renderUpload = () =>
    renderWithProviders(<GuestUploadPage />, {
      api: fakeApi({ myPhotos: vi.fn(async () => ({ items: [] })) }),
      route: `/e/${SLUG}/upload`,
      path: '/e/:slug/upload',
    })

  it('stays pinned while the guest has picked nothing', () => {
    renderUpload()
    paneMeasured()

    expect(screen.getByTestId('upload-composer')).not.toHaveAttribute('data-oversized')
  })

  it('drops into the flow once the photos the guest picked make it too tall, and is pinned again when they are removed', async () => {
    renderUpload()
    await userEvent.upload(screen.getByLabelText(fr.upload.addPhotos), [
      aPhotoFile('un.jpg'),
      aPhotoFile('deux.jpg'),
    ])
    paneMeasured()
    const pane = screen.getByTestId('upload-composer')
    expect(pane).toHaveAttribute('data-oversized')

    // Removing a queued photo stays possible while the pane is in the flow, and what it
    // frees is given back: the pane is pinned again.
    const queue = within(pane).getByRole('region', { name: fr.upload.queueLabel })
    await userEvent.click(within(queue).getByRole('button', { name: fr.upload.removeItem(1) }))
    await userEvent.click(within(queue).getByRole('button', { name: fr.upload.removeItem(1) }))
    paneMeasured()

    expect(pane).not.toHaveAttribute('data-oversized')
  })
})
