import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readGuestSession, readRememberedGuestSession } from '../../lib/guestSession'
import { ApiError } from '../../lib/http'
import { openOutbox } from '../../lib/offline/openOutbox'
import { fr } from '../../lib/i18n/fr'
import { aGuestPhoto, fakeApi } from '../../testing/renderWithProviders'
import type { Api } from '../../lib/api/client'
import type { UploadResponse } from '../../lib/api/dto'
import {
  SLUG,
  aPhotoFile,
  havingJoined,
  renderUpload,
  withPhotos,
  pickPhotos,
} from './testing/guestUploadHarness'

describe('a guest the server does not recognise any more (A1, A2)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    havingJoined()
  })

  it('is sent to the code entry, and the device forgets the event so the app does not loop', async () => {
    renderUpload(
      fakeApi({
        myPhotos: vi.fn(async () => {
          throw new ApiError(401, 'guestToken.expired')
        }),
      }),
    )

    expect(await screen.findByRole('heading', { name: fr.upload.notJoinedTitle })).toBeVisible()
    // Forgetting is the screen's passive effect, which runs after the heading is painted and not
    // with it: asserted at once, it raced the effect.
    await waitFor(() => {
      expect(readRememberedGuestSession()).toBeNull()
      expect(readGuestSession(SLUG)).toBeNull()
    })
  })
})

describe('a guest who comes back to the page after the tab was closed (A1, A2)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('finds the event the device remembers, with no code to type', () => {
    havingJoined()
    sessionStorage.clear()

    renderUpload(fakeApi())

    expect(screen.getByRole('heading', { level: 1, name: 'Camille & Sacha' })).toBeVisible()
  })

  it('asks for the code when the device remembers another event', () => {
    havingJoined({ slug: 'gala' })
    sessionStorage.clear()

    renderUpload(fakeApi())

    expect(screen.getByRole('heading', { name: fr.upload.notJoinedTitle })).toBeVisible()
  })

  it('lets the guest say it is not their evening, and forgets it', async () => {
    havingJoined()
    renderUpload(fakeApi())

    await userEvent.click(screen.getByRole('button', { name: fr.join.notYourEvening }))

    expect(readRememberedGuestSession()).toBeNull()
    expect(readGuestSession(SLUG)).toBeNull()
  })

  it('takes the photos waiting on this phone with it, so the next guest does not send them (QUAL-06)', async () => {
    havingJoined()
    const store = await openOutbox()
    await store.add(
      {
        slug: SLUG,
        bytes: new Uint8Array([0xff, 0xd8, 0xff]).buffer,
        fileName: 'avant.jpg',
        fileType: 'image/jpeg',
        caption: null,
        missionId: null,
      },
      1,
    )
    renderUpload(fakeApi())

    await userEvent.click(screen.getByRole('button', { name: fr.join.notYourEvening }))

    await waitFor(async () => expect(await store.list(SLUG)).toEqual([]))
  })
})

describe('leaving the event from the header (A10)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    havingJoined()
  })

  it('cannot be pressed while photos are on their way, which leaving would cancel', async () => {
    const api = fakeApi({
      uploadPhotos: vi.fn(() => new Promise<UploadResponse>(() => {})),
    })
    renderUpload(api)
    await pickPhotos(aPhotoFile('confettis.jpg'))
    await userEvent.click(screen.getByRole('button', { name: /Envoyer/ }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: fr.join.notYourEvening })).toBeDisabled(),
    )
    expect(readRememberedGuestSession()).not.toBeNull()
  })

  it('is available when nothing is being sent', () => {
    renderUpload(fakeApi())

    expect(screen.getByRole('button', { name: fr.join.notYourEvening })).toBeEnabled()
  })

  it('offers the way back to the code on a gallery the server says is gone, since a cookie from another event says the same', async () => {
    renderUpload(
      fakeApi({
        myPhotos: vi.fn(async () => {
          throw new ApiError(404, 'event.notFound')
        }),
      }),
    )

    expect(
      await screen.findByRole('link', { name: fr.upload.galleryUnavailableAction }),
    ).toHaveAttribute('href', '/join')
  })
})

describe('GuestUploadPage: delete everything I sent (roadmap §5.2)', () => {
  const openDialog = async () => {
    await userEvent.click(await screen.findByRole('button', { name: fr.upload.eraseOpen }))
    return screen.findByRole('dialog', { name: fr.upload.eraseTitle })
  }

  it('asks first, in words that say it cannot be undone, and sends nothing until confirmed', async () => {
    havingJoined()
    const api = fakeApi(withPhotos(aGuestPhoto({ id: 'photo-1' })))
    renderUpload(api)

    const dialog = await openDialog()

    expect(dialog).toHaveTextContent(fr.upload.eraseBody)
    expect(dialog).toHaveTextContent(fr.upload.eraseLimits)
    expect(api.eraseMyContribution).not.toHaveBeenCalled()
    await userEvent.click(within(dialog).getByRole('button', { name: fr.upload.eraseCancel }))
    expect(api.eraseMyContribution).not.toHaveBeenCalled()
  })

  it('erases on confirmation, says it is done and forgets the event on this device', async () => {
    havingJoined()
    const api = fakeApi(withPhotos(aGuestPhoto({ id: 'photo-1' })))
    renderUpload(api)

    const dialog = await openDialog()
    await userEvent.click(within(dialog).getByRole('button', { name: fr.upload.eraseConfirm }))

    expect(await screen.findByRole('heading', { name: fr.upload.eraseDoneTitle })).toBeVisible()
    expect(api.eraseMyContribution).toHaveBeenCalledWith(SLUG)
    expect(readGuestSession(SLUG)).toBeNull()
    expect(readRememberedGuestSession()).toBeNull()
  })

  it('keeps the session and says so when the server refuses', async () => {
    havingJoined()
    const api = fakeApi({
      ...withPhotos(aGuestPhoto({ id: 'photo-1' })),
      eraseMyContribution: vi.fn(async () => {
        throw new ApiError(500, 'internal.error')
      }),
    })
    renderUpload(api)

    const dialog = await openDialog()
    await userEvent.click(within(dialog).getByRole('button', { name: fr.upload.eraseConfirm }))

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.upload.eraseFailed)
    expect(readGuestSession(SLUG)).not.toBeNull()
  })

  it('treats a 401 as already erased: the answer of an earlier press was lost on the way back', async () => {
    havingJoined()
    const api = fakeApi({
      ...withPhotos(aGuestPhoto({ id: 'photo-1' })),
      eraseMyContribution: vi.fn(async () => {
        throw new ApiError(401, 'guestToken.malformed')
      }),
    })
    renderUpload(api)

    const dialog = await openDialog()
    await userEvent.click(within(dialog).getByRole('button', { name: fr.upload.eraseConfirm }))

    expect(await screen.findByRole('heading', { name: fr.upload.eraseDoneTitle })).toBeVisible()
    expect(readGuestSession(SLUG)).toBeNull()
  })

  it('tells a guest who has lost access how to ask the organiser', async () => {
    renderUpload(fakeApi())

    expect(
      await screen.findByText(new RegExp(fr.upload.eraseLostAccess.slice(0, 30))),
    ).toBeVisible()
  })
})

describe('GuestUploadPage: a guest the host removed can still erase what they sent', () => {
  const revokedApi = (overrides: Partial<Api> = {}) =>
    fakeApi({
      myPhotos: vi.fn(async () => {
        throw new ApiError(403, 'guest.revoked')
      }),
      ...overrides,
    })

  it('says in plain words that access was removed, offers nothing to send, and offers the erasure', async () => {
    havingJoined()
    renderUpload(revokedApi())

    expect(await screen.findByText(fr.upload.revokedTitle)).toBeVisible()
    expect(screen.getByText(fr.upload.revokedBody, { exact: false })).toBeVisible()
    expect(screen.queryByTestId('upload-composer')).toBeNull()
    expect(screen.getByRole('button', { name: fr.upload.eraseOpen })).toBeVisible()
  })

  it('goes through the same confirmation and ends on the done screen', async () => {
    havingJoined()
    const api = revokedApi()
    renderUpload(api)

    // The revoked screen replaces the ordinary one once the read answers; a click before that
    // would open a dialog that is then unmounted.
    await screen.findByText(fr.upload.revokedTitle)
    await userEvent.click(screen.getByRole('button', { name: fr.upload.eraseOpen }))
    const dialog = await screen.findByRole('dialog', { name: fr.upload.eraseTitle })
    expect(api.eraseMyContribution).not.toHaveBeenCalled()
    await userEvent.click(within(dialog).getByRole('button', { name: fr.upload.eraseConfirm }))

    expect(await screen.findByRole('heading', { name: fr.upload.eraseDoneTitle })).toBeVisible()
    expect(api.eraseMyContribution).toHaveBeenCalledWith(SLUG)
    expect(readGuestSession(SLUG)).toBeNull()
  })

  it('does not take any other 403 for a removal', async () => {
    havingJoined()
    renderUpload(
      fakeApi({
        myPhotos: vi.fn(async () => {
          throw new ApiError(403, 'auth.forbidden')
        }),
      }),
    )

    expect(await screen.findByTestId('upload-composer')).toBeVisible()
    expect(screen.queryByText(fr.upload.revokedTitle)).toBeNull()
  })
})
