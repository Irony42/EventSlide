import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DashboardPage } from './DashboardPage'
import { ApiError } from '../../lib/http'
import { formatBytes } from '../../lib/format'
import { fr } from '../../lib/i18n/fr'
import {
  aClientLimits,
  anAbout,
  fakeApi,
  renderWithProviders,
} from '../../testing/renderWithProviders'
import type { Api } from '../../lib/api/client'
import type { ClientLimitsDto, EventSummaryDto } from '../../lib/api/dto'

/** The harness has no summary factory: `GET /api/events` answers with these. */
const aSummary = (overrides: Partial<EventSummaryDto> = {}): EventSummaryDto => ({
  id: 'event-1',
  slug: 'camille-et-sacha',
  name: 'Camille & Sacha',
  status: 'live',
  photoCount: 42,
  pendingCount: 0,
  guestCount: 18,
  usedBytes: 2_400_000,
  createdAt: '2026-06-20T21:04:11.031Z',
  role: 'owner',
  ...overrides,
})

/** Testing Library folds every kind of space in rendered text down to a plain one. */
const spaced = (value: string) => value.replace(/\s/g, ' ')

/** The last button carrying a label is the one inside the dialog that just opened. */
const inDialog = (name: string): HTMLElement => {
  const buttons = screen.getAllByRole('button', { name })
  const last = buttons[buttons.length - 1]
  if (last === undefined) throw new Error(`no button named ${name}`)
  return last
}

const renderDashboard = (api: Api) =>
  renderWithProviders(<DashboardPage />, { api, route: '/admin' })

describe('DashboardPage', () => {
  it('says it is working while the list loads', () => {
    const api = fakeApi({
      listEvents: vi.fn(() => new Promise<{ items: readonly EventSummaryDto[] }>(() => {})),
    })

    renderDashboard(api)

    expect(screen.getByRole('status')).toHaveTextContent(fr.admin.loading)
  })

  it('gives a new host something to do when they have no events yet', async () => {
    // This is the first screen a new host ever sees, and 1.0 showed them an empty page.
    renderDashboard(fakeApi())

    expect(await screen.findByText(fr.admin.eventsEmpty)).toBeVisible()
    expect(screen.getByText(fr.admin.eventsEmptyHint)).toBeVisible()
    const call = screen.getAllByRole('link', { name: fr.admin.newEvent })
    expect(call[call.length - 1]).toHaveAttribute('href', '/admin/events/new')
  })

  it('names the failure and offers a retry rather than showing an empty list', async () => {
    const listEvents = vi.fn(async () => ({ items: [aSummary()] }))
    listEvents.mockRejectedValueOnce(ApiError.network())
    const api = fakeApi({ listEvents })

    renderDashboard(api)

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors.network)
    expect(screen.queryByText(fr.admin.eventsEmpty)).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: fr.app.retry }))

    expect(await screen.findByRole('link', { name: 'Camille & Sacha' })).toBeVisible()
  })

  it('shows each event with its status, its figures and the storage it uses', async () => {
    const api = fakeApi({
      listEvents: vi.fn(async () => ({
        items: [
          aSummary({ pendingCount: 7 }),
          aSummary({ id: 'event-2', slug: 'gala', name: 'Gala annuel', status: 'draft' }),
        ],
      })),
    })

    renderDashboard(api)

    expect(await screen.findByRole('link', { name: 'Camille & Sacha' })).toHaveAttribute(
      'href',
      '/admin/events/camille-et-sacha',
    )
    expect(screen.getByText(fr.admin.statusLive)).toBeVisible()
    expect(screen.getByText(fr.admin.statusDraft)).toBeVisible()
    expect(screen.getAllByText(fr.admin.photos(42))[0]).toBeVisible()
    expect(screen.getAllByText(fr.admin.guests(18))[0]).toBeVisible()
    expect(screen.getByText(fr.moderation.pending(7))).toBeVisible()
    expect(
      screen.getAllByText(spaced(fr.admin.storage(formatBytes(2_400_000, 'fr'))))[0],
    ).toBeVisible()
  })

  it('offers only the lifecycle actions the event’s status allows', async () => {
    const api = fakeApi({
      listEvents: vi.fn(async () => ({ items: [aSummary({ status: 'draft' })] })),
    })

    renderDashboard(api)

    expect(await screen.findByRole('button', { name: fr.admin.goLive })).toBeVisible()
    expect(screen.getByRole('button', { name: fr.admin.archiveEvent })).toBeVisible()
    // A draft has nothing to close. Its screen can be plugged in already, and says it waits.
    expect(screen.queryByRole('button', { name: fr.admin.closeEvent })).toBeNull()
    expect(screen.getByRole('link', { name: fr.admin.openWall })).toHaveAccessibleDescription(
      new RegExp(fr.admin.wallDraftHint.slice(0, 12)),
    )
  })

  it('does not offer to archive a live event beside the button that ends it', async () => {
    const api = fakeApi({
      listEvents: vi.fn(async () => ({ items: [aSummary({ status: 'live' })] })),
    })

    renderDashboard(api)

    expect(await screen.findByRole('button', { name: fr.admin.closeEvent })).toBeVisible()
    expect(screen.queryByRole('button', { name: fr.admin.archiveEvent })).toBeNull()
  })

  it('puts the ways in before the buttons that change the state', async () => {
    const api = fakeApi({
      listEvents: vi.fn(async () => ({ items: [aSummary({ status: 'live' })] })),
    })

    renderDashboard(api)

    const moderate = await screen.findByRole('link', { name: fr.admin.openModeration })
    const close = screen.getByRole('button', { name: fr.admin.closeEvent })
    // A thumb that aims at "Moderate" must not land on the button that ends the evening.
    expect(moderate.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('offers a moderator no lifecycle button: every one would be answered 403', async () => {
    const api = fakeApi({
      listEvents: vi.fn(async () => ({
        items: [aSummary({ status: 'live', role: 'moderator', pendingCount: 3 })],
      })),
    })

    renderDashboard(api)

    expect(await screen.findByRole('link', { name: 'Camille & Sacha' })).toBeVisible()
    expect(screen.queryByRole('button', { name: fr.admin.closeEvent })).toBeNull()
    expect(screen.queryByRole('button', { name: fr.admin.archiveEvent })).toBeNull()
    expect(screen.queryByRole('button', { name: fr.admin.goLive })).toBeNull()
    // What a moderator is there for stays.
    expect(screen.getByRole('link', { name: fr.admin.openModeration })).toBeVisible()
    expect(screen.getByRole('link', { name: fr.admin.openWall })).toBeVisible()
  })

  it('decides each event by the role the caller holds in it, in one list', async () => {
    const api = fakeApi({
      listEvents: vi.fn(async () => ({
        items: [
          aSummary({ id: 'e1', slug: 'mariage', name: 'Mariage', status: 'draft', role: 'owner' }),
          aSummary({ id: 'e2', slug: 'gala', name: 'Gala', status: 'draft', role: 'moderator' }),
        ],
      })),
    })

    renderDashboard(api)

    await screen.findByRole('link', { name: 'Gala' })
    // One "Passer en direct" for the two events: the owner's.
    expect(screen.getAllByRole('button', { name: fr.admin.goLive })).toHaveLength(1)
  })

  it('opens the wall in a tab of its own, and says so without renaming the link', async () => {
    const api = fakeApi({
      listEvents: vi.fn(async () => ({ items: [aSummary({ status: 'live' })] })),
    })

    renderDashboard(api)

    const wall = await screen.findByRole('link', { name: fr.admin.openWall })
    expect(wall).toHaveAttribute('target', '_blank')
    expect(wall).toHaveAttribute('rel', 'noopener')
    expect(wall).toHaveAccessibleDescription(fr.about.opensInNewTab)
    // The moderation queue stays in the console's own tab.
    expect(screen.getByRole('link', { name: fr.admin.openModeration })).not.toHaveAttribute(
      'target',
    )
  })

  it('opens an event to guests and refreshes the figures from the server', async () => {
    const listEvents = vi
      .fn(async () => ({ items: [aSummary({ status: 'live' })] }))
      .mockResolvedValueOnce({ items: [aSummary({ status: 'draft' })] })
    const api = fakeApi({ listEvents })

    renderDashboard(api)
    await userEvent.click(await screen.findByRole('button', { name: fr.admin.goLive }))
    await userEvent.click(inDialog(fr.admin.goLive))

    expect(api.setEventStatus).toHaveBeenCalledWith('camille-et-sacha', 'live')
    expect(await screen.findByText(fr.admin.noticeOpened)).toBeVisible()
    await waitFor(() => expect(screen.getByText(fr.admin.statusLive)).toBeVisible())
  })

  it('asks before opening to guests, and sends nothing if the host backs out', async () => {
    const api = fakeApi({
      listEvents: vi.fn(async () => ({ items: [aSummary({ status: 'draft' })] })),
    })

    renderDashboard(api)
    await userEvent.click(await screen.findByRole('button', { name: fr.admin.goLive }))

    expect(
      screen.getByRole('dialog', { name: fr.admin.openTitle('Camille & Sacha') }),
    ).toBeVisible()
    expect(screen.getByText(fr.admin.openHint)).toBeVisible()
    expect(api.setEventStatus).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: fr.app.cancel }))

    expect(api.setEventStatus).not.toHaveBeenCalled()
  })

  it('says what archiving stops before it archives, and only archives on the answer', async () => {
    const listEvents = vi
      .fn(async () => ({ items: [aSummary({ status: 'archived' })] }))
      .mockResolvedValueOnce({ items: [aSummary({ status: 'closed' })] })
    const api = fakeApi({ listEvents })

    renderDashboard(api)
    await userEvent.click(await screen.findByRole('button', { name: fr.admin.archiveEvent }))

    const dialog = screen.getByRole('dialog', { name: fr.admin.archiveTitle('Camille & Sacha') })
    expect(dialog).toHaveAccessibleDescription(fr.admin.archiveHint)
    expect(api.setEventStatus).not.toHaveBeenCalled()

    await userEvent.click(inDialog(fr.admin.archiveEvent))

    expect(api.setEventStatus).toHaveBeenCalledWith('camille-et-sacha', 'archived')
    expect(await screen.findByText(fr.admin.noticeArchived)).toBeVisible()
  })

  it('ends the evening on one press and says what that did for the room', async () => {
    const api = fakeApi({
      listEvents: vi.fn(async () => ({ items: [aSummary({ status: 'live' })] })),
    })

    renderDashboard(api)
    await userEvent.click(await screen.findByRole('button', { name: fr.admin.closeEvent }))

    expect(api.setEventStatus).toHaveBeenCalledWith('camille-et-sacha', 'closed')
    expect(await screen.findByText(fr.admin.noticeClosed)).toBeVisible()
  })

  it('reports a refused lifecycle change instead of pretending it worked', async () => {
    const api = fakeApi({
      listEvents: vi.fn(async () => ({ items: [aSummary({ status: 'draft' })] })),
      setEventStatus: vi.fn(() => Promise.reject(new ApiError(409, 'event.illegalTransition'))),
    })

    renderDashboard(api)
    await userEvent.click(await screen.findByRole('button', { name: fr.admin.goLive }))
    await userEvent.click(inDialog(fr.admin.goLive))

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors['event.illegalTransition'])
    expect(screen.getByText(fr.admin.statusDraft)).toBeVisible()
  })

  it('does not offer moderation or a wall for an archived event', async () => {
    const api = fakeApi({
      listEvents: vi.fn(async () => ({
        items: [aSummary({ status: 'archived' })],
      })),
    })

    renderDashboard(api)

    expect(await screen.findByText(fr.admin.statusArchived)).toBeVisible()
    expect(screen.queryByRole('link', { name: fr.admin.openModeration })).toBeNull()
    expect(screen.queryByRole('link', { name: fr.admin.openWall })).toBeNull()
    expect(screen.queryByRole('button', { name: fr.admin.archiveEvent })).toBeNull()
  })

  it('keeps the summary’s storage figure without drawing a bar it cannot fill', async () => {
    // `GET /api/events` carries no quota, and a bar against an invented ceiling is a
    // number a host would make decisions on. The event page has the real quota.
    const api = fakeApi({ listEvents: vi.fn(async () => ({ items: [aSummary()] })) })

    renderDashboard(api)

    expect(
      await screen.findByText(spaced(fr.admin.storage(formatBytes(2_400_000, 'fr')))),
    ).toBeVisible()
    expect(screen.queryByRole('progressbar')).toBeNull()
  })
})

/**
 * The empty dashboard (G2-16 / P3-17): what a first event takes, in the order it is done. It is
 * generic on purpose and shown to every host, a self-hoster included: nothing in it depends on
 * `SITE_ADMIN`.
 */
describe('DashboardPage: the first event', () => {
  it('lists the five steps of a first event: print, plug the screen in, open, then test from another phone', async () => {
    renderDashboard(fakeApi())

    expect(await screen.findByText(fr.admin.eventsEmpty)).toBeVisible()
    const steps = screen.getAllByRole('listitem').map((item) => item.textContent)
    expect(steps).toEqual([
      fr.admin.emptyStepCreate,
      fr.admin.emptyStepPrint,
      fr.admin.emptyStepScreen,
      fr.admin.emptyStepOpen,
      fr.admin.emptyStepTest,
    ])
  })

  it('does not show the steps once there is an event', async () => {
    renderDashboard(fakeApi({ listEvents: vi.fn(async () => ({ items: [aSummary()] })) }))

    expect(await screen.findByRole('link', { name: 'Camille & Sacha' })).toBeVisible()
    expect(screen.queryByText(fr.admin.emptyStepTest)).toBeNull()
  })
})

/**
 * The client's own space on the dashboard (G2-16 / P3-17): the banner, the suspension screen,
 * and — with `SITE_ADMIN=off` — nothing at all, not even a request.
 */
describe('DashboardPage: a client’s limits', () => {
  const onBox = (limits: readonly ClientLimitsDto[], extra: Partial<Api> = {}) =>
    fakeApi({
      about: vi.fn(async () =>
        anAbout({
          features: { siteAdmin: true, forgotPassword: false },
          operator: { name: 'Pierre', contactEmail: 'ops@example.org' },
        }),
      ),
      myLimits: vi.fn(async () => ({ clients: limits })),
      ...extra,
    })

  it('asks nothing of a box with no client space, and shows nothing of one', async () => {
    const api = fakeApi()

    renderDashboard(api)

    expect(await screen.findByText(fr.admin.eventsEmpty)).toBeVisible()
    expect(api.myLimits).not.toHaveBeenCalled()
    expect(screen.queryByRole('region', { name: fr.clientSpace.bannerLabel })).toBeNull()
    expect(screen.queryByRole('link', { name: fr.clientSpace.spaceLink })).toBeNull()
  })

  it('warns a client that is close to a ceiling, and leads to its space and to its operator', async () => {
    const limits = aClientLimits({
      meters: [{ kind: 'events', used: 9, max: 10, level: 'warning' }],
    })

    renderDashboard(onBox([limits]))

    const banner = await screen.findByRole('region', { name: fr.clientSpace.bannerLabel })
    expect(banner).toHaveTextContent(fr.clientSpace.eventsMeter(9, 10))
    expect(screen.getByRole('link', { name: fr.clientSpace.contactAction })).toHaveAttribute(
      'href',
      'mailto:ops@example.org',
    )
    expect(screen.getByRole('link', { name: fr.clientSpace.spaceLink })).toHaveAttribute(
      'href',
      '/admin/client',
    )
  })

  it('does not lead an account with no client to a client space it does not have', async () => {
    // `SITE_ADMIN=on`, an account that belongs to no client: the link would open a space that
    // has nothing to say to it.
    renderDashboard(onBox([]))

    expect(await screen.findByText(fr.admin.eventsEmpty)).toBeVisible()
    expect(screen.queryByRole('link', { name: fr.clientSpace.spaceLink })).toBeNull()
    expect(screen.queryByText(fr.clientSpace.noLimits)).toBeNull()
  })

  it('shows nothing of a client under its lines, but still leads to its space', async () => {
    renderDashboard(onBox([aClientLimits()]))

    expect(await screen.findByRole('link', { name: fr.clientSpace.spaceLink })).toBeVisible()
    expect(screen.queryByRole('region', { name: fr.clientSpace.bannerLabel })).toBeNull()
  })

  it('tells a suspended client so, and no longer offers a new event, while the list stays readable', async () => {
    const api = onBox([aClientLimits({ suspended: true })], {
      listEvents: vi.fn(async () => ({ items: [aSummary()] })),
    })

    renderDashboard(api)

    const title = await screen.findByText(fr.clientSpace.suspendedTitle)
    expect(title.closest('[role="status"]')).toHaveTextContent(fr.clientSpace.suspendedBody)
    expect(screen.queryByRole('link', { name: fr.admin.newEvent })).toBeNull()
    expect(await screen.findByRole('link', { name: 'Camille & Sacha' })).toBeVisible()
  })

  it('goes on with the dashboard when the limits cannot be read', async () => {
    const api = onBox([], { myLimits: vi.fn(async () => Promise.reject(ApiError.network())) })

    renderDashboard(api)

    expect(await screen.findByText(fr.admin.eventsEmpty)).toBeVisible()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
