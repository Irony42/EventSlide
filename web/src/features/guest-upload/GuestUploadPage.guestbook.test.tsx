import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GuestUploadPage } from './GuestUploadPage'
import { rememberGuestSession } from '../../lib/guestSession'
import { ApiError } from '../../lib/http'
import { fr } from '../../lib/i18n/fr'
import {
  aPrivacyNotice,
  aPrivacyNoticeState,
  aPublicEvent,
  fakeApi,
  renderWithProviders,
} from '../../testing/renderWithProviders'
import type { Api } from '../../lib/api/client'
import type { GuestbookEntryDto, MyGuestbookDto, PrivacyNoticeState } from '../../lib/api/dto'

/**
 * The guestbook card on the guest screen (spec 01, PR 2): offered only when the host switched it
 * on, only behind the notice, hidden by any refusal to answer, and driven by the server's
 * `accepting` and `canDelete` rather than by anything this screen works out.
 */

const SLUG = 'camille-et-sacha'

const anEntry = (overrides: Partial<GuestbookEntryDto> = {}): GuestbookEntryDto => ({
  id: 'entry-1',
  text: 'Une belle soirée',
  status: 'pending',
  createdAt: '2026-06-20T21:04:11.031Z',
  canDelete: true,
  ...overrides,
})

const mineWith = (
  items: readonly GuestbookEntryDto[] = [],
  overrides: Partial<MyGuestbookDto> = {},
): Partial<Api> => ({
  myGuestbook: vi.fn(async () => ({ items, accepting: true, onWall: true, ...overrides })),
})

const havingJoined = (
  guestbook = true,
  privacyNotice: PrivacyNoticeState | null = aPrivacyNoticeState(),
): void => {
  rememberGuestSession({
    event: aPublicEvent(guestbook ? { allowGuestbook: true, guestbookMaxLength: 500 } : {}),
    displayName: 'Léa',
    privacyNotice,
  })
}

const renderUpload = (api: Api) =>
  renderWithProviders(<GuestUploadPage />, {
    api,
    route: `/e/${SLUG}/upload`,
    path: '/e/:slug/upload',
  })

const openCard = async (): Promise<void> => {
  await userEvent.click(await screen.findByRole('button', { name: fr.guestbook.open }))
}

describe('GuestUploadPage, the guestbook', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('offers no card, and asks the server nothing, when the host has not switched it on', async () => {
    havingJoined(false)
    const api = fakeApi(mineWith())
    renderUpload(api)

    await waitFor(() => expect(api.myPhotos).toHaveBeenCalled())
    expect(screen.queryByRole('heading', { name: fr.guestbook.title })).toBeNull()
    expect(api.myGuestbook).not.toHaveBeenCalled()
  })

  it('writes a message and thanks the guest in the words of a moderated event', async () => {
    havingJoined()
    const api = fakeApi(mineWith())
    renderUpload(api)

    await openCard()
    await userEvent.type(screen.getByLabelText(fr.guestbook.label), 'Bravo les mariés')
    await userEvent.click(screen.getByRole('button', { name: fr.guestbook.send }))

    await waitFor(() =>
      expect(api.writeGuestbookEntry).toHaveBeenCalledWith(SLUG, 'Bravo les mariés'),
    )
    expect(await screen.findByText(fr.guestbook.thanksManual)).toBeVisible()
    // The form folds away and the list is read again.
    expect(screen.queryByLabelText(fr.guestbook.label)).toBeNull()
    await waitFor(() => expect(api.myGuestbook).toHaveBeenCalledTimes(2))
  })

  it('thanks the guest in the words of an event that publishes on arrival, from what the server decided', async () => {
    havingJoined()
    const api = fakeApi({
      ...mineWith(),
      writeGuestbookEntry: vi.fn(async (_slug: string, text: string) => ({
        id: 'entry-9',
        text,
        status: 'published' as const,
        createdAt: '2026-06-20T21:04:11.031Z',
        duplicate: false,
      })),
    })
    renderUpload(api)

    await openCard()
    await userEvent.type(screen.getByLabelText(fr.guestbook.label), 'Merci')
    await userEvent.click(screen.getByRole('button', { name: fr.guestbook.send }))

    expect(await screen.findByText(fr.guestbook.thanksAuto)).toBeVisible()
  })

  it('does not press send on an empty message', async () => {
    havingJoined()
    renderUpload(fakeApi(mineWith()))

    await openCard()
    await userEvent.type(screen.getByLabelText(fr.guestbook.label), '   ')

    expect(screen.getByRole('button', { name: fr.guestbook.send })).toBeDisabled()
  })

  it('keeps the text and says the limit the server stated when it refuses a long message', async () => {
    havingJoined()
    const api = fakeApi({
      ...mineWith(),
      writeGuestbookEntry: vi.fn(async () => {
        throw new ApiError(400, 'guestbook.tooLong', { max: 500 })
      }),
    })
    renderUpload(api)

    await openCard()
    await userEvent.type(screen.getByLabelText(fr.guestbook.label), 'Trop long')
    await userEvent.click(screen.getByRole('button', { name: fr.guestbook.send }))

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.guestbook.tooLong(500))
    expect(screen.getByLabelText(fr.guestbook.label)).toHaveValue('Trop long')
  })

  it('says the ceiling in words when the server refuses a fourth message', async () => {
    havingJoined()
    const api = fakeApi({
      ...mineWith(),
      writeGuestbookEntry: vi.fn(async () => {
        throw new ApiError(409, 'guestbook.limitReached', { already: 3 })
      }),
    })
    renderUpload(api)

    await openCard()
    await userEvent.type(screen.getByLabelText(fr.guestbook.label), 'Encore')
    await userEvent.click(screen.getByRole('button', { name: fr.guestbook.send }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      fr.guestbook.errors['guestbook.limitReached'],
    )
  })

  it('announces the counter only at four fifths of the limit and at the limit, not on every key', async () => {
    rememberGuestSession({
      event: aPublicEvent({ allowGuestbook: true, guestbookMaxLength: 10 }),
      displayName: 'Léa',
      privacyNotice: aPrivacyNoticeState(),
    })
    renderUpload(fakeApi(mineWith()))
    await openCard()
    const box = screen.getByLabelText(fr.guestbook.label)
    const live = () => screen.getByTestId('guestbook-announcement').textContent ?? ''

    await userEvent.type(box, 'abcde')
    expect(live()).toBe('')
    await userEvent.type(box, 'fgh')
    expect(live()).toBe(fr.guestbook.counterNear(2))
    await userEvent.type(box, 'i')
    // Still the sentence of the threshold: nothing is announced for the key.
    expect(live()).toBe(fr.guestbook.counterNear(2))
    await userEvent.type(box, 'j')
    expect(live()).toBe(fr.guestbook.counterFull)
    expect(screen.getByText(fr.guestbook.counter(10, 10))).toBeVisible()
  })

  it('keeps the card behind the privacy notice, as the photo picker is', async () => {
    const unread = aPrivacyNoticeState({ acknowledgement: 'none' })
    havingJoined(true, unread)
    renderUpload(fakeApi({ ...mineWith(), privacyNotice: vi.fn(async () => unread) }))

    expect(await screen.findByRole('button', { name: fr.upload.noticeAcknowledge })).toBeVisible()
    expect(screen.queryByRole('button', { name: fr.guestbook.open })).toBeNull()
  })

  it('keeps a closed evening’s card behind the notice too, and offers it once read', async () => {
    const unread = aPrivacyNoticeState({ acknowledgement: 'none' })
    havingJoined(true, unread)
    renderUpload(
      fakeApi({
        ...mineWith(),
        privacyNotice: vi.fn(async () => unread),
        myPhotos: vi.fn(async () => ({ items: [], acceptingUploads: false })),
      }),
    )

    expect(await screen.findByTestId('evening-ended')).toBeVisible()
    expect(await screen.findByRole('button', { name: fr.upload.noticeAcknowledge })).toBeVisible()
    expect(screen.queryByRole('button', { name: fr.guestbook.open })).toBeNull()
  })

  it('still takes a message on a closed evening when the server says it is accepting', async () => {
    havingJoined()
    renderUpload(
      fakeApi({
        ...mineWith([anEntry()]),
        myPhotos: vi.fn(async () => ({ items: [], acceptingUploads: false })),
      }),
    )

    expect(await screen.findByTestId('evening-ended')).toBeVisible()
    expect(await screen.findByRole('button', { name: fr.guestbook.open })).toBeVisible()
  })

  it('lists the messages without the card when the server says it is not accepting', async () => {
    havingJoined()
    renderUpload(fakeApi(mineWith([anEntry()], { accepting: false })))

    expect(await screen.findByText('Une belle soirée')).toBeVisible()
    expect(screen.queryByRole('button', { name: fr.guestbook.open })).toBeNull()
  })

  it.each([404, 403, 401])('hides the whole guestbook, with no error, on a %d', async (status) => {
    havingJoined()
    const api = fakeApi({
      myGuestbook: vi.fn(async () => {
        throw new ApiError(status, 'event.notFound')
      }),
    })
    renderUpload(api)

    await waitFor(() => expect(api.myGuestbook).toHaveBeenCalled())
    await waitFor(() => expect(api.myPhotos).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: fr.guestbook.open })).toBeNull()
    expect(screen.queryByRole('heading', { name: fr.guestbook.mine })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says each status in words, and says a published message is not on the wall when it is not', async () => {
    havingJoined()
    renderUpload(
      fakeApi(
        mineWith(
          [
            anEntry({ id: 'a', status: 'pending', canDelete: false }),
            anEntry({ id: 'b', status: 'published', canDelete: false }),
            anEntry({ id: 'c', status: 'rejected', canDelete: false }),
            anEntry({ id: 'd', status: 'hidden', canDelete: false }),
          ],
          { onWall: false },
        ),
      ),
    )

    expect(await screen.findByText(fr.guestbook.statusPending)).toBeVisible()
    expect(screen.getByText(fr.guestbook.statusPublishedNotOnWall)).toBeVisible()
    expect(screen.getByText(fr.guestbook.statusRejected)).toBeVisible()
    expect(screen.getByText(fr.guestbook.statusHidden)).toBeVisible()
    expect(screen.queryByText(fr.guestbook.statusPublished)).toBeNull()
  })

  it('says a published message is on the screen when the wall shows messages', async () => {
    havingJoined()
    renderUpload(fakeApi(mineWith([anEntry({ status: 'published', canDelete: false })])))

    expect(await screen.findByText(fr.guestbook.statusPublished)).toBeVisible()
  })

  it('offers “Retirer ce message” only on a message the server says can be taken back', async () => {
    havingJoined()
    renderUpload(
      fakeApi(
        mineWith([
          anEntry({ id: 'a', text: 'Retirable', canDelete: true }),
          anEntry({ id: 'b', text: 'Pas retirable', canDelete: false }),
        ]),
      ),
    )

    await screen.findByText('Retirable')
    expect(screen.getAllByRole('button', { name: fr.guestbook.remove })).toHaveLength(1)
  })

  it('asks before taking a message back, then says it is gone and reads the list again', async () => {
    havingJoined()
    const api = fakeApi(mineWith([anEntry()]))
    renderUpload(api)

    await userEvent.click(await screen.findByRole('button', { name: fr.guestbook.remove }))
    const dialog = await screen.findByRole('dialog', { name: fr.guestbook.removeTitle })
    await userEvent.click(within(dialog).getByRole('button', { name: fr.guestbook.removeConfirm }))

    await waitFor(() => expect(api.deleteMyGuestbookEntry).toHaveBeenCalledWith(SLUG, 'entry-1'))
    expect(await screen.findByText(fr.guestbook.removed)).toBeVisible()
    await waitFor(() => expect(api.myGuestbook).toHaveBeenCalledTimes(2))
  })

  it('keeps the message and says why when the server refuses the removal', async () => {
    havingJoined()
    const api = fakeApi({
      ...mineWith([anEntry()]),
      deleteMyGuestbookEntry: vi.fn(async () => {
        throw new ApiError(403, 'guestbook.deleteForbidden')
      }),
    })
    renderUpload(api)

    await userEvent.click(await screen.findByRole('button', { name: fr.guestbook.remove }))
    const dialog = await screen.findByRole('dialog', { name: fr.guestbook.removeTitle })
    await userEvent.click(within(dialog).getByRole('button', { name: fr.guestbook.removeConfirm }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      fr.guestbook.errors['guestbook.deleteForbidden'],
    )
    expect(screen.getByText('Une belle soirée')).toBeVisible()
    expect(screen.queryByText(fr.guestbook.removed)).toBeNull()
  })

  it('names the messages in the confirmation of “delete everything” when there is a guestbook', async () => {
    havingJoined()
    renderUpload(fakeApi(mineWith([anEntry()])))

    await userEvent.click(await screen.findByRole('button', { name: fr.upload.eraseOpen }))
    const dialog = await screen.findByRole('dialog', { name: fr.upload.eraseTitle })

    expect(dialog).toHaveTextContent(fr.guestbook.eraseBody)
  })

  it('words the privacy notice for messages too once the notice carries the guestbook', async () => {
    const unread = aPrivacyNoticeState({
      acknowledgement: 'none',
      notice: aPrivacyNotice({ guestbook: true }),
    })
    havingJoined(true, unread)
    renderUpload(fakeApi({ ...mineWith(), privacyNotice: vi.fn(async () => unread) }))

    expect(await screen.findByText(fr.guestbook.noticeWhatHappens)).toBeVisible()
    expect(screen.getByText(fr.guestbook.noticeMessageAudience)).toBeVisible()
  })

  it('shows the text of a message as text, never as markup', async () => {
    havingJoined()
    renderUpload(fakeApi(mineWith([anEntry({ text: '<img src=x onerror=alert(1)>' })])))

    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeVisible()
    expect(document.querySelector('img[src="x"]')).toBeNull()
  })
})
