import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GuestUploadPage } from './GuestUploadPage'
import { rememberGuestSession } from '../../lib/guestSession'
import { ApiError } from '../../lib/http'
import { fr } from '../../lib/i18n/fr'
import {
  aClipJob,
  aGuestMission,
  aGuestPhoto,
  aPrivacyNotice,
  aPrivacyNoticeState,
  aPublicEvent,
  fakeApi,
  renderWithProviders,
} from '../../testing/renderWithProviders'
import type { Api } from '../../lib/api/client'
import type {
  GuestMissionDto,
  GuestPhotoDto,
  PrivacyNoticeState,
  PublicEventDto,
  UploadResponse,
} from '../../lib/api/dto'

const SLUG = 'camille-et-sacha'

const accepted = (photoId: string): UploadResponse => ({
  results: [{ index: 0, status: 'accepted', photoId }],
})

const duplicated = (photoId: string): UploadResponse => ({
  results: [{ index: 0, status: 'duplicate', photoId }],
})

const aPhotoFile = (name: string): File =>
  new File([new Uint8Array([0xff, 0xd8, 0xff])], name, { type: 'image/jpeg' })

/**
 * What the join step leaves behind. Without it the screen has no event to show.
 *
 * The privacy notice is already read here, as it is for every guest after their first
 * photo: these tests are about the picker and the queue, and the notice standing in for
 * them has its own `describe` below.
 */
const havingJoined = (
  overrides: Partial<PublicEventDto> = {},
  privacyNotice: PrivacyNoticeState | null = aPrivacyNoticeState(),
): void => {
  rememberGuestSession({ event: aPublicEvent(overrides), displayName: 'Léa', privacyNotice })
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
    localStorage.clear()
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

  it('does not offer a home-screen icon before the guest has sent anything', async () => {
    // A prompt on arrival is friction at the worst possible moment: the guest has just
    // scanned a QR code and is forty seconds from sending a photo.
    havingJoined()
    renderUpload(fakeApi(withPhotos()))

    await waitFor(() => expect(screen.getByText(fr.upload.mineEmpty)).toBeVisible())
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
    expect(screen.getByText(fr.upload.offlineHint)).toBeVisible()

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

describe('sending a video', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  const aClipFile = (name = 'premiere-danse.mp4', size = 12_000_000): File => {
    const file = new File([new Uint8Array([0, 0, 0, 0x18])], name, { type: 'video/mp4' })
    Object.defineProperty(file, 'size', { value: size })
    return file
  }

  it('offers no video control when the host has not allowed it', () => {
    // The persistence fallback reads false for every gallery created before clips
    // shipped. Offering the control there means a 403 after eighty megabytes of a
    // guest's evening, which is exactly the failure this surface is arranged to avoid.
    havingJoined({ allowClips: false })
    renderUpload(fakeApi())

    expect(screen.queryByLabelText(fr.upload.addClip)).toBeNull()
  })

  it('lets the guest watch back the video they sent, and says how long it is', async () => {
    // "Did it arrive, and was it the right one?" is what this list is for, and a poster
    // frame answers only the first half.
    havingJoined({ allowClips: true })
    renderUpload(
      fakeApi(
        withPhotos(
          aGuestPhoto({
            id: 'clip-1',
            kind: 'clip',
            videoUrl: '/api/events/camille-et-sacha/photos/clip-1/video',
            durationMs: 8_000,
          }),
        ),
      ),
    )

    const player = await screen.findByLabelText(fr.upload.mineClipAlt)
    expect(player).toHaveAttribute('src', '/api/events/camille-et-sacha/photos/clip-1/video')
    expect(screen.getByText(fr.moderation.videoLength(8))).toBeVisible()
  })

  it('says what the limits are before the picker is opened', () => {
    havingJoined({ allowClips: true, maxClipBytes: 80_000_000, maxClipSeconds: 15 })
    renderUpload(fakeApi())

    // The numbers come from the event, not from this bundle: a guest who reads them
    // films a shorter sequence instead of losing four minutes to a refusal.
    expect(screen.getByText(fr.upload.clipHint(15, 80))).toBeVisible()
  })

  it('refuses a recording heavier than the limit without contacting the server', async () => {
    havingJoined({ allowClips: true })
    const api = fakeApi()
    renderUpload(api)

    await userEvent.upload(
      screen.getByLabelText(fr.upload.addClip),
      aClipFile('longue.mp4', 90_000_000),
    )

    expect(await screen.findByText(fr.upload.clipTooLarge(80))).toBeVisible()
    expect(api.uploadClip).not.toHaveBeenCalled()
    // And no greyed-out "Réessayer" beside it: a control that exists to be refused reads,
    // in a dark room, as the app being broken rather than as the recording being wrong.
    expect(screen.queryByRole('button', { name: fr.app.retry })).toBeNull()
    // Named after what it does. It and the picker above it were both "Choisir une autre
    // vidéo", so a screen-reader user activating one watched the composer empty and no
    // picker open.
    expect(screen.getByRole('button', { name: fr.upload.clipDiscard })).toBeEnabled()
  })

  it('waits out a full queue instead of offering the same eighty megabytes again', async () => {
    havingJoined({ allowClips: true })
    const api = fakeApi({
      uploadClip: vi.fn(() =>
        Promise.reject(new ApiError(429, 'clip.queueFull', { retryAfterSeconds: 30 })),
      ),
    })
    renderUpload(api)

    await userEvent.upload(screen.getByLabelText(fr.upload.addClip), aClipFile())
    await userEvent.click(screen.getByRole('button', { name: fr.upload.clipSend }))

    // Backpressure is a wait, not an error the guest caused — and it carries the server's
    // own estimate, so they stop pressing the button.
    expect(await screen.findByText(fr.upload.clipQueueFullRetry(30))).toBeVisible()
    // No send while the box asked for a delay: the upload is written to disk before the
    // queue depth is decided, so an instant retry spends the bytes for nothing.
    expect(screen.queryByRole('button', { name: fr.upload.clipSend })).toBeNull()
    expect(screen.queryByRole('button', { name: fr.app.retry })).toBeNull()
  })

  it('shows the transcode as its own state rather than stopping at 100%', async () => {
    havingJoined({ allowClips: true })
    const api = fakeApi({
      uploadClip: vi.fn(async () => aClipJob({ status: 'queued' })),
      clipJob: vi.fn(async () => aClipJob({ status: 'running' })),
    })
    renderUpload(api)

    await userEvent.upload(screen.getByLabelText(fr.upload.addClip), aClipFile())
    await userEvent.click(screen.getByRole('button', { name: fr.upload.clipSend }))

    // The window between the upload and the photo is real, and a guest who cannot tell
    // whether it worked sends the same file again.
    expect(await screen.findByText(fr.upload.clipRunning)).toBeVisible()
  })

  it('stops offering to cancel once the bytes are on the box', async () => {
    // "Annuler l'envoi" is true while the request is in flight and a lie afterwards: the
    // queue deduplicates per event, so a cancellation could delete a clip a *different*
    // guest also sent, `queued` may only become `running`, and no route lets a guest
    // touch a job. So the screen says what happens next instead of promising a
    // withdrawal this surface cannot perform.
    havingJoined({ allowClips: true })
    const api = fakeApi({
      uploadClip: vi.fn(async () => aClipJob({ status: 'queued' })),
      clipJob: vi.fn(async () => aClipJob({ status: 'running' })),
    })
    renderUpload(api)

    await userEvent.upload(screen.getByLabelText(fr.upload.addClip), aClipFile())
    await userEvent.click(screen.getByRole('button', { name: fr.upload.clipSend }))

    expect(await screen.findByText(fr.upload.clipAlreadySent)).toBeVisible()
    expect(screen.queryByRole('button', { name: fr.upload.clipCancel })).toBeNull()
  })

  it('offers to cancel while the bytes are still going up, because then it is true', async () => {
    havingJoined({ allowClips: true })
    const api = fakeApi({ uploadClip: vi.fn(() => new Promise<never>(() => {})) })
    renderUpload(api)

    await userEvent.upload(screen.getByLabelText(fr.upload.addClip), aClipFile())
    await userEvent.click(screen.getByRole('button', { name: fr.upload.clipSend }))

    // The `XMLHttpRequest` is aborted and the box never sees the file.
    expect(await screen.findByRole('button', { name: fr.upload.clipCancel })).toBeVisible()
  })

  it('tells the guest a video is not kept for later when the network drops', async () => {
    havingJoined({ allowClips: true })
    const api = fakeApi({ uploadClip: vi.fn(() => Promise.reject(ApiError.network())) })
    renderUpload(api)

    await userEvent.upload(screen.getByLabelText(fr.upload.addClip), aClipFile())
    await userEvent.click(screen.getByRole('button', { name: fr.upload.clipSend }))

    // A phone holding eighty megabytes it can never drain is a phone that never sends
    // anything else either, so the outbox refuses it — and this is the sentence that
    // makes the refusal honest rather than silent.
    expect(await screen.findByText(fr.upload.clipNotQueued)).toBeVisible()
  })

  /* ---- Per-event theming (roadmap 2.2). ---- */

  it('wears the event’s colour on the very first frame', async () => {
    // The guest surface has no loading state to hide a repaint behind: the event comes
    // out of the session the join wrote, and `sessionStorage` is synchronous. So the
    // colour is on the element the first time it renders, not one round trip later
    // under the guest's thumb.
    havingJoined({ theme: { accentHue: 345, fonts: 'sans', frame: 'soft', material: 'glass' } })
    renderUpload(fakeApi())

    const page = (await screen.findByRole('heading', { name: 'Camille & Sacha' })).closest('div')

    expect(page).toHaveStyle({ '--accent-hue': '345' })
    // And the marker `tokens.css` re-derives the accent on: without it the hue moves and
    // the palette does not, because a custom property that references another is resolved
    // on the element it is declared on.
    expect(page).toHaveAttribute('data-event-accent', '345')
  })

  it('takes the colour and leaves the typography on the projector', async () => {
    // A display face is a projector decision: this screen's largest type is `--text-lg`,
    // and had the pairings been bundled rather than built from system faces, this is the
    // surface that would have paid for them.
    havingJoined({ theme: { accentHue: 345, fonts: 'serif', frame: 'round', material: 'glass' } })
    renderUpload(fakeApi())

    await screen.findByRole('heading', { name: 'Camille & Sacha' })

    expect(document.querySelector('[data-event-fonts]')).toBeNull()
    expect(document.querySelector('[data-event-frame]')).toBeNull()
  })

  it('renders an unthemed event exactly as it did before theming existed', async () => {
    havingJoined()
    renderUpload(fakeApi())

    const page = (await screen.findByRole('heading', { name: 'Camille & Sacha' })).closest('div')

    // Scoped to the page rather than to the document: a `Progress` bar legitimately sets
    // `--progress-value` inline, and a document-wide assertion would fail on that and
    // read as a theming regression.
    expect(page?.getAttribute('style')).toBeNull()
    expect(page).not.toHaveAttribute('data-event-accent')
    expect(page).not.toHaveAttribute('data-event-fonts')
    expect(page).not.toHaveAttribute('data-event-frame')
    expect(page).not.toHaveAttribute('data-glass')
  })

  /* ---- The material the host chose for their evening (roadmap 11.5). ---- */

  it('wears the plain surface the host chose for the event, not the phone’s opinion', async () => {
    // The only screen in the product where this choice is visible: the upload composer is
    // one of the two panes that wear the material, and the other one is the host's own
    // console, which is not themed. The marker goes on the page element — inside the shell
    // — so it inherits down to the composer without a second copy of the material and
    // without anything travelling back up the tree.
    havingJoined({ theme: { accentHue: 305, fonts: 'sans', frame: 'soft', material: 'plain' } })
    renderUpload(fakeApi())

    const page = (await screen.findByRole('heading', { name: 'Camille & Sacha' })).closest('div')

    expect(page).toHaveAttribute('data-glass', 'opaque')
  })

  it('leaves the page unmarked for a host who kept the glass', async () => {
    // The other half, and the one that keeps the choice one-way. `data-glass` here would
    // override whatever the shell decided for this machine, so a host who chose glass has
    // to spread nothing at all and let the shell's answer stand.
    havingJoined({ theme: { accentHue: 345, fonts: 'sans', frame: 'soft', material: 'glass' } })
    renderUpload(fakeApi())

    const page = (await screen.findByRole('heading', { name: 'Camille & Sacha' })).closest('div')

    expect(page).not.toHaveAttribute('data-glass')
  })

  describe('the mission checklist', () => {
    const withMissions = (...missions: readonly GuestMissionDto[]): Partial<Api> => ({
      myMissions: vi.fn(async () => ({ items: missions })),
    })

    it('shows nothing at all for an event whose host set no prompts', async () => {
      // Which is most events, and is what keeps this screen the screen it was.
      havingJoined()
      renderUpload(fakeApi())

      await screen.findByTestId('upload-composer')

      expect(
        screen.queryByRole('heading', { name: fr.upload.missionsTitle }),
      ).not.toBeInTheDocument()
    })

    it('offers the prompts the host set', async () => {
      havingJoined()
      renderUpload(
        fakeApi(withMissions(aGuestMission({ id: 'm1', prompt: 'un selfie avec les mariés' }))),
      )

      expect(
        await screen.findByRole('button', {
          name: /un selfie avec les mariés/,
        }),
      ).toBeVisible()
    })

    it('files the photographs under the prompt the guest tapped', async () => {
      const api = fakeApi({
        ...withMissions(aGuestMission({ id: 'm1', prompt: 'un selfie' })),
        uploadPhotos: vi.fn(async () => accepted('photo-1')),
      })
      havingJoined()
      renderUpload(api)
      await screen.findByRole('button', { name: /un selfie/ })

      await userEvent.click(screen.getByRole('button', { name: /un selfie/ }))
      await pickPhotos(aPhotoFile('confettis.jpg'))
      await userEvent.click(screen.getByRole('button', { name: fr.upload.sendCount(1) }))

      await waitFor(() =>
        expect(api.uploadPhotos).toHaveBeenCalledWith(
          SLUG,
          expect.objectContaining({ missionId: 'm1' }),
        ),
      )
    })

    it('sends no mission when the guest tapped none', async () => {
      const api = fakeApi({
        ...withMissions(aGuestMission({ id: 'm1', prompt: 'un selfie' })),
        uploadPhotos: vi.fn(async () => accepted('photo-1')),
      })
      havingJoined()
      renderUpload(api)
      await screen.findByRole('button', { name: /un selfie/ })

      await pickPhotos(aPhotoFile('confettis.jpg'))
      await userEvent.click(screen.getByRole('button', { name: fr.upload.sendCount(1) }))

      await waitFor(() =>
        expect(api.uploadPhotos).toHaveBeenCalledWith(
          SLUG,
          expect.objectContaining({ missionId: null }),
        ),
      )
    })

    it('confirms which prompt the next send counts for', async () => {
      havingJoined()
      renderUpload(fakeApi(withMissions(aGuestMission({ id: 'm1', prompt: 'un selfie' }))))
      await screen.findByRole('button', { name: /un selfie/ })

      await userEvent.click(screen.getByRole('button', { name: /un selfie/ }))

      expect(await screen.findByText(fr.upload.missionFor('un selfie'))).toBeVisible()
    })

    it('re-reads the checklist once a batch has settled, rather than ticking it itself', async () => {
      // An upload lands `pending` on a moderated event. A client that ticked the row on
      // send would tell a guest their mission was answered before anybody approved it —
      // the one thing this feature must not do.
      const myMissions = vi.fn(async () => ({
        items: [aGuestMission({ id: 'm1', prompt: 'un selfie' })],
      }))
      const api = fakeApi({ myMissions, uploadPhotos: vi.fn(async () => accepted('photo-1')) })
      havingJoined()
      renderUpload(api)
      await screen.findByRole('button', { name: /un selfie/ })
      expect(myMissions).toHaveBeenCalledTimes(1)

      await pickPhotos(aPhotoFile('confettis.jpg'))
      await userEvent.click(screen.getByRole('button', { name: fr.upload.sendCount(1) }))

      await waitFor(() => expect(myMissions).toHaveBeenCalledTimes(2))
    })

    it('still lets a guest send when the checklist could not be read', async () => {
      // The checklist is an invitation, not a gate.
      const api = fakeApi({
        myMissions: vi.fn(async () => Promise.reject(new Error('offline'))),
        uploadPhotos: vi.fn(async () => accepted('photo-1')),
      })
      havingJoined()
      renderUpload(api)
      await screen.findByTestId('upload-composer')

      await pickPhotos(aPhotoFile('confettis.jpg'))
      await userEvent.click(screen.getByRole('button', { name: fr.upload.sendCount(1) }))

      await waitFor(() => expect(api.uploadPhotos).toHaveBeenCalled())
    })
  })
})

describe('the privacy notice', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  /** A device that has not read the notice, as the join and the server both say. */
  const unread = aPrivacyNoticeState({ acknowledgement: 'none' })

  /** The server agreeing with the session, so a test is about one answer and not two. */
  const answering = (state: PrivacyNoticeState, extra: Partial<Api> = {}): Api =>
    fakeApi({ privacyNotice: vi.fn(async () => state), ...extra })

  const noticeRegion = () => screen.queryByRole('region', { name: fr.upload.noticeTitle })

  it('stands where the picker will be until the guest has read it', () => {
    havingJoined({}, unread)
    renderUpload(answering(unread))

    expect(noticeRegion()).toBeVisible()
    // Nothing that picks or sends a new photo is offered before the notice is read.
    expect(screen.queryByLabelText(fr.upload.addPhotos)).toBeNull()
    expect(screen.queryByLabelText(fr.upload.takePhoto)).toBeNull()
    expect(screen.queryByRole('button', { name: fr.upload.send })).toBeNull()
  })

  it('keeps everything else on the page for a guest who only came to look', async () => {
    havingJoined({}, unread)
    renderUpload(answering(unread))

    expect(screen.getByRole('heading', { level: 1, name: 'Camille & Sacha' })).toBeVisible()
    expect(await screen.findByText(fr.upload.mineEmpty)).toBeVisible()
    expect(screen.getByText(fr.upload.queueEmpty)).toBeVisible()
  })

  it('answers the four questions, from what the server said about this event', () => {
    const notice = aPrivacyNotice({ retentionDays: 30, selfRemovalSeconds: 900 })
    const state = aPrivacyNoticeState({ notice, acknowledgement: 'none' })
    havingJoined({}, state)
    renderUpload(answering(state))

    const region = within(screen.getByRole('region', { name: fr.upload.noticeTitle }))
    expect(region.getByText(fr.upload.noticeMetadataStripped)).toBeVisible()
    expect(region.getByText(fr.upload.noticePublication.afterReview)).toBeVisible()
    expect(region.getByText(fr.upload.noticeAudiences.wall)).toBeVisible()
    expect(region.getByText(fr.upload.noticeAudiences.organisers)).toBeVisible()
    expect(region.getByText(fr.upload.noticeAudiences.sharedGallery)).toBeVisible()
    expect(region.getByText(fr.upload.noticeRetentionDays(30))).toBeVisible()
    expect(region.getByText(fr.upload.noticeRemovalMinutes(15))).toBeVisible()
    expect(region.getByText(fr.upload.noticeRemovalOtherwise)).toBeVisible()
  })

  it('says plainly when nothing deletes the album on its own', () => {
    const state = aPrivacyNoticeState({
      notice: aPrivacyNotice({ retentionDays: null }),
      acknowledgement: 'none',
    })
    havingJoined({}, state)
    renderUpload(answering(state))

    expect(screen.getByText(fr.upload.noticeRetentionNone)).toBeVisible()
  })

  it('promises no self-deletion when the server says a guest cannot take a photo back', () => {
    const state = aPrivacyNoticeState({
      notice: aPrivacyNotice({ selfRemovalSeconds: null }),
      acknowledgement: 'none',
    })
    havingJoined({}, state)
    renderUpload(answering(state))

    expect(screen.getByText(fr.upload.noticeRemovalAskHost)).toBeVisible()
    expect(screen.queryByText(fr.upload.noticeRemovalMinutes(15))).toBeNull()
  })

  it('says a photo goes straight to the screen when the event publishes on arrival, and the header agrees', () => {
    const state = aPrivacyNoticeState({
      notice: aPrivacyNotice({ publication: 'immediate' }),
      acknowledgement: 'none',
    })
    havingJoined({}, state)
    renderUpload(answering(state))

    expect(screen.getByText(fr.upload.noticePublication.immediate)).toBeVisible()
    expect(screen.getByText(fr.upload.introImmediate)).toBeVisible()
    // The line that promised a validation would contradict the notice under it.
    expect(screen.queryByText(fr.upload.intro)).toBeNull()
  })

  it('records the reading with the revision the screen showed, and hands the guest the picker', async () => {
    const api = answering(unread)
    havingJoined({}, unread)
    renderUpload(api)

    await userEvent.click(screen.getByRole('button', { name: fr.upload.noticeAcknowledge }))

    expect(api.acknowledgePrivacyNotice).toHaveBeenCalledWith(SLUG, unread.notice.revision)
    expect(noticeRegion()).toBeNull()
    // Focus follows: the button pressed has gone, and the next Enter opens the picker
    // rather than starting again from the top of the page.
    expect(screen.getByLabelText(fr.upload.addPhotos)).toHaveFocus()
  })

  it('does not stand in the way of a device that has already read it', async () => {
    havingJoined()
    renderUpload(fakeApi())

    // In the document rather than visible: the real input is transparent over its label.
    expect(await screen.findByLabelText(fr.upload.addPhotos)).toBeInTheDocument()
    expect(noticeRegion()).toBeNull()
  })

  it('comes back, saying why, once the host has changed what it says', () => {
    const outdated = aPrivacyNoticeState({ acknowledgement: 'outdated' })
    havingJoined({}, outdated)
    renderUpload(answering(outdated))

    expect(screen.getByRole('region', { name: fr.upload.noticeChangedTitle })).toBeVisible()
    expect(screen.getByText(fr.upload.noticeChangedHint)).toBeVisible()
    expect(screen.queryByLabelText(fr.upload.addPhotos)).toBeNull()
  })

  it('asks the server when the page opens, so a change made since the join is not missed', async () => {
    // The session says read; the host has since changed retention. Only the fresh read
    // knows, and it must win over the snapshot.
    havingJoined()
    renderUpload(answering(aPrivacyNoticeState({ acknowledgement: 'outdated' })))

    expect(await screen.findByRole('region', { name: fr.upload.noticeChangedTitle })).toBeVisible()
    expect(screen.queryByLabelText(fr.upload.addPhotos)).toBeNull()
  })

  it('shows the new notice when the host changed it while the guest was reading', async () => {
    const changed = aPrivacyNoticeState({
      notice: aPrivacyNotice({ revision: 'r2', retentionDays: 7 }),
      acknowledgement: 'none',
    })
    const privacyNotice = vi
      .fn<Api['privacyNotice']>()
      .mockResolvedValueOnce(unread)
      .mockResolvedValue(changed)
    const api = fakeApi({
      privacyNotice,
      acknowledgePrivacyNotice: vi.fn(async () =>
        Promise.reject(new ApiError(409, 'privacyNotice.outdated')),
      ),
    })
    havingJoined({}, unread)
    renderUpload(api)
    await waitFor(() => expect(privacyNotice).toHaveBeenCalledTimes(1))

    await userEvent.click(screen.getByRole('button', { name: fr.upload.noticeAcknowledge }))

    expect(await screen.findByText(fr.upload.noticeRetentionDays(7))).toBeVisible()
    expect(screen.queryByLabelText(fr.upload.addPhotos)).toBeNull()
  })

  it('reopens from the header once read, and gives focus back when closed', async () => {
    havingJoined()
    renderUpload(fakeApi())
    const link = screen.getByRole('button', { name: fr.upload.noticeLink })

    await userEvent.click(link)

    const dialog = screen.getByRole('dialog', { name: fr.upload.noticeLink })
    expect(within(dialog).getByText(fr.upload.noticeAudiences.organisers)).toBeVisible()

    await userEvent.click(within(dialog).getByRole('button', { name: fr.app.close }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(link).toHaveFocus()
  })

  it('offers no way back to a notice that is still standing in for the picker', () => {
    havingJoined({}, unread)
    renderUpload(answering(unread))

    expect(screen.queryByRole('button', { name: fr.upload.noticeLink })).toBeNull()
  })

  it('keeps the picker for a guest whose tab joined before the notice existed', () => {
    // A deploy mid-evening. That guest has been sending photos all along; taking the
    // picker away until a request answers — or for good, offline — would be the notice
    // getting in the way of the thing it describes.
    havingJoined({}, null)
    renderUpload(fakeApi({ privacyNotice: vi.fn(() => new Promise<PrivacyNoticeState>(() => {})) }))

    expect(screen.getByLabelText(fr.upload.addPhotos)).toBeInTheDocument()
  })

  it('shows the notice to that guest as soon as the server says they have not read it', async () => {
    havingJoined({}, null)
    renderUpload(answering(unread))

    expect(await screen.findByRole('region', { name: fr.upload.noticeTitle })).toBeVisible()
  })
})

describe('the privacy notice, as the page changes around it', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  const read = aPrivacyNoticeState({ acknowledgement: 'current' })
  const changed = aPrivacyNoticeState({
    notice: aPrivacyNotice({ revision: 'r2', retentionDays: 7 }),
    acknowledgement: 'outdated',
  })

  /** Read at the join; changed by the host by the time the page next comes into view. */
  const changedOnReturn = (extra: Partial<Api> = {}): Api =>
    fakeApi({
      privacyNotice: vi
        .fn<Api['privacyNotice']>()
        .mockResolvedValueOnce(read)
        .mockResolvedValue(changed),
      ...extra,
    })

  const comeBackIntoView = (): void => {
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
  }

  it('leaves the composer in the flow while the notice is up, and sticky again once it is read', async () => {
    // A sticky pane taller than the phone has a top edge nobody can scroll to, and the
    // notice is the one thing this pane holds that can be that tall.
    havingJoined({}, aPrivacyNoticeState({ acknowledgement: 'none' }))
    renderUpload(
      fakeApi({
        privacyNotice: vi.fn(async () => aPrivacyNoticeState({ acknowledgement: 'none' })),
      }),
    )
    const composer = screen.getByTestId('upload-composer')
    expect(composer).toHaveAttribute('data-gated')

    await userEvent.click(screen.getByRole('button', { name: fr.upload.noticeAcknowledge }))

    expect(composer).not.toHaveAttribute('data-gated')
  })

  it('takes focus to a returning notice when the picker that held it has gone', async () => {
    havingJoined({}, read)
    renderUpload(changedOnReturn())
    const library = await screen.findByLabelText(fr.upload.addPhotos)
    library.focus()

    comeBackIntoView()

    const card = await screen.findByRole('region', { name: fr.upload.noticeChangedTitle })
    expect(card).toHaveFocus()
  })

  it('leaves focus where it is when the guest was somewhere the notice does not replace', async () => {
    havingJoined({}, read)
    renderUpload(changedOnReturn(withPhotos(aGuestPhoto({ id: 'photo-1', canDelete: true }))))
    const remove = await screen.findByRole('button', { name: fr.upload.deleteOwnNumbered(1) })
    remove.focus()

    comeBackIntoView()

    expect(await screen.findByRole('region', { name: fr.upload.noticeChangedTitle })).toBeVisible()
    expect(remove).toHaveFocus()
  })

  it('does not reopen the dialog over the picker after a changed notice is read', async () => {
    // The dialog was open when the changed notice took the picker's place: it was only
    // unmounted, and would otherwise pop straight back up and take the focus meant for
    // "Ajouter des photos".
    havingJoined({}, read)
    renderUpload(changedOnReturn())
    await userEvent.click(await screen.findByRole('button', { name: fr.upload.noticeLink }))
    expect(screen.getByRole('dialog', { name: fr.upload.noticeLink })).toBeVisible()

    comeBackIntoView()
    const card = await screen.findByRole('region', { name: fr.upload.noticeChangedTitle })
    await userEvent.click(within(card).getByRole('button', { name: fr.upload.noticeAcknowledge }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByLabelText(fr.upload.addPhotos)).toHaveFocus()
  })

  it('says a video is on the screen, not awaiting approval, on an event that publishes on arrival', async () => {
    // The same bytes sent twice answer `done` straight away, which is the path that does
    // not poll — and the line must still agree with the notice above it.
    const immediate = aPrivacyNoticeState({ notice: aPrivacyNotice({ publication: 'immediate' }) })
    havingJoined({ allowClips: true }, immediate)
    renderUpload(
      fakeApi({
        privacyNotice: vi.fn(async () => immediate),
        uploadClip: vi.fn(async () => aClipJob({ status: 'done' })),
      }),
    )
    const clipFile = new File([new Uint8Array([0, 0, 0, 0x18])], 'danse.mp4', { type: 'video/mp4' })

    await userEvent.upload(screen.getByLabelText(fr.upload.addClip), clipFile)
    await userEvent.click(screen.getByRole('button', { name: fr.upload.clipSend }))

    expect(await screen.findByText(fr.upload.clipDoneImmediate)).toBeVisible()
    expect(screen.queryByText(fr.upload.clipDone)).toBeNull()
  })
})
