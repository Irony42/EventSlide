import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '../../lib/http'
import { fr } from '../../lib/i18n/fr'
import {
  aClipJob,
  aGuestPhoto,
  aPrivacyNotice,
  aPrivacyNoticeState,
  fakeApi,
} from '../../testing/renderWithProviders'
import type { Api } from '../../lib/api/client'
import type { PrivacyNoticeState } from '../../lib/api/dto'
import { SLUG, havingJoined, renderUpload, withPhotos } from './testing/guestUploadHarness'

describe('the privacy notice', () => {
  beforeEach(() => {
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
    expect(screen.getByText(fr.upload.queueEmpty)).toBeVisible()
    expect(screen.getByRole('link', { name: fr.feed.link })).toBeVisible()
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
    expect(region.getByText(fr.upload.noticeAudiences.guestFeed)).toBeVisible()
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
