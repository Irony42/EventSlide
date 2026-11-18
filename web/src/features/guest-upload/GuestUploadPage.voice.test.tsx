import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GuestUploadPage } from './GuestUploadPage'
import { rememberGuestSession } from '../../lib/guestSession'
import { ApiError } from '../../lib/http'
import { fr } from '../../lib/i18n/fr'
import { forgetMemoryFallback } from '../../lib/offline/openOutbox'
import { forgetVoiceMemoryFallback, openVoiceOutbox } from '../../lib/offline/openVoiceOutbox'
import {
  aPrivacyNotice,
  aPrivacyNoticeState,
  aPublicEvent,
  fakeApi,
  renderWithProviders,
} from '../../testing/renderWithProviders'
import { installFakeMicrophone, type FakeMicrophone } from './testing/fakeMicrophone'
import type { Api } from '../../lib/api/client'
import type { GuestbookEntryDto, MyGuestbookDto, PrivacyNoticeState } from '../../lib/api/dto'

/**
 * The voice message on the guest screen (spec 25, PR 6), through the page: the button and when it is
 * absent, recording, listening before sending, the phone's own queue (offline, kept, dropped) and
 * "Mes messages". A fake microphone and a mocked clock stand in for the device.
 */

const SLUG = 'camille-et-sacha'
const copy = fr.guestbookVoice

let microphone: FakeMicrophone
let nowMs = 1_760_000_000_000

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  nowMs = 1_760_000_000_000
  vi.spyOn(Date, 'now').mockImplementation(() => nowMs)
  forgetMemoryFallback()
  forgetVoiceMemoryFallback()
  microphone = installFakeMicrophone()
  // The local copy and its player: jsdom has neither.
  URL.createObjectURL = vi.fn(() => 'blob:local-copy')
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async () => undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
})

afterEach(() => {
  microphone.uninstall()
  Reflect.deleteProperty(navigator, 'onLine')
  Reflect.deleteProperty(URL, 'createObjectURL')
  Reflect.deleteProperty(URL, 'revokeObjectURL')
})

const aVoiceEntry = (overrides: Partial<GuestbookEntryDto> = {}): GuestbookEntryDto => ({
  id: 'voice-1',
  text: null,
  status: 'pending',
  createdAt: '2026-06-20T21:04:11.031Z',
  canDelete: true,
  voice: { state: 'ready', durationMs: 23_000, caption: null },
  ...overrides,
})

const mineWith = (
  items: readonly GuestbookEntryDto[] = [],
  overrides: Partial<MyGuestbookDto> = {},
): Partial<Api> => ({
  myGuestbook: vi.fn(async () => ({
    items,
    accepting: true,
    onWall: true,
    voiceAvailable: true,
    ...overrides,
  })),
})

const havingJoined = (privacyNotice: PrivacyNoticeState | null = aPrivacyNoticeState()): void => {
  rememberGuestSession({
    event: aPublicEvent({ allowGuestbook: true, guestbookMaxLength: 500 }),
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

const voiceButton = () => screen.findByRole('button', { name: copy.open })

/** Opens the recorder, speaks for `seconds`, stops: ends on the preview. */
const recordFor = async (seconds: number): Promise<void> => {
  await userEvent.click(await voiceButton())
  await userEvent.click(await screen.findByRole('button', { name: copy.record }))
  await screen.findByRole('button', { name: copy.stop })
  nowMs += seconds * 1_000
  await userEvent.click(screen.getByRole('button', { name: copy.stop }))
  await screen.findByRole('button', { name: copy.send })
}

const send = () => userEvent.click(screen.getByRole('button', { name: copy.send }))

const setOnline = (online: boolean): void => {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true })
}

describe('GuestUploadPage, the voice message button', () => {
  it('offers it under the text button, in the same card, when the server and the browser both can', async () => {
    havingJoined()
    renderUpload(fakeApi(mineWith()))

    const voice = await voiceButton()
    const text = screen.getByRole('button', { name: fr.guestbook.open })
    // Stacked, in this order, in one column: two buttons side by side do not fit 375 px at the thumb.
    expect(text.parentElement).toBe(voice.parentElement)
    expect(text.compareDocumentPosition(voice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('does not offer it when the server says the voice would not be taken', async () => {
    havingJoined()
    renderUpload(fakeApi(mineWith([], { voiceAvailable: false })))

    await screen.findByRole('button', { name: fr.guestbook.open })
    expect(screen.queryByRole('button', { name: copy.open })).toBeNull()
  })

  it('does not offer it without a secure context, and says nothing about a desktop browser', async () => {
    microphone.uninstall()
    microphone = installFakeMicrophone({ secure: false })
    havingJoined()
    renderUpload(fakeApi(mineWith()))

    await screen.findByRole('button', { name: fr.guestbook.open })
    expect(screen.queryByRole('button', { name: copy.open })).toBeNull()
    // The sentence about another browser is for a link opened inside another app, and for nothing else.
    expect(screen.queryByText(copy.openInBrowser)).toBeNull()
  })

  it('does not offer it without MediaRecorder', async () => {
    vi.stubGlobal('MediaRecorder', undefined)
    havingJoined()
    renderUpload(fakeApi(mineWith()))

    await screen.findByRole('button', { name: fr.guestbook.open })
    expect(screen.queryByRole('button', { name: copy.open })).toBeNull()
  })

  it('does not offer it when the browser knows none of the formats', async () => {
    microphone.uninstall()
    microphone = installFakeMicrophone({ formats: [] })
    havingJoined()
    renderUpload(fakeApi(mineWith()))

    await screen.findByRole('button', { name: fr.guestbook.open })
    expect(screen.queryByRole('button', { name: copy.open })).toBeNull()
  })

  it('says to open the page in Safari or Chrome, and offers no button, inside another app', async () => {
    microphone.uninstall()
    microphone = installFakeMicrophone({ secure: false })
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 [FBAN/FBIOS;FBAV/430.0]',
    )
    havingJoined()
    renderUpload(fakeApi(mineWith()))

    expect(await screen.findByText(copy.openInBrowser)).toBeVisible()
    expect(screen.queryByRole('button', { name: copy.open })).toBeNull()
    // The text is still there.
    expect(screen.getByRole('button', { name: fr.guestbook.open })).toBeVisible()
  })

  it('keeps it behind the privacy notice, with the rest of the card', async () => {
    const unread = aPrivacyNoticeState({ acknowledgement: 'none' })
    havingJoined(unread)
    renderUpload(fakeApi({ ...mineWith(), privacyNotice: vi.fn(async () => unread) }))

    expect(await screen.findByRole('button', { name: fr.upload.noticeAcknowledge })).toBeVisible()
    expect(screen.queryByRole('button', { name: copy.open })).toBeNull()
  })

  it('never asks for the microphone before the guest presses record', async () => {
    havingJoined()
    renderUpload(fakeApi(mineWith()))

    await userEvent.click(await voiceButton())

    expect(microphone.getUserMedia).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: copy.record })).toBeVisible()
  })
})

describe('GuestUploadPage, recording and sending a voice message', () => {
  it('records, lets the guest listen, and sends the recording with its caption', async () => {
    havingJoined()
    const api = fakeApi(mineWith())
    renderUpload(api)

    await recordFor(5)
    await userEvent.click(screen.getByRole('button', { name: copy.listen }))
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled()
    await userEvent.type(screen.getByLabelText(new RegExp(copy.captionLabel)), 'Pour vous deux')
    await send()

    await waitFor(() => expect(api.leaveVoiceMessage).toHaveBeenCalledTimes(1))
    const [slug, input] = vi.mocked(api.leaveVoiceMessage).mock.calls[0] ?? []
    expect(slug).toBe(SLUG)
    expect(input?.file.type).toBe('audio/webm')
    expect(input?.file.name).toBe('message-vocal.webm')
    expect(input?.caption).toBe('Pour vous deux')
    expect(await screen.findByText(copy.thanksManual)).toBeVisible()
    // The card is read again, so "Mes messages" shows what the server now holds.
    await waitFor(() => expect(api.myGuestbook).toHaveBeenCalledTimes(2))
    expect(microphone.released()).toBe(true)
  })

  it('does not say what the 202 cannot know: the thanks of a moderated event never says "dans le livre d’or"', async () => {
    havingJoined()
    renderUpload(fakeApi(mineWith()))

    await recordFor(3)
    await send()

    expect(await screen.findByText(copy.thanksManual)).toBeVisible()
    expect(screen.queryByText(copy.thanksAuto)).toBeNull()
  })

  it('thanks an event that keeps messages on arrival in its own words', async () => {
    const immediate = aPrivacyNoticeState({ notice: aPrivacyNotice({ publication: 'immediate' }) })
    havingJoined(immediate)
    renderUpload(fakeApi({ ...mineWith(), privacyNotice: vi.fn(async () => immediate) }))

    await recordFor(3)
    await send()

    expect(await screen.findByText(copy.thanksAuto)).toBeVisible()
  })

  it('throws a take away on "Recommencer", and nothing leaves the phone', async () => {
    havingJoined()
    const api = fakeApi(mineWith())
    renderUpload(api)
    await recordFor(3)

    await userEvent.click(screen.getByRole('button', { name: copy.restart }))

    expect(screen.getByRole('button', { name: copy.record })).toBeVisible()
    expect(api.leaveVoiceMessage).not.toHaveBeenCalled()
    expect(await (await openVoiceOutbox()).list(SLUG)).toHaveLength(0)
  })

  it('sends nothing when the guest cancels after recording', async () => {
    havingJoined()
    const api = fakeApi(mineWith())
    renderUpload(api)
    await recordFor(3)

    await userEvent.click(screen.getByRole('button', { name: copy.cancel }))

    expect(api.leaveVoiceMessage).not.toHaveBeenCalled()
    expect(await voiceButton()).toBeVisible()
    expect(microphone.released()).toBe(true)
  })

  it('says the microphone is blocked, and offers the text instead, when the guest refuses', async () => {
    havingJoined()
    renderUpload(fakeApi(mineWith()))
    await userEvent.click(await voiceButton())
    microphone.refuseWith('NotAllowedError')

    await userEvent.click(screen.getByRole('button', { name: copy.record }))

    expect(await screen.findByRole('alert')).toHaveTextContent(copy.micBlocked)
    await userEvent.click(screen.getByRole('button', { name: copy.writeInstead }))
    expect(await screen.findByLabelText(fr.guestbook.label)).toBeVisible()
  })

  it('says something else when it is the page the browser forbade, because the guest can do nothing about it', async () => {
    Object.defineProperty(document, 'permissionsPolicy', {
      value: { allowsFeature: () => false },
      configurable: true,
    })
    havingJoined()
    renderUpload(fakeApi(mineWith()))
    await userEvent.click(await voiceButton())
    microphone.refuseWith('NotAllowedError')

    await userEvent.click(screen.getByRole('button', { name: copy.record }))

    expect(await screen.findByRole('alert')).toHaveTextContent(copy.micUnavailableHere)
    expect(screen.queryByText(copy.micBlocked)).toBeNull()
    Reflect.deleteProperty(document, 'permissionsPolicy')
  })

  it('lets the guest send when the preview cannot be played here', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(new Error('NotSupportedError'))
    havingJoined()
    const api = fakeApi(mineWith())
    renderUpload(api)
    await recordFor(3)

    await userEvent.click(screen.getByRole('button', { name: copy.listen }))

    expect(await screen.findByText(copy.previewFailed)).toBeVisible()
    await send()
    await waitFor(() => expect(api.leaveVoiceMessage).toHaveBeenCalledTimes(1))
  })

  it('announces the start and the stop politely, in one region, and not second by second', async () => {
    havingJoined()
    renderUpload(fakeApi(mineWith()))
    await userEvent.click(await voiceButton())
    const region = screen.getByTestId('voice-announcement')
    expect(region).toHaveAttribute('role', 'status')
    expect(region).toHaveTextContent('')

    await userEvent.click(screen.getByRole('button', { name: copy.record }))
    await screen.findByRole('button', { name: copy.stop })
    expect(screen.getByTestId('voice-announcement')).toHaveTextContent(copy.recordingAnnounce)

    nowMs += 12_000
    await userEvent.click(screen.getByRole('button', { name: copy.stop }))
    await screen.findByRole('button', { name: copy.send })
    expect(screen.getByTestId('voice-announcement')).toHaveTextContent(
      copy.recordedAnnounce('0:12'),
    )
  })

  it('says no microphone could be used when the device has none', async () => {
    havingJoined()
    renderUpload(fakeApi(mineWith()))
    await userEvent.click(await voiceButton())
    microphone.refuseWith('NotFoundError')

    await userEvent.click(screen.getByRole('button', { name: copy.record }))

    expect(await screen.findByRole('alert')).toHaveTextContent(copy.micMissing)
  })

  it('does not take a press by mistake for a message', async () => {
    havingJoined()
    renderUpload(fakeApi(mineWith()))
    await userEvent.click(await voiceButton())
    await userEvent.click(screen.getByRole('button', { name: copy.record }))
    await screen.findByRole('button', { name: copy.stop })

    nowMs += 300
    await userEvent.click(screen.getByRole('button', { name: copy.stop }))

    expect(await screen.findByRole('alert')).toHaveTextContent(copy.tooShort)
    expect(screen.queryByRole('button', { name: copy.send })).toBeNull()
  })

  it('pauses the preview on a second press, and starts again when it ends', async () => {
    havingJoined()
    renderUpload(fakeApi(mineWith()))
    await recordFor(3)

    await userEvent.click(screen.getByRole('button', { name: copy.listen }))
    await userEvent.click(screen.getByRole('button', { name: copy.listenPause }))
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: copy.listen }))
    act(() => void document.querySelector('audio')?.dispatchEvent(new Event('ended')))

    expect(screen.getByRole('button', { name: copy.listen })).toBeVisible()
  })

  it('says the preview cannot be played when the player reports an error, and still lets the guest send', async () => {
    havingJoined()
    renderUpload(fakeApi(mineWith()))
    await recordFor(3)

    act(() => void document.querySelector('audio')?.dispatchEvent(new Event('error')))

    expect(await screen.findByText(copy.previewFailed)).toBeVisible()
    expect(screen.getByRole('button', { name: copy.send })).toBeEnabled()
  })

  it('says there are ten seconds left, once, from the fiftieth, and stops by itself at sixty', async () => {
    havingJoined()
    const api = fakeApi(mineWith())
    renderUpload(api)
    await userEvent.click(await voiceButton())
    await userEvent.click(screen.getByRole('button', { name: copy.record }))
    await screen.findByRole('button', { name: copy.stop })

    nowMs += 50_000
    await waitFor(() =>
      expect(screen.getByTestId('voice-announcement')).toHaveTextContent(copy.nearEnd),
    )
    expect(screen.getByText(copy.clock('0:50', '1:00'))).toBeVisible()

    nowMs += 10_000
    expect(await screen.findByRole('button', { name: copy.send })).toBeEnabled()
    expect(screen.getByTestId('voice-announcement')).toHaveTextContent(
      copy.recordedAnnounce('1:00'),
    )
    expect(microphone.released()).toBe(true)
  })

  it('says the recording stopped because the page was left, and keeps what there is', async () => {
    havingJoined()
    renderUpload(fakeApi(mineWith()))
    await userEvent.click(await voiceButton())
    await userEvent.click(screen.getByRole('button', { name: copy.record }))
    await screen.findByRole('button', { name: copy.stop })

    nowMs += 23_000
    act(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    Reflect.deleteProperty(document, 'visibilityState')

    expect(await screen.findByText(copy.interrupted('0:23'))).toBeVisible()
    expect(screen.getByRole('button', { name: copy.send })).toBeEnabled()
  })
})

describe('GuestUploadPage, the voice queue of the phone', () => {
  it('writes the recording to the phone before it tries the network, and says it is waiting', async () => {
    setOnline(false)
    havingJoined()
    const api = fakeApi(mineWith())
    renderUpload(api)

    await recordFor(4)
    await send()

    expect(await screen.findByText(copy.waitingNetwork)).toBeVisible()
    expect(api.leaveVoiceMessage).not.toHaveBeenCalled()
    const held = await (await openVoiceOutbox()).list(SLUG)
    expect(held).toHaveLength(1)
    expect(held[0]?.fileType).toBe('audio/webm')
    // In "Mes messages", apart, with the one sentence that is true for photos and for the voice.
    const row = await screen.findByTestId('local-voice')
    expect(within(row).getByText(copy.localWaiting)).toBeVisible()
    expect(within(row).getByText(copy.offlineHintKeepOpen)).toBeVisible()
  })

  it('sends it once, when the network comes back, and forgets it', async () => {
    setOnline(false)
    havingJoined()
    const api = fakeApi(mineWith())
    renderUpload(api)
    await recordFor(4)
    await send()
    await screen.findByText(copy.waitingNetwork)

    setOnline(true)
    act(() => window.dispatchEvent(new Event('online')))

    await waitFor(() => expect(api.leaveVoiceMessage).toHaveBeenCalledTimes(1))
    await waitFor(async () => expect(await (await openVoiceOutbox()).list(SLUG)).toHaveLength(0))
    expect(screen.queryByTestId('local-voice')).toBeNull()
  })

  it('keeps the recording and tries again when the server could not answer', async () => {
    havingJoined()
    const api = fakeApi({
      ...mineWith(),
      leaveVoiceMessage: vi.fn(async () => {
        throw new ApiError(503, 'unknown')
      }),
    })
    renderUpload(api)
    await recordFor(4)

    await send()

    expect(await screen.findByText(copy.waitingNetwork)).toBeVisible()
    expect(await (await openVoiceOutbox()).list(SLUG)).toHaveLength(1)
  })

  it('keeps the recording, with the reason, when the host has switched the voices off, and lets the guest save it', async () => {
    havingJoined()
    const api = fakeApi({
      ...mineWith(),
      leaveVoiceMessage: vi.fn(async () => {
        throw new ApiError(409, 'guestbook.voiceDisabled')
      }),
    })
    renderUpload(api)
    await recordFor(4)

    await send()

    const reason = `${fr.guestbook.errors['guestbook.voiceDisabled']} ${copy.keptOnPhone}`
    expect((await screen.findAllByText(reason)).length).toBeGreaterThan(0)
    // Never destroyed: the file is still on the phone, and the guest is offered it.
    expect(await (await openVoiceOutbox()).list(SLUG)).toHaveLength(1)
    const row = await screen.findByTestId('local-voice')
    expect(within(row).getByText(copy.localBlocked)).toBeVisible()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await userEvent.click(within(row).getByRole('button', { name: copy.saveToPhone }))
    expect(click).toHaveBeenCalled()
    // …and it is not retried on a timer: one request, the first.
    expect(api.leaveVoiceMessage).toHaveBeenCalledTimes(1)
  })

  it('lets the guest delete a blocked recording', async () => {
    havingJoined()
    renderUpload(
      fakeApi({
        ...mineWith(),
        leaveVoiceMessage: vi.fn(async () => {
          throw new ApiError(409, 'event.notAcceptingUploads')
        }),
      }),
    )
    await recordFor(4)
    await send()
    const row = await screen.findByTestId('local-voice')

    await userEvent.click(within(row).getByRole('button', { name: copy.deleteLocal }))

    await waitFor(() => expect(screen.queryByTestId('local-voice')).toBeNull())
    expect(await (await openVoiceOutbox()).list(SLUG)).toHaveLength(0)
  })

  it('drops the recording, and says why, only when the server refuses the recording itself', async () => {
    havingJoined()
    renderUpload(
      fakeApi({
        ...mineWith(),
        leaveVoiceMessage: vi.fn(async () => {
          throw new ApiError(400, 'voice.corrupt')
        }),
      }),
    )
    await recordFor(4)

    await send()

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.guestbook.errors['voice.corrupt'])
    expect(await (await openVoiceOutbox()).list(SLUG)).toHaveLength(0)
  })

  it('does not let a guest put a fourth message in the queue: the server would refuse it', async () => {
    havingJoined()
    renderUpload(
      fakeApi(
        mineWith([
          aVoiceEntry({ id: 'a' }),
          aVoiceEntry({ id: 'b' }),
          aVoiceEntry({ id: 'c', text: 'Un mot', voice: null }),
        ]),
      ),
    )

    await userEvent.click(await voiceButton())

    expect(await screen.findByRole('alert')).toHaveTextContent(
      fr.guestbook.errors['guestbook.limitReached'],
    )
    expect(screen.queryByRole('button', { name: copy.record })).toBeNull()
  })

  it('does not count a recording the server failed to process against the three', async () => {
    havingJoined()
    renderUpload(
      fakeApi(
        mineWith([
          aVoiceEntry({ id: 'a' }),
          aVoiceEntry({ id: 'b' }),
          aVoiceEntry({ id: 'c', voice: { state: 'failed', durationMs: null, caption: null } }),
        ]),
      ),
    )

    await userEvent.click(await voiceButton())

    expect(await screen.findByRole('button', { name: copy.record })).toBeVisible()
  })

  it('empties the voice queue with "Tout effacer"', async () => {
    setOnline(false)
    havingJoined()
    renderUpload(fakeApi(mineWith()))
    await recordFor(4)
    await send()
    await screen.findByTestId('local-voice')

    await userEvent.click(screen.getByRole('button', { name: fr.upload.eraseOpen }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: fr.upload.eraseConfirm }))

    await waitFor(async () => expect(await (await openVoiceOutbox()).list(SLUG)).toHaveLength(0))
  })

  it('arrives with a recording from an earlier visit and sends it', async () => {
    havingJoined()
    const store = await openVoiceOutbox()
    await store.add(
      {
        slug: SLUG,
        bytes: new Uint8Array([1, 2, 3]).buffer,
        fileName: 'message-vocal.webm',
        fileType: 'audio/webm',
        caption: null,
        missionId: null,
      },
      nowMs - 60_000,
    )
    const api = fakeApi(mineWith())

    renderUpload(api)

    await waitFor(() => expect(api.leaveVoiceMessage).toHaveBeenCalledTimes(1))
  })
})

describe('GuestUploadPage, Mes messages and the voice', () => {
  it('shows the duration and where the recording stands, and no player', async () => {
    havingJoined()
    renderUpload(
      fakeApi(
        mineWith([
          aVoiceEntry({ id: 'a', status: 'pending' }),
          aVoiceEntry({
            id: 'b',
            status: 'published',
            voice: { state: 'ready', durationMs: 9_000, caption: 'Pour vous' },
          }),
          aVoiceEntry({ id: 'c', status: 'rejected' }),
          aVoiceEntry({ id: 'd', voice: { state: 'queued', durationMs: null, caption: null } }),
        ]),
      ),
    )

    // Three of the four are 23 seconds long; one is 9; the fourth is still being processed.
    expect(await screen.findAllByText(copy.messageLabel('0:23'))).toHaveLength(2)
    expect(screen.getByText(copy.messageLabel('0:09'))).toBeVisible()
    expect(screen.getByText(copy.messageLabel(null))).toBeVisible()
    expect(screen.getAllByText(fr.guestbook.statusPending).length).toBeGreaterThan(0)
    expect(screen.getByText(copy.statusPublished)).toBeVisible()
    expect(screen.getByText(fr.guestbook.statusRejected)).toBeVisible()
    expect(screen.getByText(copy.statusProcessing)).toBeVisible()
    // The author does not hear it again: they listened before sending, and a second door is a
    // second place for the secret of an event to leak.
    expect(document.querySelector('audio')).toBeNull()
  })

  it('never says a voice is on the screen, nor that it was taken off it', async () => {
    havingJoined()
    renderUpload(fakeApi(mineWith([aVoiceEntry({ status: 'published' })])))

    await screen.findByText(copy.statusPublished)
    expect(screen.queryByText(fr.guestbook.statusPublished)).toBeNull()
    expect(screen.queryByText(fr.guestbook.statusHidden)).toBeNull()
  })

  it('offers "Retirer ce message" only when the server says canDelete', async () => {
    havingJoined()
    renderUpload(
      fakeApi(
        mineWith([
          aVoiceEntry({ id: 'a', canDelete: true }),
          aVoiceEntry({ id: 'b', canDelete: false }),
        ]),
      ),
    )

    await screen.findAllByText(copy.messageLabel('0:23'))
    expect(screen.getAllByRole('button', { name: fr.guestbook.remove })).toHaveLength(1)
  })

  it('says a recording failed, removes the failed line and reopens the recorder on "Réessayer"', async () => {
    havingJoined()
    const failed = aVoiceEntry({
      id: 'failed-1',
      voice: { state: 'failed', durationMs: null, caption: null },
    })
    const api = fakeApi(mineWith([failed]))
    renderUpload(api)
    expect(await screen.findByText(copy.failed)).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: copy.retry }))

    await waitFor(() => expect(api.deleteMyGuestbookEntry).toHaveBeenCalledWith(SLUG, 'failed-1'))
    expect(await screen.findByRole('button', { name: copy.record })).toBeVisible()
  })
})
