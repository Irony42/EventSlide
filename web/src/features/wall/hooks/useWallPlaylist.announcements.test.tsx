import { act, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WallResponse } from '../../../lib/api/dto'
import {
  aWallAnnouncement,
  aWallResponse,
  fakeApi,
  renderWithProviders,
} from '../../../testing/renderWithProviders'
import { FakeEventSource } from '../../../testing/fakeEventSource'
import { useWallPlaylist } from './useWallPlaylist'

/**
 * The wall's read of the announcements and its one timer (spec 21, §5): the server says when to
 * read again, the wall arms a single `setTimeout` for it, converts it with its own offset, and
 * leaves nothing behind.
 */
const NOW = 1_790_000_000_000

function Probe() {
  const { wall } = useWallPlaylist('camille-et-sacha')
  return <p>textes {wall?.announcements?.items.map((item) => item.text).join('|') ?? 'aucun'}</p>
}

describe('useWallPlaylist and the announcements', () => {
  const nativeEventSource = window.EventSource
  beforeEach(() => {
    FakeEventSource.reset()
    window.EventSource = FakeEventSource as unknown as typeof window.EventSource
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    window.EventSource = nativeEventSource
    vi.useRealTimers()
  })

  /**
   * The server answers from its own clock, which is the test's clock `skewMs` behind: what each
   * answer names is relative to the instant of that very answer, as the real server's is.
   */
  const serving = (
    build: (read: number, serverNowMs: number) => Partial<WallResponse>,
    skewMs = 0,
  ) => {
    let read = -1
    return vi.fn(async (): Promise<WallResponse> => {
      read += 1
      const serverNowMs = Date.now() - skewMs
      return aWallResponse({ ...build(read, serverNowMs), serverNowMs })
    })
  }

  const advance = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })

  /** One announcement an hour away, and a read asked for `inMs` after the answer. */
  const pending = (read: number, serverNowMs: number, inMs: number): Partial<WallResponse> => ({
    revision: `rev-${read}`,
    announcements: {
      items: [aWallAnnouncement(serverNowMs + 3_600_000, { text: `texte ${read}` })],
      nextReadAtMs: serverNowMs + inMs,
    },
  })

  it('reads again at the instant the server named, not before, and once', async () => {
    const wall = serving((read, now) => pending(read, now, 20_000))
    renderWithProviders(<Probe />, { api: fakeApi({ wall }) })
    await advance(0)
    const first = wall.mock.calls.length

    await advance(19_999)
    expect(wall).toHaveBeenCalledTimes(first)

    await advance(1)
    expect(wall).toHaveBeenCalledTimes(first + 1)
  })

  it('converts the server instant with its own offset: a machine ahead reads at the same moment', async () => {
    // This machine is five minutes ahead of the server; the instant is the server's.
    vi.setSystemTime(NOW + 300_000)
    const wall = serving((read, now) => pending(read, now, 20_000), 300_000)
    renderWithProviders(<Probe />, { api: fakeApi({ wall }) })
    await advance(0)
    const first = wall.mock.calls.length

    await advance(19_999)
    expect(wall).toHaveBeenCalledTimes(first)
    await advance(1)

    expect(wall).toHaveBeenCalledTimes(first + 1)
  })

  it('replaces its timer at every read: one timer, never one per read', async () => {
    const wall = serving((read, now) => pending(read, now, 20_000))
    renderWithProviders(<Probe />, { api: fakeApi({ wall }) })
    await advance(0)
    const armed = vi.getTimerCount()

    // Each read names an instant twenty seconds after itself: three rounds, three replacements.
    for (let round = 0; round < 3; round += 1) await advance(20_000)

    expect(wall.mock.calls.length).toBeGreaterThanOrEqual(4)
    expect(vi.getTimerCount()).toBe(armed)
  })

  it('arms nothing when no announcement is pending', async () => {
    const wall = serving(() => ({}))
    renderWithProviders(<Probe />, { api: fakeApi({ wall }) })
    await advance(0)
    const quiet = vi.getTimerCount()
    const first = wall.mock.calls.length

    // Under the thirty seconds of the safety net a wall without a stream reads on its own.
    await advance(29_000)

    expect(wall).toHaveBeenCalledTimes(first)
    expect(vi.getTimerCount()).toBe(quiet)
  })

  it('clears the timer when the page goes away', async () => {
    const wall = serving((read, now) => pending(read, now, 20_000))
    const view = renderWithProviders(<Probe />, { api: fakeApi({ wall }) })
    await advance(0)
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    view.unmount()

    expect(vi.getTimerCount()).toBe(0)
  })

  it('reads again when the tab comes back to the foreground', async () => {
    const wall = serving((read, now) => pending(read, now, 20_000))
    renderWithProviders(<Probe />, { api: fakeApi({ wall }) })
    await advance(0)
    const first = wall.mock.calls.length

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(wall).toHaveBeenCalledTimes(first + 1)
  })

  it('does not read on the visibility when nothing is pending', async () => {
    const wall = serving(() => ({}))
    renderWithProviders(<Probe />, { api: fakeApi({ wall }) })
    await advance(0)
    const first = wall.mock.calls.length

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(wall).toHaveBeenCalledTimes(first)
  })

  it('keeps what it read when a read fails, so the wall can go on deriving from it', async () => {
    let read = 0
    const wall = vi.fn(async (): Promise<WallResponse> => {
      read += 1
      if (read > 1) throw new Error('réseau')
      return aWallResponse({ ...pending(0, Date.now(), 60_000), serverNowMs: Date.now() })
    })
    renderWithProviders(<Probe />, { api: fakeApi({ wall }) })
    await advance(0)

    await advance(120_000)

    expect(screen.getByText('textes texte 0')).toBeInTheDocument()
  })

  it('takes a changed text on the next read although the playlist did not move', async () => {
    const wall = serving((_read, now) => ({
      revision: 'rev-same',
      announcements: {
        items: [
          aWallAnnouncement(now + 3_600_000, {
            // Read once at the start (StrictMode reads twice, so the count is no clock), then later.
            text: now - NOW < 10_000 ? 'Gâteau' : 'Discours',
          }),
        ],
        nextReadAtMs: now + 20_000,
      },
    }))
    renderWithProviders(<Probe />, { api: fakeApi({ wall }) })
    await advance(0)
    expect(screen.getByText('textes Gâteau')).toBeInTheDocument()

    await advance(20_000)

    expect(screen.getByText('textes Discours')).toBeInTheDocument()
  })
})
