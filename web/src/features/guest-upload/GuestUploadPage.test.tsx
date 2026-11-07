import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GuestUploadPage } from './GuestUploadPage'
import { ApiError } from '../../lib/http'
import { fr } from '../../lib/i18n/fr'
import { aGuestPhoto, fakeApi, renderWithProviders } from '../../testing/renderWithProviders'
import type { GuestPhotoDto, UploadResponse } from '../../lib/api/dto'
import {
  SLUG,
  accepted,
  duplicated,
  aPhotoFile,
  havingJoined,
  renderUpload,
  withPhotos,
  readAnswered,
  pickPhotos,
} from './testing/guestUploadHarness'

describe('GuestUploadPage', () => {
  beforeEach(() => {
    // jsdom implements no IndexedDB, so the outbox falls back to memory and says so
    // once per render. That fallback is the real production path on a phone in private
    // browsing and has its own tests; here it is only noise.
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('names the event it will send to', () => {
    // 1.0 read the event from a query parameter its own QR page never set, so every
    // guest uploaded to the default event and no screen would have shown it.
    havingJoined()
    renderUpload(fakeApi())

    expect(screen.getByRole('heading', { level: 1, name: 'Camille & Sacha' })).toBeVisible()
    expect(screen.getByText(fr.upload.signedAs('Léa'))).toBeVisible()
  })

  it('leads to the photographs of the evening, which have a page of their own', () => {
    // Not a section of this screen: a list that grows all evening would push the controls
    // that live under the thumb off the bottom of the phone.
    havingJoined()
    renderUpload(fakeApi())

    expect(screen.getByRole('link', { name: fr.feed.link })).toHaveAttribute(
      'href',
      `/e/${SLUG}/photos`,
    )
  })

  it('shows no list of the guest’s own photos while it is being fetched, since a first visit has none', () => {
    // A card with a spinner that vanishes for every first-time guest is a flash on the one screen
    // that has to be calm (INV-12). The composer is all there is to see until there is a list.
    havingJoined()
    const api = fakeApi({
      myPhotos: vi.fn(() => new Promise<{ items: readonly GuestPhotoDto[] }>(() => {})),
    })

    renderUpload(api)

    expect(screen.queryByRole('heading', { name: fr.upload.mine })).toBeNull()
    expect(screen.queryByRole('status', { name: fr.app.loading })).toBeNull()
    expect(screen.getByLabelText(fr.upload.addPhotos)).toBeInTheDocument()
  })

  describe('a first visit, with nothing sent yet (INV-12)', () => {
    it('shows neither an empty "Vos envois" card nor a button to delete what was never sent', async () => {
      havingJoined()
      const api = fakeApi(withPhotos())
      renderUpload(api)
      await readAnswered(api)

      expect(screen.queryByRole('heading', { name: fr.upload.mine })).toBeNull()
      expect(screen.queryByText(fr.upload.mineEmpty)).toBeNull()
      expect(screen.queryByRole('button', { name: fr.upload.eraseOpen })).toBeNull()
      // What the page is for is still there, and still says there is nothing selected.
      expect(screen.getByText(fr.upload.queueEmpty)).toBeVisible()
      expect(screen.getByLabelText(fr.upload.addPhotos)).toBeInTheDocument()
    })

    it('keeps the erasure reachable from the privacy notice, where it is promised', async () => {
      havingJoined()
      const api = fakeApi(withPhotos())
      renderUpload(api)
      await readAnswered(api)

      await userEvent.click(screen.getByRole('button', { name: fr.upload.noticeLink }))
      const notice = await screen.findByRole('dialog', { name: fr.upload.noticeLink })
      await userEvent.click(within(notice).getByRole('button', { name: fr.upload.eraseOpen }))
      const confirm = await screen.findByRole('dialog', { name: fr.upload.eraseTitle })
      await userEvent.click(within(confirm).getByRole('button', { name: fr.upload.eraseConfirm }))

      await waitFor(() => expect(api.eraseMyContribution).toHaveBeenCalledWith(SLUG))
    })

    it('shows the list and the erasure once there is a photo, and not twice', async () => {
      havingJoined()
      renderUpload(fakeApi(withPhotos(aGuestPhoto())))

      expect(await screen.findByRole('heading', { name: fr.upload.mine })).toBeVisible()
      expect(screen.getAllByRole('button', { name: fr.upload.eraseOpen })).toHaveLength(1)
    })

    it('keeps the list on a failed read, whose retry is the only way back to it', async () => {
      havingJoined()
      renderUpload(
        fakeApi({
          myPhotos: vi.fn(async () => {
            throw ApiError.network()
          }),
        }),
      )

      expect(await screen.findByText(fr.upload.mineFailed)).toBeVisible()
      expect(screen.getByRole('button', { name: fr.app.retry })).toBeVisible()
    })
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
    // The two rows have folded into the one line that says so.
    expect(screen.getByText(fr.upload.queueDone(2, 0))).toBeVisible()
  })

  it('does not offer a home-screen icon before the guest has sent anything', async () => {
    // A prompt on arrival is friction at the worst possible moment: the guest has just
    // scanned a QR code and is forty seconds from sending a photo.
    havingJoined()
    const api = fakeApi(withPhotos())
    renderUpload(api)

    await readAnswered(api)
    expect(screen.queryByTestId('install-card')).not.toBeInTheDocument()
  })

  it('offers a home-screen icon once a photo has arrived', async () => {
    // The second half of an evening's photos are taken after midnight, by which time the
    // QR code is face down under a wine glass.
    havingJoined()
    renderUpload(fakeApi(withPhotos(aGuestPhoto())))

    // The offer needs a browser that can honour it; jsdom is neither Chromium nor iOS,
    // so the platform is stated rather than assumed.
    Object.defineProperty(navigator, 'standalone', { value: false, configurable: true })
    try {
      await waitFor(() => expect(screen.getByTestId('install-card')).toBeVisible())
      expect(screen.getByText(fr.upload.installIosHint)).toBeVisible()
    } finally {
      Reflect.deleteProperty(navigator, 'standalone')
    }
  })

  it('still says a photo is held on the device when the pane is folded', async () => {
    // On bad venue Wi-Fi this is the one message a guest needs; folding must not hide it.
    havingJoined()
    const api = fakeApi({
      ...withPhotos(),
      uploadPhotos: vi.fn(async () => {
        throw ApiError.network()
      }),
    })
    renderUpload(api)
    await pickPhotos(aPhotoFile('confettis.jpg'))
    await userEvent.click(screen.getByRole('button', { name: fr.upload.sendCount(1) }))
    await screen.findByText(fr.upload.offlineTitle(1))

    await userEvent.click(screen.getByRole('button', { name: fr.upload.foldPane }))

    const bar = screen.getByTestId('folded-bar')
    expect(within(bar).getByText(fr.upload.offlineTitle(1))).toBeVisible()
  })

  it('keeps a photo the connection dropped, and sends it when the network returns', async () => {
    // This used to assert a "Réessayer" button, and the button was the problem: it only
    // helps a guest still looking at their phone. The photo is now held on the device
    // and goes up by itself — see web/src/lib/offline/.
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
    await userEvent.click(screen.getByRole('button', { name: fr.upload.sendCount(1) }))

    await waitFor(() =>
      expect(screen.getByTestId('upload-item-0')).toHaveAttribute('data-state', 'queued'),
    )
    expect(screen.getByText(fr.upload.offlineTitle(1))).toBeVisible()
    // jsdom has no service worker, hence no Background Sync: the page must not tell the guest they
    // can close it (INV-8). The sentence for a browser that can has its own test below.
    expect(screen.getByText(fr.upload.offlineHintNoSync)).toBeVisible()
    expect(screen.queryByText(fr.upload.offlineHint)).toBeNull()

    // A guest who can see a bar of signal should not have to wait for the browser to
    // agree; the same drain runs on the `online` event with nobody watching.
    await userEvent.click(screen.getByRole('button', { name: fr.upload.offlineRetry }))

    await waitFor(() =>
      expect(screen.getByTestId('upload-item-0')).toHaveAttribute('data-state', 'done'),
    )
    expect(screen.queryByTestId('offline-notice')).not.toBeInTheDocument()
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
    // The batch is finished and all of it is in the event, so the rows are folded into one line;
    // "Déjà envoyée" stays one press of "Détails" away.
    expect(screen.getByText(fr.upload.queueDone(1, 1))).toBeVisible()
    expect(screen.queryByText(fr.upload.itemDuplicate)).not.toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: fr.upload.queueDetails }))
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

  it('offers a caption when the host allows one, as a button that unfolds the field', async () => {
    havingJoined({ allowCaptions: true })
    renderUpload(fakeApi(withPhotos()))

    // On screen from the start, and the field is not: it took a row of the pane before a guest
    // had picked anything.
    expect(screen.getByRole('button', { name: fr.upload.captionLabel })).toBeVisible()
    expect(screen.getByLabelText(/Légende/)).not.toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: fr.upload.captionLabel }))

    expect(screen.getByLabelText(/Légende/)).toBeVisible()
  })

  it('offers no caption when the host does not', () => {
    // The host's setting, from the event the join step returned. Never guessed here.
    havingJoined({ allowCaptions: false })
    renderUpload(fakeApi(withPhotos()))

    expect(screen.queryByLabelText(/Légende/)).toBeNull()
    expect(screen.queryByRole('button', { name: fr.upload.captionLabel })).toBeNull()
  })

  it('sends the batch caption with the photos', async () => {
    havingJoined()
    const api = fakeApi({
      ...withPhotos(),
      uploadPhotos: vi.fn(async () => accepted('photo-1')),
    })
    renderUpload(api)

    await pickPhotos(aPhotoFile('confettis.jpg'))
    await userEvent.click(screen.getByRole('button', { name: fr.upload.captionLabel }))
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
