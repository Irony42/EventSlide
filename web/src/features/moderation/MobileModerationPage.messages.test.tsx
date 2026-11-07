import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MobileModerationPage } from './MobileModerationPage'
import {
  anEventDto,
  eventSettings,
  fakeApi,
  renderWithProviders,
} from '../../testing/renderWithProviders'
import { fr } from '../../lib/i18n/fr'
import type { Api } from '../../lib/api/client'
import type { GuestbookQueueItemDto, ModerationDecision } from '../../lib/api/dto'
import { FakeEventSource } from '../../testing/fakeEventSource'

/** The messages tab of the phone console (spec 15). */
const SLUG = 'camille-et-sacha'
/** jsdom measures the card at zero, so the commit distance is its 56 px floor. */
const FAR = 120

const aMessage = (overrides: Partial<GuestbookQueueItemDto> = {}): GuestbookQueueItemDto => ({
  id: 'm1',
  text: 'Bravo les mariés',
  authorName: 'Léa',
  status: 'pending',
  createdAt: '2026-11-04T20:00:00.000Z',
  allowedDecisions: ['publish', 'reject'],
  ...overrides,
})

const TARGET = { publish: 'published', reject: 'rejected', hide: 'hidden' } as const

/** A server that remembers: a decided message stays decided on the next reading. */
const apiWith = (
  items: readonly GuestbookQueueItemDto[],
  settings: Parameters<typeof eventSettings>[0] = {},
): Api => {
  let book = [...items]
  return fakeApi({
    getEvent: vi.fn(async () => anEventDto({ settings: eventSettings(settings) })),
    guestbookQueue: vi.fn(async (_slug, _signal, query) => ({
      items: query?.status === undefined ? book : book.filter((m) => m.status === query.status),
      pendingCount: book.filter((m) => m.status === 'pending').length,
    })),
    decideGuestbookEntry: vi.fn(async (_slug: string, id: string, decision: ModerationDecision) => {
      book = book.map((m) =>
        m.id === id ? { ...m, status: TARGET[decision], allowedDecisions: [] } : m,
      )
    }),
  })
}

const renderPhone = (api: Api) =>
  renderWithProviders(<MobileModerationPage />, {
    api,
    route: `/admin/events/${SLUG}/moderation/mobile?vue=messages`,
    path: '/admin/events/:slug/moderation/mobile',
  })

const card = (): HTMLElement => screen.getByTestId('mobile-moderation-card')

const drag = (dx: number, dy: number): void => {
  const target = card()
  fireEvent.pointerDown(target, {
    pointerId: 1,
    button: 0,
    isPrimary: true,
    clientX: 0,
    clientY: 0,
  })
  fireEvent.pointerMove(target, { pointerId: 1, clientX: dx / 2, clientY: dy / 2 })
  fireEvent.pointerMove(target, { pointerId: 1, clientX: dx, clientY: dy })
  fireEvent.pointerUp(target, { pointerId: 1, clientX: dx, clientY: dy })
}

describe('MobileModerationPage, messages tab', () => {
  beforeEach(() => {
    FakeEventSource.reset()
    vi.stubGlobal('EventSource', FakeEventSource)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('offers no messages tab when the event has no guestbook', async () => {
    const api = apiWith([aMessage()], { allowGuestbook: false })
    renderPhone(api)

    await screen.findByRole('heading', { name: fr.moderation.empty })
    expect(screen.queryByRole('tab')).toBeNull()
    expect(api.guestbookQueue).not.toHaveBeenCalled()
  })

  it('opens one stream for photos and messages together', async () => {
    renderPhone(apiWith([aMessage()]))

    await screen.findByTestId('mobile-moderation-card')
    expect(FakeEventSource.instances).toHaveLength(1)
  })

  it('shows the message in the card and publishes it from the real button', async () => {
    const api = apiWith([aMessage()])
    renderPhone(api)
    await screen.findByTestId('mobile-moderation-card')

    expect(within(card()).getByText('Bravo les mariés')).toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', { name: fr.moderation.publishMessageOf('Léa') }),
    )

    expect(api.decideGuestbookEntry).toHaveBeenCalledWith(SLUG, 'm1', 'publish')
  })

  it('publishes a message swiped to the right and refuses one swiped to the left', async () => {
    const api = apiWith([aMessage(), aMessage({ id: 'm2', text: 'Merci' })])
    renderPhone(api)
    await screen.findByTestId('mobile-moderation-card')

    drag(FAR, 0)
    await waitFor(() =>
      expect(api.decideGuestbookEntry).toHaveBeenCalledWith(SLUG, 'm1', 'publish'),
    )
    await screen.findByText('Merci')
    drag(-FAR, 0)
    await waitFor(() => expect(api.decideGuestbookEntry).toHaveBeenCalledWith(SLUG, 'm2', 'reject'))
  })

  it('decides nothing when a long text is scrolled vertically', async () => {
    const api = apiWith([aMessage({ text: 'long '.repeat(100) })])
    renderPhone(api)
    await screen.findByTestId('mobile-moderation-card')

    drag(4, 160)

    expect(api.decideGuestbookEntry).not.toHaveBeenCalled()
  })

  it('undoes the last message decision with the undo button, as a hide', async () => {
    const api = apiWith([aMessage()])
    renderPhone(api)
    await screen.findByTestId('mobile-moderation-card')

    await userEvent.click(
      screen.getByRole('button', { name: fr.moderation.publishMessageOf('Léa') }),
    )
    const undo = screen.getByRole('button', { name: fr.mobileModeration.undoLast })
    await waitFor(() => expect(undo).toBeEnabled())
    await userEvent.click(undo)

    await waitFor(() =>
      expect(api.decideGuestbookEntry).toHaveBeenLastCalledWith(SLUG, 'm1', 'hide'),
    )
  })

  it('takes a message published automatically off the wall from the latest-messages strip', async () => {
    const onWall = aMessage({
      id: 'm9',
      text: 'Un mot déjà à l’écran',
      status: 'published',
      allowedDecisions: ['hide', 'reject'],
    })
    const api = apiWith([onWall], { moderation: 'auto' })
    renderPhone(api)

    await userEvent.click(
      await screen.findByRole('button', { name: fr.moderation.readMessageOf('Léa') }),
    )
    await userEvent.click(
      await screen.findByRole('button', { name: fr.moderation.hidePhoto('Léa') }),
    )

    expect(api.decideGuestbookEntry).toHaveBeenCalledWith(SLUG, 'm9', 'hide')
  })
})
