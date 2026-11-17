import { act, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fr } from '../../lib/i18n/fr'
import type { WallResponse, WallRevealDto } from '../../lib/api/dto'
import {
  aWallItem,
  aWallResponse,
  fakeApi,
  renderWithProviders,
} from '../../testing/renderWithProviders'
import { WallPage } from './WallPage'
import { ROUTE, PATH, useWallPageEnvironment, wallSequence } from './testing/wallPageHarness'

/** The server's clock at the first read, and the hour a minute later. */
const SERVER_NOW = 1_800_000_000_000
const HOUR_MS = SERVER_NOW + 60_000

const waitingBlock = (overrides: Partial<WallRevealDto> = {}): WallRevealDto => ({
  enabled: true,
  revealed: false,
  atMs: HOUR_MS,
  serverNowMs: SERVER_NOW,
  film: false,
  readyCount: 128,
  ...overrides,
})

/** The wall of a disposable-camera evening before its hour: no photograph, an aggregate. */
const waitingWall = (overrides: Partial<WallResponse> = {}): WallResponse =>
  aWallResponse({
    items: [],
    serverNowMs: SERVER_NOW,
    reveal: waitingBlock(),
    ...overrides,
  })

/** The same evening once the server says it is revealed. */
const revealedWall = (overrides: Partial<WallResponse> = {}): WallResponse =>
  aWallResponse({
    items: [aWallItem({ id: 'photo-1' })],
    revision: 'rev-2',
    serverNowMs: HOUR_MS + 1_000,
    reveal: {
      enabled: true,
      revealed: true,
      atMs: HOUR_MS,
      serverNowMs: HOUR_MS + 1_000,
      film: false,
      readyCount: null,
    },
    ...overrides,
  })

/** The timers the reveal switch and the read scheduler arm; promises and `findBy` run on. */
const startClock = (localNowMs: number) => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(localNowMs)
}

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })

const render = (api: ReturnType<typeof fakeApi>) =>
  renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })

/** Lets the first read land without moving any timer. */
const firstRead = () => advance(0)

describe('WallPage before the reveal of a disposable-camera evening (spec 23)', () => {
  useWallPageEnvironment()

  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('keeps the invitation and says the hour, the time left and how many are being developed', async () => {
    startClock(SERVER_NOW)
    render(fakeApi({ wall: wallSequence(waitingWall()) }))
    await firstRead()

    expect(screen.getByTestId('wall-empty')).toBeVisible()
    expect(screen.getByTestId('wall-join')).toBeVisible()
    expect(screen.getByTestId('wall-reveal-at')).toHaveTextContent(/^Révélation à /)
    expect(screen.getByTestId('wall-reveal-left')).toHaveTextContent(fr.reveal.countdown(0, 1))
    expect(screen.getByTestId('wall-reveal-count')).toHaveTextContent(
      '128 photos en cours de développement',
    )
    expect(screen.queryByTestId('wall-slide')).toBeNull()
  })

  it('shows no souvenir counter before the reveal, whatever total the answer carries', async () => {
    startClock(SERVER_NOW)
    render(
      fakeApi({
        wall: wallSequence(waitingWall({ souvenirCounter: true, souvenirCount: 412 })),
      }),
    )
    await firstRead()

    expect(screen.getByTestId('wall-empty')).toBeVisible()
    expect(screen.queryByTestId('souvenir-counter')).toBeNull()
  })

  it('announces no new photograph at the hour, when the whole evening appears at once', async () => {
    startClock(SERVER_NOW)
    // A total of 0 before the reveal is more than the server sends (it sends none), and the screen
    // does not rely on that: the first read after the hour would otherwise be "3 new photos".
    const items = [aWallItem({ id: 'c' }), aWallItem({ id: 'b' }), aWallItem({ id: 'a' })]
    render(
      fakeApi({
        wall: wallSequence(
          waitingWall({ newPhotoSignal: true, souvenirCount: 0 }),
          revealedWall({ newPhotoSignal: true, souvenirCount: 40, items }),
        ),
      }),
    )
    await firstRead()

    await advance(60_000)

    expect(screen.getByTestId('wall-slide')).toBeVisible()
    expect(screen.queryByTestId('new-photo-signal')).toBeNull()
  })

  it('reads the playlist again at the hour, and shows the wall it always was', async () => {
    startClock(SERVER_NOW)
    const wall = wallSequence(waitingWall(), revealedWall())
    render(fakeApi({ wall }))
    await firstRead()
    expect(wall).toHaveBeenCalledTimes(1)

    await advance(59_000)
    expect(wall).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('wall-slide')).toBeNull()

    await advance(1_000)

    expect(wall).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('wall-slide')).toBeVisible()
    expect(screen.queryByTestId('wall-reveal')).toBeNull()
  })

  it('spreads the read over three seconds after the hour', async () => {
    startClock(SERVER_NOW)
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const wall = wallSequence(waitingWall(), revealedWall())
    render(fakeApi({ wall }))
    await firstRead()

    await advance(60_000 + 1_400)
    expect(wall).toHaveBeenCalledTimes(1)

    await advance(100)
    expect(wall).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['five minutes behind the server', -5 * 60_000],
    ['five minutes ahead of the server', 5 * 60_000],
  ])('switches at the same moment on a machine whose clock is %s', async (_who, skewMs) => {
    // The machine's clock is `SERVER_NOW + skewMs`; only the server's word about the hour counts.
    startClock(SERVER_NOW + skewMs)
    const wall = wallSequence(waitingWall(), revealedWall())
    render(fakeApi({ wall }))
    await firstRead()
    expect(screen.getByTestId('wall-reveal-left')).toHaveTextContent(fr.reveal.countdown(0, 1))

    await advance(59_000)
    expect(wall).toHaveBeenCalledTimes(1)
    await advance(1_000)

    expect(wall).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('wall-slide')).toBeVisible()
  })

  it('reads two screens together, whatever the two machines’ clocks say', async () => {
    startClock(SERVER_NOW)
    const first = wallSequence(waitingWall(), revealedWall())
    const second = wallSequence(waitingWall(), revealedWall())
    render(fakeApi({ wall: first }))
    render(fakeApi({ wall: second }))
    await firstRead()

    await advance(60_000)

    expect(first).toHaveBeenCalledTimes(2)
    expect(second).toHaveBeenCalledTimes(2)
  })

  it('arms nothing with no hour: the host’s button speaks through the settings signal', async () => {
    startClock(SERVER_NOW)
    const wall = wallSequence(waitingWall({ reveal: waitingBlock({ atMs: null }) }))
    render(fakeApi({ wall }))
    await firstRead()

    expect(screen.getByTestId('wall-reveal-at')).toHaveTextContent(fr.reveal.wallSoon)

    await advance(24 * 3_600_000)
    expect(wall).toHaveBeenCalledTimes(1)
  })

  it('draws no waiting block on an evening that is not a disposable camera', async () => {
    startClock(SERVER_NOW)
    render(fakeApi({ wall: wallSequence(aWallResponse({ items: [] })) }))
    await firstRead()

    expect(screen.getByTestId('wall-empty')).toBeVisible()
    expect(screen.queryByTestId('wall-reveal')).toBeNull()
  })

  it('clears the reveal timer when the wall is left', async () => {
    startClock(SERVER_NOW)
    const wall = wallSequence(waitingWall(), revealedWall())
    const { unmount } = render(fakeApi({ wall }))
    await firstRead()

    unmount()
    await advance(120_000)

    expect(wall).toHaveBeenCalledTimes(1)
  })
})
