import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GuestUploadPage } from './GuestUploadPage'
import { rememberGuestSession } from '../../lib/guestSession'
import { ApiError } from '../../lib/http'
import { fr } from '../../lib/i18n/fr'
import {
  aGuestPhoto,
  aPublicEvent,
  fakeApi,
  renderWithProviders,
} from '../../testing/renderWithProviders'
import type { Api } from '../../lib/api/client'
import type { GuestPhotoDto, PublicEventDto, UploadResponse } from '../../lib/api/dto'

const SLUG = 'camille-et-sacha'

const accepted = (photoId: string): UploadResponse => ({
  results: [{ index: 0, status: 'accepted', photoId }],
})

const duplicated = (photoId: string): UploadResponse => ({
  results: [{ index: 0, status: 'duplicate', photoId }],
})

const aPhotoFile = (name: string): File =>
  new File([new Uint8Array([0xff, 0xd8, 0xff])], name, { type: 'image/jpeg' })

/** What the join step leaves behind. Without it the screen has no event to show. */
const havingJoined = (overrides: Partial<PublicEventDto> = {}): void => {
  rememberGuestSession({ event: aPublicEvent(overrides), displayName: 'Léa' })
}

const renderUpload = (api: Api) =>
  renderWithProviders(<GuestUploadPage />, {
    api,
    route: `/e/${SLUG}/upload`,
    path: '/e/:slug/upload',
  })

const withPhotos = (...photos: readonly GuestPhotoDto[]): Partial<Api> => ({
  myPhotos: vi.fn(async () => ({ items: photos })),
})

const pickPhotos = async (...files: readonly File[]): Promise<void> => {
  await userEvent.upload(screen.getByLabelText(fr.upload.addPhotos), [...files])
}

describe('GuestUploadPage', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('names the event it will send to', () => {
    // 1.0 read the event from a query parameter its own QR page never set, so every
    // guest uploaded to the default event and no screen would have shown it.
    havingJoined()
    renderUpload(fakeApi())

    expect(screen.getByRole('heading', { level: 1, name: 'Camille & Sacha' })).toBeVisible()
    expect(screen.getByText(fr.upload.signedAs('Léa'))).toBeVisible()
  })

  it('says it is fetching the guest’s own photos', () => {
    havingJoined()
    const api = fakeApi({
      myPhotos: vi.fn(() => new Promise<{ items: readonly GuestPhotoDto[] }>(() => {})),
    })

    renderUpload(api)

    expect(screen.getByRole('status')).toHaveTextContent(fr.app.loading)
  })

  it('says plainly that nothing has been sent yet', async () => {
    havingJoined()
    renderUpload(fakeApi(withPhotos()))

    // An empty panel is indistinguishable from a screen that failed to load, and a
    // guest who cannot tell reloads instead of sending a photo.
    expect(await screen.findByText(fr.upload.mineEmpty)).toBeVisible()
    expect(screen.getByText(fr.upload.queueEmpty)).toBeVisible()
  })

  it('says what to do when the guest’s own photos cannot be fetched, and retries', async () => {
    havingJoined()
    let attempt = 0
    const api = fakeApi({
      myPhotos: vi.fn(async () => {
        attempt += 1
        if (attempt === 1) throw ApiError.network()
        return { items: [aGuestPhoto()] }
      }),
    })
    renderUpload(api)

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.upload.mineFailed)

    await userEvent.click(screen.getByRole('button', { name: fr.app.retry }))

    expect(await screen.findByText(fr.upload.statusPending)).toBeVisible()
  })

  it('states what became of every photo the guest sent, in words', async () => {
    havingJoined()
    renderUpload(
      fakeApi(
        withPhotos(
          aGuestPhoto({ id: 'photo-1', status: 'pending' }),
          aGuestPhoto({ id: 'photo-2', status: 'published', caption: 'Les confettis' }),
          aGuestPhoto({ id: 'photo-3', status: 'rejected', canDelete: false }),
        ),
      ),
    )

    expect(await screen.findByText(fr.upload.statusPending)).toBeVisible()
    expect(screen.getByText(fr.upload.statusPublished)).toBeVisible()
    expect(screen.getByText(fr.upload.statusRejected)).toBeVisible()
    expect(screen.getByRole('img', { name: 'Les confettis' })).toBeVisible()
  })

  it('offers to delete only what the server says can be deleted', async () => {
    havingJoined()
    renderUpload(
      fakeApi(
        withPhotos(
          aGuestPhoto({ id: 'photo-1', canDelete: true }),
          aGuestPhoto({ id: 'photo-2', canDelete: false }),
        ),
      ),
    )

    // `canDelete` is the server's answer, computed from the grace window and the
    // status. 1.0 recomputed it here and offered a button that answered 403.
    expect(
      await screen.findByRole('button', { name: fr.upload.deleteOwnNumbered(1) }),
    ).toBeVisible()
    expect(screen.queryByRole('button', { name: fr.upload.deleteOwnNumbered(2) })).toBeNull()
  })

  it('asks before deleting, in a dialog it can style and test', async () => {
    havingJoined()
    const api = fakeApi(withPhotos(aGuestPhoto({ id: 'photo-1', canDelete: true })))
    renderUpload(api)

    await userEvent.click(
      await screen.findByRole('button', { name: fr.upload.deleteOwnNumbered(1) }),
    )

    // Never `window.confirm`: unstyleable, untestable, and suppressed outright in the
    // in-app browsers a QR code is often scanned from.
    const dialog = await screen.findByRole('dialog', { name: fr.upload.deleteOwnConfirm })
    await userEvent.click(within(dialog).getByRole('button', { name: fr.upload.deleteOwn }))

    await waitFor(() => expect(api.deleteMyPhoto).toHaveBeenCalledWith(SLUG, 'photo-1'))
  })

  it('keeps the list when a deletion is refused, and says why', async () => {
    havingJoined()
    const api = fakeApi({
      ...withPhotos(aGuestPhoto({ id: 'photo-1', canDelete: true })),
      deleteMyPhoto: vi.fn(async () => {
        throw new ApiError(403, 'photo.illegalTransition')
      }),
    })
    renderUpload(api)

    await userEvent.click(
      await screen.findByRole('button', { name: fr.upload.deleteOwnNumbered(1) }),
    )
    const dialog = await screen.findByRole('dialog', { name: fr.upload.deleteOwnConfirm })
    await userEvent.click(within(dialog).getByRole('button', { name: fr.upload.deleteOwn }))

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors['photo.illegalTransition'])
    // A refused deletion is no reason to blank the one screen that tells the guest
    // their photos arrived.
    expect(screen.getByText(fr.upload.statusPending)).toBeVisible()
  })

  it('sends every selected photo and reports each one as sent', async () => {
    havingJoined()
    const api = fakeApi({
      ...withPhotos(),
      uploadPhotos: vi.fn(async () => accepted('photo-1')),
    })
    renderUpload(api)

    await pickPhotos(aPhotoFile('un.jpg'), aPhotoFile('deux.jpg'))
    await userEvent.click(screen.getByRole('button', { name: /Envoyer/ }))

    await waitFor(() => {
      expect(screen.getByTestId('upload-item-0')).toHaveAttribute('data-state', 'done')
      expect(screen.getByTestId('upload-item-1')).toHaveAttribute('data-state', 'done')
    })
    expect(screen.getByText(fr.upload.thanks)).toBeVisible()
  })

  it('offers a retry when the connection drops, and the retry works', async () => {
    havingJoined()
    let attempt = 0
    const api = fakeApi({
      ...withPhotos(),
      uploadPhotos: vi.fn(async () => {
        attempt += 1
        if (attempt === 1) throw ApiError.network()
        return accepted('photo-1')
      }),
    })
    renderUpload(api)

    await pickPhotos(aPhotoFile('confettis.jpg'))
    await userEvent.click(screen.getByRole('button', { name: /Envoyer/ }))

    await waitFor(() =>
      expect(screen.getByTestId('upload-item-0')).toHaveAttribute('data-state', 'failed'),
    )
    expect(screen.getByText(fr.errors.network)).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: /Réessayer/ }))

    await waitFor(() =>
      expect(screen.getByTestId('upload-item-0')).toHaveAttribute('data-state', 'done'),
    )
  })

  it('offers no retry for a photo the server will refuse again', async () => {
    havingJoined()
    const api = fakeApi({
      ...withPhotos(),
      uploadPhotos: vi.fn(async () => {
        throw new ApiError(415, 'image.unsupportedFormat')
      }),
    })
    renderUpload(api)

    await pickPhotos(aPhotoFile('film.mov'))
    await userEvent.click(screen.getByRole('button', { name: /Envoyer/ }))

    await waitFor(() =>
      expect(screen.getByTestId('upload-item-0')).toHaveAttribute('data-state', 'failed'),
    )
    expect(screen.getByText(fr.errors['image.unsupportedFormat'])).toBeVisible()
    expect(screen.queryByRole('button', { name: /Réessayer/ })).toBeNull()
  })

  it('reads a photo already in the event as reassurance, not as a failure', async () => {
    havingJoined()
    const api = fakeApi({
      ...withPhotos(),
      uploadPhotos: vi.fn(async () => duplicated('photo-1')),
    })
    renderUpload(api)

    await pickPhotos(aPhotoFile('confettis.jpg'))
    await userEvent.click(screen.getByRole('button', { name: /Envoyer/ }))

    await waitFor(() =>
      expect(screen.getByTestId('upload-item-0')).toHaveAttribute('data-state', 'duplicate'),
    )
    expect(screen.getByText(fr.upload.itemDuplicate)).toBeVisible()
  })

  it('lets a guest take a photo out of the queue before sending it', async () => {
    havingJoined()
    renderUpload(fakeApi(withPhotos()))

    await pickPhotos(aPhotoFile('confettis.jpg'))
    expect(screen.getByTestId('upload-item-0')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: fr.upload.removeItem(1) }))

    expect(screen.queryByTestId('upload-item-0')).toBeNull()
    expect(screen.getByRole('button', { name: fr.upload.send })).toBeDisabled()
  })

  it('releases the photo previews when the guest leaves the screen', async () => {
    havingJoined()
    // Thirty photos selected is thirty full-resolution bitmaps held until the tab
    // closes. 1.0 revoked none of them.
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    const { unmount } = renderUpload(fakeApi(withPhotos()))

    await pickPhotos(aPhotoFile('confettis.jpg'))
    const preview = screen.getByRole('img', { name: fr.upload.itemAlt(1) }).getAttribute('src')
    unmount()

    expect(revoke).toHaveBeenCalledWith(preview)
  })

  it('offers a caption when the host allows one', () => {
    havingJoined({ allowCaptions: true })
    renderUpload(fakeApi(withPhotos()))

    expect(screen.getByLabelText(/Légende/)).toBeVisible()
  })

  it('offers no caption when the host does not', () => {
    // The host's setting, from the event the join step returned. Never guessed here.
    havingJoined({ allowCaptions: false })
    renderUpload(fakeApi(withPhotos()))

    expect(screen.queryByLabelText(/Légende/)).toBeNull()
  })

  it('sends the batch caption with the photos', async () => {
    havingJoined()
    const api = fakeApi({
      ...withPhotos(),
      uploadPhotos: vi.fn(async () => accepted('photo-1')),
    })
    renderUpload(api)

    await pickPhotos(aPhotoFile('confettis.jpg'))
    await userEvent.type(screen.getByLabelText(/Légende/), 'Les confettis')
    await userEvent.click(screen.getByRole('button', { name: /Envoyer/ }))

    await waitFor(() =>
      expect(api.uploadPhotos).toHaveBeenCalledWith(
        SLUG,
        expect.objectContaining({ caption: 'Les confettis' }),
      ),
    )
  })

  it('sends a guest who never joined back to the join screen', () => {
    // A bookmark, or a tab reopened the next morning. The event name and the host's
    // settings only exist in the join step's answer, so there is nothing to show.
    renderUpload(fakeApi())

    expect(screen.getByRole('heading', { name: fr.upload.notJoinedTitle })).toBeVisible()
    expect(screen.getByRole('link', { name: fr.upload.notJoinedAction })).toBeVisible()
  })

  it('sends a visitor whose address carries no event back to the join screen', () => {
    // `/e//upload`, or a link from an older build. Nothing is read from storage at all:
    // there is no slug to look the session up under, and guessing one would be the 1.0
    // QR bug again — a guest uploading to whichever event happened to be first.
    havingJoined()

    renderWithProviders(<GuestUploadPage />, { api: fakeApi(), route: '/e//upload' })

    expect(screen.getByRole('heading', { name: fr.upload.notJoinedTitle })).toBeVisible()
  })

  it('leaves the photo in place when the guest cancels the confirmation', async () => {
    havingJoined()
    const api = fakeApi(withPhotos(aGuestPhoto({ id: 'photo-1', canDelete: true })))
    renderUpload(api)

    await userEvent.click(
      await screen.findByRole('button', { name: fr.upload.deleteOwnNumbered(1) }),
    )
    const dialog = await screen.findByRole('dialog', { name: fr.upload.deleteOwnConfirm })
    await userEvent.click(within(dialog).getByRole('button', { name: fr.app.cancel }))

    expect(api.deleteMyPhoto).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: fr.upload.deleteOwnConfirm })).toBeNull()
    expect(screen.getByText(fr.upload.statusPending)).toBeVisible()
  })

  it('shows how far a photo has got while it is going up', async () => {
    // A guest on venue Wi-Fi waits up to a minute per photo. A bar that only appears
    // once the upload is over tells them nothing at the moment they need it.
    havingJoined()
    const api = fakeApi({
      uploadPhotos: vi.fn(async (_slug: string, input) => {
        input.onProgress?.({ loaded: 600_000, total: 1_000_000, percent: 60 })
        return new Promise<UploadResponse>(() => {})
      }),
    })
    renderUpload(api)
    await pickPhotos(aPhotoFile('confettis.jpg'))

    await userEvent.click(screen.getByRole('button', { name: /Envoyer/ }))

    const bar = await screen.findByRole('progressbar', { name: fr.upload.itemProgress(1) })
    expect(bar).toHaveAttribute('aria-valuenow', '60')
  })
})
