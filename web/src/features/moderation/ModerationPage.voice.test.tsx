import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ModerationPage } from './ModerationPage'
import { MobileModerationPage } from './MobileModerationPage'
import { SIGNAL_DEBOUNCE_MS } from './hooks/useGuestbookModeration'
import {
  anEventDto,
  eventSettings,
  fakeApi,
  renderWithProviders,
} from '../../testing/renderWithProviders'
import { fr } from '../../lib/i18n/fr'
import { FakeEventSource } from '../../testing/fakeEventSource'
import type { Api } from '../../lib/api/client'
import type { GuestbookQueueDto, GuestbookQueueItemDto } from '../../lib/api/dto'

/** The voice cards of the console's messages tab (spec 25), from the host's side. */
const SLUG = 'camille-et-sacha'

const aVoice = (overrides: Partial<GuestbookQueueItemDto> = {}): GuestbookQueueItemDto => ({
  id: 'v1',
  text: null,
  authorName: 'Camille',
  status: 'pending',
  createdAt: '2026-11-04T20:00:00.000Z',
  allowedDecisions: ['publish', 'reject'],
  voice: { state: 'ready', durationMs: 23_000, bytes: 187_000, caption: null },
  ...overrides,
})

const apiWith = (
  items: readonly GuestbookQueueItemDto[],
  book: Partial<Omit<GuestbookQueueDto, 'items'>> = {},
  overrides: Partial<Api> = {},
): Api =>
  fakeApi({
    getEvent: vi.fn(async () => anEventDto({ settings: eventSettings() })),
    guestbookQueue: vi.fn(async () => ({
      items,
      pendingCount: items.filter((m) => m.status === 'pending').length,
      voiceProcessing: 0,
      voiceSealed: false,
      voiceOpensAtMs: null,
      serverNowMs: 0,
      ...book,
    })),
    ...overrides,
  })

const renderConsole = (api: Api) =>
  renderWithProviders(<ModerationPage onSwitchView={vi.fn()} />, {
    api,
    route: `/admin/events/${SLUG}/moderation?vue=messages`,
    path: '/admin/events/:slug/moderation',
  })

const cardLabel = (author: string) => fr.guestbookVoiceHost.cardLabel(author, '0:23')

describe('ModerationPage, voice cards', () => {
  beforeEach(() => {
    FakeEventSource.reset()
    vi.stubGlobal('EventSource', FakeEventSource)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('gives a ready voice a native player named after its author and length, that never autoplays', async () => {
    renderConsole(apiWith([aVoice()]))

    const player = await screen.findByLabelText(cardLabel('Camille'))
    expect(player.tagName).toBe('AUDIO')
    expect(player).toHaveAttribute('controls')
    expect((player as HTMLAudioElement).autoplay).toBe(false)
    expect(player).toHaveAttribute('preload', 'none')
    expect(player).toHaveAttribute('src', `/api/events/${SLUG}/guestbook/v1/voice`)
    expect(screen.getByText(fr.guestbookVoiceHost.duration('0:23'))).toBeVisible()
  })

  it('shows the caption as untranslated text', async () => {
    renderConsole(
      apiWith([
        aVoice({
          voice: { state: 'ready', durationMs: 5_000, bytes: 1, caption: 'Bravo <b>!</b>' },
        }),
      ]),
    )

    const caption = await screen.findByText('Bravo <b>!</b>')
    expect(caption).toHaveAttribute('translate', 'no')
    expect(caption.querySelector('b')).toBeNull()
  })

  it('says a kept-secret voice in words, with no player and the unheard line', async () => {
    renderConsole(apiWith([aVoice()], { voiceSealed: true }))

    expect(await screen.findByText(fr.guestbookVoiceHost.sealedCard)).toBeVisible()
    expect(screen.getByText(fr.guestbookVoiceHost.notListened)).toBeVisible()
    expect(document.querySelector('audio')).toBeNull()
    // The decisions stay: refusing a message without hearing it is a right.
    expect(screen.getByRole('button', { name: /Publier/ })).toBeVisible()
  })

  it('never offers "Masquer" on a voice, and H says why instead of hiding it', async () => {
    const api = apiWith([aVoice()])
    renderConsole(api)
    await screen.findByLabelText(cardLabel('Camille'))

    expect(screen.queryByRole('button', { name: /Masquer/ })).toBeNull()
    await userEvent.keyboard('jh')

    expect(await screen.findByText(fr.guestbookVoiceHost.cannotHide)).toBeVisible()
    expect(api.decideGuestbookEntry).not.toHaveBeenCalled()
  })

  it('offers no decision on a voice that is not ready, and no player', async () => {
    renderConsole(
      apiWith([
        aVoice({
          allowedDecisions: [],
          voice: { state: 'running', durationMs: null, bytes: null, caption: null },
        }),
      ]),
    )

    expect(await screen.findByText(fr.guestbookVoiceHost.processing)).toBeVisible()
    expect(document.querySelector('audio')).toBeNull()
    expect(screen.queryByRole('button', { name: /Publier|Refuser/ })).toBeNull()
  })

  it('counts the recordings still being processed', async () => {
    renderConsole(apiWith([], { voiceProcessing: 2 }))

    expect(await screen.findByText(fr.guestbookVoiceHost.processingCount(2))).toBeVisible()
  })

  it('moves the focus to the next message after a button decision, without playing it', async () => {
    const api = apiWith([aVoice(), aVoice({ id: 'v2', authorName: 'Sacha' })])
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    renderConsole(api)
    const first = await screen.findByLabelText(cardLabel('Camille'))
    const card = first.closest('li') as HTMLElement

    await userEvent.click(within(card).getByRole('button', { name: /Publier/ }))

    await waitFor(() =>
      expect(api.decideGuestbookEntry).toHaveBeenCalledWith(SLUG, 'v1', 'publish'),
    )
    const next = screen.getByLabelText(cardLabel('Sacha')).closest('li') as HTMLElement
    await waitFor(() => expect(next).toHaveFocus())
    expect(play).not.toHaveBeenCalled()
    play.mockRestore()
  })

  it('re-reads on the voice signal', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const api = apiWith([])
    renderConsole(api)
    await waitFor(() => expect(api.guestbookQueue).toHaveBeenCalled())
    const before = vi.mocked(api.guestbookQueue).mock.calls.length

    act(() => {
      FakeEventSource.latest('the console').emitSignal('guestbook.voice')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SIGNAL_DEBOUNCE_MS + 50)
    })

    expect(vi.mocked(api.guestbookQueue).mock.calls.length).toBeGreaterThan(before)
  })

  describe('"Garder les N messages en attente"', () => {
    it('asks first, then keeps and says how many', async () => {
      const api = apiWith(
        [aVoice(), aVoice({ id: 'v2' })],
        {},
        { keepPendingVoices: vi.fn(async () => ({ kept: 2 })) },
      )
      renderConsole(api)

      await userEvent.click(
        await screen.findByRole('button', { name: fr.guestbookVoiceHost.keepPending(2) }),
      )
      expect(api.keepPendingVoices).not.toHaveBeenCalled()
      expect(screen.getByText(fr.guestbookVoiceHost.keepConfirm)).toBeVisible()

      await userEvent.click(
        screen.getByRole('button', { name: fr.guestbookVoiceHost.keepConfirmLabel }),
      )

      await waitFor(() => expect(api.keepPendingVoices).toHaveBeenCalledWith(SLUG))
      expect(await screen.findByText(fr.guestbookVoiceHost.kept(2))).toBeVisible()
    })

    it('keeps the count it asked about when a re-read changes the list behind the dialog', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      const items = [aVoice(), aVoice({ id: 'v2' })]
      const api = apiWith(items)
      renderConsole(api)
      await userEvent.click(
        await screen.findByRole('button', { name: fr.guestbookVoiceHost.keepPending(2) }),
      )
      vi.mocked(api.guestbookQueue).mockResolvedValue({
        items: [],
        pendingCount: 0,
        voiceProcessing: 0,
        voiceSealed: false,
        voiceOpensAtMs: null,
        serverNowMs: 0,
      })

      act(() => {
        FakeEventSource.latest('the console').emitSignal('guestbook.voice')
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(SIGNAL_DEBOUNCE_MS + 50)
      })

      expect(screen.getByText(fr.guestbookVoiceHost.keepConfirm)).toBeVisible()
      expect(screen.getAllByText(fr.guestbookVoiceHost.keepPending(2)).length).toBeGreaterThan(0)
      expect(screen.queryByText(fr.guestbookVoiceHost.keepPending(0))).toBeNull()
    })

    it('keeps nothing when the host cancels', async () => {
      const api = apiWith([aVoice()])
      renderConsole(api)

      await userEvent.click(
        await screen.findByRole('button', { name: fr.guestbookVoiceHost.keepPending(1) }),
      )
      await userEvent.click(screen.getByRole('button', { name: fr.app.cancel }))

      expect(api.keepPendingVoices).not.toHaveBeenCalled()
    })

    it('counts only the ready, pending voices: a written message or a processing voice is not kept', async () => {
      renderConsole(
        apiWith([
          aVoice(),
          aVoice({ id: 'w1', text: 'Bravo', voice: null }),
          aVoice({
            id: 'v3',
            allowedDecisions: [],
            voice: { state: 'queued', durationMs: null, bytes: null, caption: null },
          }),
        ]),
      )

      expect(
        await screen.findByRole('button', { name: fr.guestbookVoiceHost.keepPending(1) }),
      ).toBeVisible()
    })

    it('is not offered when no voice waits', async () => {
      renderConsole(apiWith([aVoice({ status: 'published', allowedDecisions: ['reject'] })]))
      await userEvent.click(
        within(await screen.findByRole('tabpanel')).getByRole('button', {
          name: fr.moderation.filterPublished,
        }),
      )

      await screen.findByLabelText(cardLabel('Camille'))
      expect(screen.queryByRole('button', { name: /Garder/ })).toBeNull()
    })
  })
})

describe('MobileModerationPage, a voice message', () => {
  beforeEach(() => {
    FakeEventSource.reset()
    vi.stubGlobal('EventSource', FakeEventSource)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the player on the swipe card and keeps a voice off the wall strip', async () => {
    renderWithProviders(<MobileModerationPage onSwitchView={vi.fn()} />, {
      api: apiWith([aVoice(), aVoice({ id: 'v9', status: 'published', authorName: 'Léa' })]),
      route: `/admin/events/${SLUG}/moderation/mobile?vue=messages`,
      path: '/admin/events/:slug/moderation/mobile',
    })

    expect(await screen.findByLabelText(cardLabel('Camille'))).toBeVisible()
    // The published voice is not a message on the wall: the strip has nothing to take down.
    expect(await screen.findByText(fr.moderation.onScreenMessagesEmpty)).toBeVisible()
    expect(screen.queryByRole('button', { name: fr.moderation.readMessageOf('Léa') })).toBeNull()
  })
})
