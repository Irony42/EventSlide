import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventStatsPage } from './EventStatsPage'
import { SIGNAL_DEBOUNCE_MS, SLOW_REFRESH_MS } from './hooks/useEventStats'
import type { Api } from '../../lib/api/client'
import type { EventStatsResponse } from '../../lib/api/dto'
import { ApiError } from '../../lib/http'
import { fr } from '../../lib/i18n/fr'
import { anEventStats, fakeApi, renderWithProviders } from '../../testing/renderWithProviders'

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
  if (instance === undefined) throw new Error('the page opened no stream')
  act(() => {
    instance.dispatchEvent(new MessageEvent('change', { data: JSON.stringify({ type }) }))
  })
}

const SLUG = 'camille-et-sacha'

const renderPage = (api: Api) =>
  renderWithProviders(<EventStatsPage />, {
    api,
    route: `/admin/events/${SLUG}/stats`,
    path: '/admin/events/:slug/stats',
  })

const busy = (overrides: Partial<EventStatsResponse> = {}): EventStatsResponse =>
  anEventStats({
    uploads: {
      total: 4,
      byQuarter: [
        { start: '2026-06-20T19:00:00.000Z', count: 1 },
        { start: '2026-06-20T19:45:00.000Z', count: 3 },
      ],
    },
    photos: { pending: 1, published: 2, rejected: 1, hidden: 0 },
    guests: { joined: 3, contributors: 2, revoked: 1, activeNow: 2 },
    reactions: { total: 5, byKind: { love: 3, laugh: 2, wow: 0, cheers: 0, clap: 0 } },
    topContributors: [{ displayName: 'Léa', photos: 2, reactions: 5 }],
    ...overrides,
  })

describe('EventStatsPage', () => {
  beforeEach(() => {
    FakeEventSource.instances = []
    vi.stubGlobal('EventSource', FakeEventSource)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('says it is working while the figures load', () => {
    renderPage(fakeApi({ getEventStats: vi.fn(() => new Promise<EventStatsResponse>(() => {})) }))

    expect(screen.getByRole('status')).toHaveTextContent(fr.admin.stats.loading)
  })

  it('shows the figures, the first names and the table a screen reader reads', async () => {
    renderPage(fakeApi({ getEventStats: vi.fn(async () => busy()) }))

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(fr.admin.stats.title)
    expect(screen.getByText(fr.admin.stats.figureUploads(4))).toBeVisible()
    expect(screen.getByText('Léa')).toBeVisible()
    expect(screen.getByText(fr.admin.stats.topLine(2, 5))).toBeVisible()
    const table = screen.getByRole('table', { name: fr.admin.stats.timelineCaption })
    expect(within(table).getAllByRole('row').length).toBeGreaterThan(1)
    expect(document.body.textContent).not.toMatch(/NaN|undefined/)
  })

  it('explains an event nobody has joined, and points to the QR code', async () => {
    renderPage(fakeApi())

    expect(await screen.findByText(fr.admin.stats.empty)).toBeVisible()
    expect(screen.getByRole('link', { name: fr.admin.stats.emptyAction })).toHaveAttribute(
      'href',
      `/admin/events/${SLUG}`,
    )
  })

  it('renders a first name as text and cuts a very long one', async () => {
    const long = 'x'.repeat(120)
    renderPage(
      fakeApi({
        getEventStats: vi.fn(async () =>
          busy({
            topContributors: [
              { displayName: '<img src=x onerror=alert(1)>', photos: 1, reactions: 0 },
              { displayName: long, photos: 1, reactions: 0 },
            ],
          }),
        ),
      }),
    )

    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeVisible()
    expect(document.querySelector('img')).toBeNull()
    expect(screen.getByText(`${'x'.repeat(40)}…`)).toBeVisible()
  })

  it('says the after-party figures are not measured while there is nothing to show', async () => {
    renderPage(fakeApi({ getEventStats: vi.fn(async () => busy({ engagement: null })) }))

    expect(await screen.findByText(fr.admin.stats.engagementNone)).toBeVisible()
    expect(document.body.textContent).not.toMatch(/NaN|undefined/)
  })

  it('shows the opens and the ZIPs with the day measuring began, and how to read them', async () => {
    renderPage(
      fakeApi({
        getEventStats: vi.fn(async () =>
          busy({
            engagement: { since: '2026-11-14', galleryViews: 57, galleryArchiveDownloads: 12 },
          }),
        ),
      }),
    )

    expect(await screen.findByText(fr.admin.stats.albumOpens(57))).toBeVisible()
    expect(screen.getByText(fr.admin.stats.zipLaunches(12))).toBeVisible()
    expect(screen.getByText(/Mesuré depuis le 14 novembre/)).toBeVisible()
    expect(screen.getByText(fr.admin.stats.engagementNote)).toBeVisible()
  })

  it('names the anonymous guests as one line', async () => {
    renderPage(
      fakeApi({
        getEventStats: vi.fn(async () =>
          busy({ anonymousContributors: { guests: 9, photos: 31 } }),
        ),
      }),
    )

    expect(await screen.findByText(fr.admin.stats.anonymous(9, 31))).toBeVisible()
  })

  it('names the failure and offers a retry', async () => {
    const getEventStats = vi.fn(async () => busy())
    getEventStats.mockRejectedValueOnce(ApiError.network())
    renderPage(fakeApi({ getEventStats }))

    await userEvent.click(await screen.findByRole('button', { name: fr.app.retry }))

    expect(await screen.findByText(fr.admin.stats.figureUploads(4))).toBeVisible()
  })

  it('reads again when the host comes back to the tab', async () => {
    const getEventStats = vi.fn(async () => busy())
    renderPage(fakeApi({ getEventStats }))
    await screen.findByText(fr.admin.stats.figureUploads(4))

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    await waitFor(() => expect(getEventStats).toHaveBeenCalledTimes(2))
  })

  it('stops reading on a suspended client, whatever arrives afterwards', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const getEventStats = vi.fn(async () => {
      throw new ApiError(403, 'client.suspended')
    })
    renderPage(fakeApi({ getEventStats }))
    await waitFor(() => expect(getEventStats).toHaveBeenCalledTimes(1))

    emitSignal('photo.uploaded')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
      vi.advanceTimersByTime(SIGNAL_DEBOUNCE_MS + SLOW_REFRESH_MS)
    })

    expect(getEventStats).toHaveBeenCalledTimes(1)
  })

  it('turns a burst of signals into one read, and ignores reactions', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const getEventStats = vi.fn(async () => busy())
    renderPage(fakeApi({ getEventStats }))
    await waitFor(() => expect(getEventStats).toHaveBeenCalledTimes(1))

    // One signal a second: apart enough that each would get a read of its own without the window.
    for (const type of [
      'photo.uploaded',
      'photo.moderated',
      'guest.joined',
      'photo.deleted',
      'guest.erased',
      'reaction.added',
    ]) {
      emitSignal(type)
      await act(async () => {
        vi.advanceTimersByTime(800)
      })
    }
    // Let every timer there is run out, a step at a time so each one's read can render.
    for (let step = 0; step < 14; step += 1) {
      await act(async () => {
        vi.advanceTimersByTime(800)
      })
    }

    await waitFor(() => expect(getEventStats).toHaveBeenCalledTimes(2))
    expect(getEventStats).toHaveBeenCalledTimes(2)
  })

  it('does not read again for reactions alone', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const getEventStats = vi.fn(async () => busy())
    renderPage(fakeApi({ getEventStats }))
    await waitFor(() => expect(getEventStats).toHaveBeenCalledTimes(1))

    emitSignal('reaction.added')
    await act(async () => {
      vi.advanceTimersByTime(SIGNAL_DEBOUNCE_MS + 1_000)
    })

    expect(getEventStats).toHaveBeenCalledTimes(1)
  })
})
