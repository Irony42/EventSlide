import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ModerationPage } from './ModerationPage'
import { SIGNAL_DEBOUNCE_MS } from './hooks/useGuestbookModeration'
import {
  aModerationPhoto,
  anEventDto,
  eventSettings,
  fakeApi,
  renderWithProviders,
} from '../../testing/renderWithProviders'
import { fr } from '../../lib/i18n/fr'
import type { Api } from '../../lib/api/client'
import type { EventDto, GuestbookQueueItemDto } from '../../lib/api/dto'

/** The messages tab of the console (spec 15), from the host's side of the laptop. */
class FakeEventSource extends EventTarget {
  static instances: FakeEventSource[] = []

  readyState = 0

  constructor(readonly url: string) {
    super()
    FakeEventSource.instances.push(this)
  }

  close(): void {
    this.readyState = 2
  }
}

const emitSignal = (type: string): void => {
  const instance = FakeEventSource.instances[FakeEventSource.instances.length - 1]
  if (instance === undefined) throw new Error('the console opened no stream')
  act(() => {
    instance.dispatchEvent(new MessageEvent('change', { data: JSON.stringify({ type }) }))
  })
}

const SLUG = 'camille-et-sacha'
const CREATED = '2026-11-04T20:00:00.000Z'

const aMessage = (overrides: Partial<GuestbookQueueItemDto> = {}): GuestbookQueueItemDto => ({
  id: 'm1',
  text: 'Bravo les mariés',
  authorName: 'Léa',
  status: 'pending',
  createdAt: CREATED,
  allowedDecisions: ['publish', 'reject'],
  ...overrides,
})

const eventWith = (
  settings: Parameters<typeof eventSettings>[0] = {},
  overrides: Partial<EventDto> = {},
): EventDto => anEventDto({ settings: eventSettings(settings), ...overrides })

const apiWith = (
  items: readonly GuestbookQueueItemDto[],
  event: EventDto = eventWith(),
  overrides: Partial<Api> = {},
): Api =>
  fakeApi({
    getEvent: vi.fn(async () => event),
    guestbookQueue: vi.fn(async (_slug, _signal, query) => ({
      items: query?.status === 'pending' ? items.filter((m) => m.status === 'pending') : items,
      pendingCount: items.filter((m) => m.status === 'pending').length,
    })),
    ...overrides,
  })

const renderConsole = (api: Api, search = '') =>
  renderWithProviders(<ModerationPage />, {
    api,
    route: `/admin/events/${SLUG}/moderation${search}`,
    path: '/admin/events/:slug/moderation',
  })

const openMessages = async (): Promise<void> => {
  await userEvent.click(await screen.findByRole('tab', { name: /^Messages/ }))
}

describe('ModerationPage, messages tab', () => {
  beforeEach(() => {
    FakeEventSource.instances = []
    vi.stubGlobal('EventSource', FakeEventSource)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('offers no messages tab and reads no guestbook when the event has none', async () => {
    const api = apiWith([], eventWith({ allowGuestbook: false }))
    renderConsole(api)

    await waitFor(() => expect(api.getEvent).toHaveBeenCalled())
    await screen.findByText(fr.moderation.empty)
    expect(screen.queryByRole('tab')).toBeNull()
    expect(api.guestbookQueue).not.toHaveBeenCalled()
  })

  it('opens one stream for the whole console, photos and messages', async () => {
    renderConsole(apiWith([aMessage()]))

    await screen.findByRole('tab', { name: /^Messages/ })
    expect(FakeEventSource.instances).toHaveLength(1)
  })

  it('shows the pending count on the messages tab while photos are shown, and says it', async () => {
    renderConsole(apiWith([aMessage(), aMessage({ id: 'm2' })]))

    const tab = await screen.findByRole('tab', { name: fr.moderation.tabCounted('Messages', 2) })
    expect(tab).toHaveAttribute('aria-selected', 'false')
    expect(await screen.findByText(fr.moderation.messagesPendingAnnounce(2))).toBeInTheDocument()
  })

  it('opens on the messages from the ?vue=messages link', async () => {
    renderConsole(apiWith([aMessage()]), '?vue=messages')

    expect(await screen.findByText('Bravo les mariés')).toBeInTheDocument()
  })

  it('reads a message in full as text: 500 characters, line breaks, no HTML, not translated', async () => {
    const long =
      Array.from({ length: 9 }, () => 'x'.repeat(50)).join('\n') + '<img src=x onerror=alert(1)>'
    renderConsole(apiWith([aMessage({ text: long })]))
    await openMessages()

    const text = await screen.findByText(
      (_, node) => node?.textContent === long && node.tagName === 'P',
    )
    expect(text).toHaveAttribute('translate', 'no')
    expect(text.querySelector('img')).toBeNull()
  })

  it('offers the decisions the server allows and nothing else', async () => {
    renderConsole(
      apiWith([aMessage({ status: 'rejected', allowedDecisions: ['publish'] })], eventWith(), {}),
      '?vue=messages',
    )
    await screen.findByText(fr.moderation.messagesEmpty)
    const filters = screen.getByRole('tabpanel')
    await userEvent.click(within(filters).getByRole('button', { name: fr.moderation.filterAll }))

    const card = (await screen.findByText('Bravo les mariés')).closest('li') as HTMLElement
    expect(within(card).getAllByRole('button', { name: /Publier/ })).toHaveLength(1)
    expect(within(card).queryByRole('button', { name: /Refuser/ })).toBeNull()
  })

  it('publishes the focused message with P and moves the focus on', async () => {
    const api = apiWith([aMessage(), aMessage({ id: 'm2', text: 'Merci !' })])
    renderConsole(api, '?vue=messages')
    await screen.findByText('Bravo les mariés')

    await userEvent.keyboard('j')
    await userEvent.keyboard('p')

    expect(api.decideGuestbookEntry).toHaveBeenCalledWith(SLUG, 'm1', 'publish')
    expect(await screen.findByText(fr.moderation.messagePublished('Léa'))).toBeInTheDocument()
  })

  it('undoes the last decision of the messages tab with Z', async () => {
    const api = apiWith([aMessage()])
    renderConsole(api, '?vue=messages')
    await screen.findByText('Bravo les mariés')

    await userEvent.keyboard('jp')
    await waitFor(() => expect(api.decideGuestbookEntry).toHaveBeenCalledTimes(1))
    await userEvent.keyboard('z')

    await waitFor(() =>
      expect(api.decideGuestbookEntry).toHaveBeenLastCalledWith(SLUG, 'm1', 'hide'),
    )
  })

  it('does not decide photos ticked on the other tab when P is pressed on messages', async () => {
    const photo = aModerationPhoto({ id: 'photo-1', authorName: 'Sacha' })
    const api = apiWith([aMessage()], eventWith(), {
      moderationQueue: vi.fn(async () => ({ items: [photo], pendingCount: 1, nextCursor: null })),
    })
    renderConsole(api)
    await userEvent.click(await screen.findByRole('checkbox'))

    await openMessages()
    await userEvent.keyboard('jp')

    expect(api.moderate).not.toHaveBeenCalled()
    expect(api.moderateBulk).not.toHaveBeenCalled()
    expect(api.decideGuestbookEntry).toHaveBeenCalledWith(SLUG, 'm1', 'publish')
    // And the selection did not survive the change of tab, in either direction.
    await userEvent.click(screen.getByRole('tab', { name: /^Photos/ }))
    expect(screen.getByRole('checkbox')).not.toBeChecked()
  })

  it('ignores F on messages and leaves Space to the browser', async () => {
    const api = apiWith([aMessage()])
    renderConsole(api, '?vue=messages')
    await screen.findByText('Bravo les mariés')
    await userEvent.keyboard('j')

    await userEvent.keyboard('f')
    expect(api.highlightPhoto).not.toHaveBeenCalled()
    // `fireEvent` returns false when the handler called `preventDefault`.
    expect(fireEvent.keyDown(window, { key: ' ' })).toBe(true)
  })

  it('takes Space on the photo tab, where it selects', async () => {
    renderConsole(apiWith([aMessage()]))
    await screen.findByRole('tab', { name: /^Messages/ })

    expect(fireEvent.keyDown(window, { key: ' ' })).toBe(false)
  })

  it('reads the book again on guestbook.changed, and not on a photo signal', async () => {
    const api = apiWith([aMessage()])
    renderConsole(api, '?vue=messages')
    await screen.findByText('Bravo les mariés')
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const reads = (api.guestbookQueue as ReturnType<typeof vi.fn>).mock.calls.length

    emitSignal('photo.moderated')
    await act(() => vi.advanceTimersByTimeAsync(SIGNAL_DEBOUNCE_MS * 2))
    expect(api.guestbookQueue).toHaveBeenCalledTimes(reads)

    emitSignal('guestbook.changed')
    await act(() => vi.advanceTimersByTimeAsync(SIGNAL_DEBOUNCE_MS))
    expect(api.guestbookQueue).toHaveBeenCalledTimes(reads + 1)
  })

  it('is read-only when the event is archived: no decision button, keys do nothing', async () => {
    const api = apiWith([aMessage()], eventWith({}, { status: 'archived' }))
    renderConsole(api, '?vue=messages')
    await screen.findByText('Bravo les mariés')

    expect(screen.queryByRole('button', { name: /Publier/ })).toBeNull()
    await userEvent.keyboard('jp')
    expect(api.decideGuestbookEntry).not.toHaveBeenCalled()
  })

  it('in automatic moderation counts what went up since the last visit, and opens on the wall', async () => {
    const onWall = aMessage({
      status: 'published',
      allowedDecisions: ['hide', 'reject'],
      createdAt: '2999-01-01T00:00:00.000Z',
    })
    const old = aMessage({ id: 'm0', status: 'published', createdAt: '2020-01-01T00:00:00.000Z' })
    const api = apiWith([onWall, old], eventWith({ moderation: 'auto' }))
    renderConsole(api)

    const tab = await screen.findByRole('tab', { name: fr.moderation.tabFresh('Messages', 1) })
    await userEvent.click(tab)

    expect(
      await screen.findByRole('button', { name: fr.moderation.filterPublished }),
    ).toHaveAttribute('aria-pressed', 'true')
  })
})
