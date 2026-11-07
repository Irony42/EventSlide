import { expect, vi } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GuestUploadPage } from '../GuestUploadPage'
import { rememberGuestSession } from '../../../lib/guestSession'
import { fr } from '../../../lib/i18n/fr'
import {
  aPrivacyNoticeState,
  aPublicEvent,
  renderWithProviders,
} from '../../../testing/renderWithProviders'
import type { Api } from '../../../lib/api/client'
import type {
  GuestPhotoDto,
  PrivacyNoticeState,
  PublicEventDto,
  UploadResponse,
} from '../../../lib/api/dto'

export const SLUG = 'camille-et-sacha'

export const accepted = (photoId: string): UploadResponse => ({
  results: [{ index: 0, status: 'accepted', photoId }],
})

export const duplicated = (photoId: string): UploadResponse => ({
  results: [{ index: 0, status: 'duplicate', photoId }],
})

export const aPhotoFile = (name: string): File =>
  new File([new Uint8Array([0xff, 0xd8, 0xff])], name, { type: 'image/jpeg' })

/**
 * What the join step leaves behind. Without it the screen has no event to show.
 *
 * The privacy notice is already read here, as it is for every guest after their first
 * photo: these tests are about the picker and the queue, and the notice standing in for
 * them has its own `describe` below.
 */
export const havingJoined = (
  overrides: Partial<PublicEventDto> = {},
  privacyNotice: PrivacyNoticeState | null = aPrivacyNoticeState(),
): void => {
  rememberGuestSession({ event: aPublicEvent(overrides), displayName: 'Léa', privacyNotice })
}

export const renderUpload = (api: Api) =>
  renderWithProviders(<GuestUploadPage />, {
    api,
    route: `/e/${SLUG}/upload`,
    path: '/e/:slug/upload',
  })

export const withPhotos = (...photos: readonly GuestPhotoDto[]): Partial<Api> => ({
  myPhotos: vi.fn(async () => ({ items: photos })),
})

/**
 * Waits until the own-photos read has been asked and its answer applied.
 *
 * What the empty list's own sentence used to be the marker for: a guest with nothing sent is shown
 * no list (INV-12), so there is no longer a line to wait for.
 */
export const readAnswered = async (api: Api): Promise<void> => {
  await waitFor(() => expect(api.myPhotos).toHaveBeenCalled())
  await act(async () => {
    await Promise.all(vi.mocked(api.myPhotos).mock.results.map((result) => result.value))
  })
}

export const pickPhotos = async (...files: readonly File[]): Promise<void> => {
  await userEvent.upload(screen.getByLabelText(fr.upload.addPhotos), [...files])
}
