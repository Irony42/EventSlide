import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../../lib/http'
import { fr } from '../../lib/i18n/fr'
import { aGuestPhoto, aPrivacyNoticeState, fakeApi } from '../../testing/renderWithProviders'
import type { Api } from '../../lib/api/client'
import type { GuestPhotoDto } from '../../lib/api/dto'
import { aPhotoFile, havingJoined, renderUpload, pickPhotos } from './testing/guestUploadHarness'

describe('an event that no longer takes photos', () => {
  // This block once found its guest in the session an earlier block had left in `sessionStorage`;
  // the setup now clears it after every test, so the guest joins here, as a real one does.
  beforeEach(() => {
    havingJoined()
  })

  const closed = (photos: readonly GuestPhotoDto[] = []): Api =>
    fakeApi({ myPhotos: vi.fn(async () => ({ items: photos, acceptingUploads: false })) })

  it('says the evening is over, and offers no way to pick a photo', async () => {
    renderUpload(closed())

    expect(await screen.findByText(fr.upload.endedTitle)).toBeVisible()
    expect(screen.queryByLabelText(fr.upload.addPhotos)).toBeNull()
  })

  it('thanks the guest for their photos and says where the album will come from, in a card and not a warning (INV-4)', async () => {
    const photos = [aGuestPhoto({ id: 'mine-1' }), aGuestPhoto({ id: 'mine-2' })]
    renderUpload(closed(photos))

    const card = await screen.findByTestId('evening-ended')
    expect(within(card).getByRole('heading', { name: fr.upload.endedTitle })).toBeVisible()
    expect(within(card).getByText(fr.upload.endedThanks(2))).toBeVisible()
    expect(within(card).getByText(fr.upload.endedAlbum)).toBeVisible()
    // The refusal sentence is the server's, for an upload that was tried; nothing was.
    expect(screen.queryByText(fr.errors['event.notAcceptingUploads'])).toBeNull()
  })

  it('counts the photos from the list already on screen, and thanks a guest who sent none all the same', async () => {
    const photos = [aGuestPhoto({ id: 'mine-1' })]
    const api = closed(photos)
    renderUpload(api)
    expect(await screen.findByText(fr.upload.endedThanks(1))).toBeVisible()
    // One read, which the page already made: the card adds no request.
    expect(api.myPhotos).toHaveBeenCalledTimes(1)
  })

  it('does not thank the guest for photos the host refused', async () => {
    renderUpload(
      closed([
        aGuestPhoto({ id: 'ok', status: 'published' }),
        aGuestPhoto({ id: 'no', status: 'rejected' }),
      ]),
    )

    expect(await screen.findByText(fr.upload.endedThanks(1))).toBeVisible()
  })

  it('thanks a guest who sent nothing without counting them', async () => {
    renderUpload(closed())

    expect(await screen.findByText(fr.upload.endedThanksNone)).toBeVisible()
    expect(screen.queryByText(fr.upload.endedThanks(0))).toBeNull()
  })

  it('keeps showing the guest their own photos, which are what they come back for', async () => {
    renderUpload(closed([aGuestPhoto({ id: 'mine-1' })]))

    expect(await screen.findByText(fr.upload.endedTitle)).toBeVisible()
    expect(screen.getAllByRole('img').length).toBeGreaterThan(0)
  })

  it('makes no promise about photos held for the network once the event is closed', async () => {
    havingJoined()
    let reads = 0
    const api = fakeApi({
      myPhotos: vi.fn(async () => {
        reads += 1
        return { items: [], acceptingUploads: reads === 1 }
      }),
      uploadPhotos: vi.fn(async () => {
        throw ApiError.network()
      }),
    })
    renderUpload(api)
    await pickPhotos(aPhotoFile('confettis.jpg'))
    await userEvent.click(screen.getByRole('button', { name: fr.upload.sendCount(1) }))

    expect(await screen.findByText(fr.upload.endedTitle)).toBeVisible()
    expect(screen.queryByTestId('offline-notice')).not.toBeInTheDocument()
  })

  it('says it while a privacy notice is still unread, since nothing could be sent anyway', async () => {
    const unread = aPrivacyNoticeState({ acknowledgement: 'none' })
    havingJoined({}, unread)
    renderUpload(
      fakeApi({
        privacyNotice: vi.fn(async () => unread),
        myPhotos: vi.fn(async () => ({ items: [], acceptingUploads: false })),
      }),
    )

    expect(await screen.findByText(fr.upload.endedTitle)).toBeVisible()
  })

  it('offers the picker as before while the event takes photos, and on a server that does not say', async () => {
    renderUpload(fakeApi())

    expect(await screen.findByLabelText(fr.upload.addPhotos)).toBeInTheDocument()
    expect(screen.queryByText(fr.upload.endedTitle)).toBeNull()
  })
})

describe('a gallery the server no longer serves (A3)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    havingJoined()
  })

  /** A suspended account: the server answers `404` before it would say the evening is over. */
  const suspended = (): Api =>
    fakeApi({
      myPhotos: vi.fn(async () => {
        throw new ApiError(404, 'event.notFound')
      }),
    })

  it('says so, and offers no button that every send would fail on', async () => {
    renderUpload(suspended())

    expect(await screen.findByText(fr.upload.galleryUnavailable)).toBeVisible()
    expect(screen.queryByLabelText(fr.upload.addPhotos)).toBeNull()
    expect(screen.queryByRole('button', { name: fr.upload.send })).toBeNull()
  })

  it('stops offering the photographs of the evening, which are not served either', async () => {
    renderUpload(suspended())
    await screen.findByText(fr.upload.galleryUnavailable)

    expect(screen.queryByRole('link', { name: fr.feed.link })).toBeNull()
  })

  it('does not call a missing gallery an empty list of sends', async () => {
    renderUpload(suspended())
    await screen.findByText(fr.upload.galleryUnavailable)

    expect(screen.queryByText(fr.upload.mineEmpty)).toBeNull()
    expect(screen.queryByText(fr.upload.mineFailed)).toBeNull()
  })

  it('keeps the link to the feed on a closed evening, which still has its wall', async () => {
    renderUpload(fakeApi({ myPhotos: vi.fn(async () => ({ items: [], acceptingUploads: false })) }))
    await screen.findByText(fr.upload.endedTitle)

    // Closed, not archived: the wall and the feed still exist, and "C'est fini" is no reason to hide them.
    expect(screen.getByRole('link', { name: fr.feed.link })).toBeVisible()
  })

  it('keeps offering a retry when the list could not be read for a reason that is the network’s', async () => {
    renderUpload(
      fakeApi({
        myPhotos: vi.fn(async () => {
          throw ApiError.network()
        }),
      }),
    )

    expect(await screen.findByText(fr.upload.mineFailed)).toBeVisible()
    expect(screen.queryByText(fr.upload.galleryUnavailable)).toBeNull()
    expect(screen.getByLabelText(fr.upload.addPhotos)).toBeInTheDocument()
  })
})
