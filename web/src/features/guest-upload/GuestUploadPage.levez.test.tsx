import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import { GuestUploadPage } from './GuestUploadPage'
import { rememberGuestSession } from '../../lib/guestSession'
import { fr } from '../../lib/i18n/fr'
import {
  aGuestPhoto,
  aPrivacyNoticeState,
  aPublicEvent,
  fakeApi,
  renderWithProviders,
} from '../../testing/renderWithProviders'
import type { GuestPhotoDto } from '../../lib/api/dto'

/**
 * "Levez les yeux", through the whole upload screen: the guest's photo is waiting, the host
 * publishes it, and the screen says so without the guest touching anything.
 *
 * What the pieces do is pinned beside them (`useMyPhotos.arrival.test.tsx`, `MyPhotos.test.tsx`).
 * This is the wiring between them, which no unit test of either can see.
 */

const SLUG = 'camille-et-sacha'

let visibility: 'visible' | 'hidden' = 'visible'

describe('the upload screen when the host publishes a waiting photo', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    visibility = 'visible'
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    })
    rememberGuestSession({
      event: aPublicEvent(),
      displayName: 'Julie',
      privacyNotice: aPrivacyNoticeState(),
    })
  })

  afterEach(() => {
    Reflect.deleteProperty(document, 'visibilityState')
  })

  it('tells the guest to look up, in words, without a reload', async () => {
    const lists: readonly (readonly GuestPhotoDto[])[] = [
      [aGuestPhoto({ id: 'photo-1', status: 'pending' })],
      [aGuestPhoto({ id: 'photo-1', status: 'published' })],
    ]
    let read = 0
    const api = fakeApi({
      myPhotos: vi.fn(async () => ({ items: lists[Math.min(read++, lists.length - 1)] ?? [] })),
    })
    renderWithProviders(<GuestUploadPage />, {
      api,
      route: `/e/${SLUG}/upload`,
      path: '/e/:slug/upload',
    })
    await waitFor(() => expect(screen.getByText(fr.upload.statusPending)).toBeInTheDocument())
    expect(screen.queryByText(fr.upload.photoDeveloped)).toBeNull()

    // The guest looks away and comes back: one read, and the host has decided meanwhile.
    act(() => {
      visibility = 'hidden'
      document.dispatchEvent(new Event('visibilitychange'))
    })
    act(() => {
      visibility = 'visible'
      document.dispatchEvent(new Event('visibilitychange'))
    })

    await waitFor(() => expect(screen.getByText(fr.upload.photoDevelopedAway)).toBeInTheDocument())
    expect(screen.getByText(fr.upload.statusPublished)).toBeInTheDocument()
  })
})
