import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DashboardPage } from './DashboardPage'
import { ApiError } from '../../lib/http'
import { formatBytes } from '../../lib/format'
import { fr } from '../../lib/i18n/fr'
import { fakeApi, renderWithProviders } from '../../testing/renderWithProviders'
import type { Api } from '../../lib/api/client'
import type { EventSummaryDto } from '../../lib/api/dto'

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
  ...overrides,
})

/** Testing Library folds every kind of space in rendered text down to a plain one. */
const spaced = (value: string) => value.replace(/\s/g, ' ')

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
    expect(screen.getAllByText(spaced(fr.admin.storage(formatBytes(2_400_000))))[0]).toBeVisible()
  })

  it('offers only the lifecycle actions the event’s status allows', async () => {
    const api = fakeApi({
      listEvents: vi.fn(async () => ({ items: [aSummary({ status: 'draft' })] })),
    })

    renderDashboard(api)

    expect(await screen.findByRole('button', { name: fr.admin.goLive })).toBeVisible()
    expect(screen.getByRole('button', { name: fr.admin.archiveEvent })).toBeVisible()
    // A draft has nothing to close and nothing to show on the projector yet.
    expect(screen.queryByRole('button', { name: fr.admin.closeEvent })).toBeNull()
    expect(screen.queryByRole('link', { name: fr.admin.openWall })).toBeNull()
  })

  it('opens an event to guests and refreshes the figures from the server', async () => {
    const listEvents = vi
      .fn(async () => ({ items: [aSummary({ status: 'live' })] }))
      .mockResolvedValueOnce({ items: [aSummary({ status: 'draft' })] })
    const api = fakeApi({ listEvents })

    renderDashboard(api)
    await userEvent.click(await screen.findByRole('button', { name: fr.admin.goLive }))

    expect(api.setEventStatus).toHaveBeenCalledWith('camille-et-sacha', 'live')
    expect(await screen.findByText(fr.admin.statusSaved)).toBeVisible()
    await waitFor(() => expect(screen.getByText(fr.admin.statusLive)).toBeVisible())
  })

  it('reports a refused lifecycle change instead of pretending it worked', async () => {
    const api = fakeApi({
      listEvents: vi.fn(async () => ({ items: [aSummary({ status: 'draft' })] })),
      setEventStatus: vi.fn(() => Promise.reject(new ApiError(409, 'event.illegalTransition'))),
    })

    renderDashboard(api)
    await userEvent.click(await screen.findByRole('button', { name: fr.admin.goLive }))

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

    expect(await screen.findByText(spaced(fr.admin.storage(formatBytes(2_400_000))))).toBeVisible()
    expect(screen.queryByRole('progressbar')).toBeNull()
  })
})
