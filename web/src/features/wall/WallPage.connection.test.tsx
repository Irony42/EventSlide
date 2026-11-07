import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/http'
import { fr } from '../../lib/i18n/fr'
import type { WallResponse } from '../../lib/api/dto'
import {
  aWallMission,
  aWallResponse,
  fakeApi,
  renderWithProviders,
} from '../../testing/renderWithProviders'
import { classesOf, cls } from '../../testing/classesOf'
import { CURSOR_IDLE_MS } from './hooks/useIdleCursor'
import { OUTAGE_DOT_AFTER_MS, OUTAGE_TEXT_AFTER_MS } from './hooks/useOutageStage'
import { WallPage } from './WallPage'
import styles from './WallPage.module.css'
import {
  ROUTE,
  PATH,
  theStream,
  theWall,
  streamOpens,
  streamDrops,
  streamSignals,
  aPopulatedWall,
  wallSequence,
  wallThenNetworkDown,
  wallAfterFailures,
  useWallPageEnvironment,
} from './testing/wallPageHarness'

describe('WallPage', () => {
  useWallPageEnvironment()

  describe('a lost connection (MUR-9)', () => {
    /**
     * The room never learns about a blip. A venue's network drops for thirty seconds several
     * times an evening while the photos keep turning, and a "Connexion perdue" pill at the
     * projector's type scale over two hundred guests made a working product look broken.
     *
     * "Lost" means the wall cannot read either: a stream that never opens is not a lost
     * connection while the thirty-second read keeps answering (a proxy that buffers event
     * streams leaves it down all night), so the wall below answers once and then fails.
     */
    const theDot = (): HTMLElement => screen.getByTestId('wall-outage-dot')
    const noDot = (): void => {
      expect(screen.queryByTestId('wall-outage-dot')).not.toBeInTheDocument()
    }
    /** The sentence, as opposed to the dot's own text, which is only for assistive technology. */
    const theSentence = (): HTMLElement | null =>
      screen.queryByText(fr.wall.offline, { selector: 'p' })

    /** The wall re-reads every thirty seconds while its stream is down: the first failure lands then. */
    const FIRST_FAILED_READ_MS = 30_000

    const afterMs = async (ms: number): Promise<void> => {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms)
      })
    }

    /**
     * Past the first failed read, then `ms` more. Two steps, because the outage clock starts
     * when React commits the failure, and inside one `act` that happens only at the end.
     */
    const afterTheFirstFailedRead = async (ms: number): Promise<void> => {
      await afterMs(FIRST_FAILED_READ_MS)
      await afterMs(ms)
    }

    const aWallWhoseStreamNeverOpens = async (
      wall: ReturnType<typeof wallSequence> = wallThenNetworkDown(aPopulatedWall()),
    ): Promise<void> => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      const api = fakeApi({ wall })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
      await screen.findByTestId('wall-slide')
    }

    it('shows the room nothing at all for the first minute without a stream', async () => {
      await aWallWhoseStreamNeverOpens()

      await afterTheFirstFailedRead(OUTAGE_DOT_AFTER_MS - 1_000)

      noDot()
      expect(theSentence()).not.toBeInTheDocument()
      // Never a spinner over the room's photos and never a blank screen.
      expect(screen.getByTestId('wall-slide')).toBeVisible()
    })

    it('then shows a discreet dot with no words', async () => {
      await aWallWhoseStreamNeverOpens()

      await afterTheFirstFailedRead(OUTAGE_DOT_AFTER_MS + 1_000)

      expect(theDot()).toBeVisible()
      expect(theSentence()).not.toBeInTheDocument()
    })

    it('names the dot for assistive technology, in a status and not an image', async () => {
      await aWallWhoseStreamNeverOpens()

      await afterTheFirstFailedRead(OUTAGE_DOT_AFTER_MS + 1_000)

      // A `role="img"` inside the live region is announced inconsistently and is not a status;
      // the dot is a status whose words are visually hidden.
      expect(theDot()).toHaveAttribute('role', 'status')
      expect(within(theDot()).getByText(fr.wall.offline)).toHaveClass('visually-hidden')
      expect(screen.queryByRole('img', { name: fr.wall.offline })).not.toBeInTheDocument()
    })

    it('says what is happening only once the outage has lasted for minutes', async () => {
      await aWallWhoseStreamNeverOpens()

      await afterTheFirstFailedRead(OUTAGE_TEXT_AFTER_MS + 1_000)

      expect(theSentence()).toBeVisible()
      noDot()
      expect(screen.getByTestId('wall-slide')).toBeVisible()
    })

    it('forgets the outage the moment the stream opens', async () => {
      await aWallWhoseStreamNeverOpens()
      await afterTheFirstFailedRead(OUTAGE_DOT_AFTER_MS + 1_000)
      expect(theDot()).toBeVisible()

      await streamOpens()

      noDot()
      expect(theSentence()).not.toBeInTheDocument()
    })

    it('does not claim a network outage when the stream is refused but the reads keep working', async () => {
      // A proxy that buffers event streams, a per-client cap: the stream never opens, and the
      // thirty-second read answers every time. Nothing is waiting for the network.
      await aWallWhoseStreamNeverOpens(wallSequence(aPopulatedWall()))

      await afterMs(OUTAGE_TEXT_AFTER_MS * 2)

      noDot()
      expect(theSentence()).not.toBeInTheDocument()
      expect(screen.queryByText(fr.wall.offline)).not.toBeInTheDocument()
    })
  })

  it('says nothing about the connection once the stream is open', async () => {
    const api = fakeApi({ wall: wallSequence(aPopulatedWall()) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })

    await screen.findByTestId('wall-slide')
    await streamOpens()

    expect(screen.queryByText(fr.wall.offline)).not.toBeInTheDocument()
  })

  it('says what to do next when the route carries no event at all', async () => {
    // A mistyped display URL resolves to no slug. 1.0 left a spinner turning on the
    // projector for the rest of the evening, which is the one thing the room must never
    // be left looking at.
    const api = fakeApi()

    renderWithProviders(<WallPage />, { api })

    const failure = await screen.findByRole('alert')
    expect(failure).toHaveTextContent(fr.wall.errorTitle)
    expect(failure).toHaveTextContent(fr.wall.errorHint)
    expect(api.wall).not.toHaveBeenCalled()
  })

  it('still names the failure when it arrives with no error code', async () => {
    // Anything the transport did not turn into an `ApiError` — a DNS failure, a proxy
    // closing the socket — has no code to look a message up by.
    const api = fakeApi({ wall: vi.fn(() => Promise.reject(new Error('socket hang up'))) })

    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.wall.errorTitle)
  })

  it('retries at the host’s request when they walk over to the projector', async () => {
    const wall = wallAfterFailures(1, aPopulatedWall())
    renderWithProviders(<WallPage />, { api: fakeApi({ wall }), route: ROUTE, path: PATH })
    await screen.findByRole('alert')

    await userEvent.click(screen.getByRole('button', { name: fr.app.retry }))

    // The wall retries on its own; this is for the host who came over rather than
    // waiting for the next attempt, and it has to work without a page reload.
    expect(await screen.findByTestId('wall-slide')).toBeVisible()
  })

  it('asks again by itself after a failed first read', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const wall = wallAfterFailures(1, aPopulatedWall())
    renderWithProviders(<WallPage />, { api: fakeApi({ wall }), route: ROUTE, path: PATH })
    await screen.findByRole('alert')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })

    // Nobody is going to press anything: the projector is in a corner and the host is
    // at the reception. A wall that failed its first read while the server restarted has
    // to come back by itself.
    expect(await screen.findByTestId('wall-slide')).toBeVisible()
  })

  describe('WallPage when the event stops being served', () => {
    /**
     * The room is looking at an album the host has just archived, or whose client the operator
     * has just suspended. The server ends the live feed and answers the wall with the 404 an
     * unknown event gets (docs/API.md, "What a suspended client is told"). The page has to
     * learn that from the answer, because an `EventSource` cannot say why it dropped.
     */
    const theEventIsGone = (): ApiError => new ApiError(404, 'event.notFound')

    /** Answers the first read with photographs, then every later one with `after`. */
    const photosThen = (after: () => Promise<WallResponse>) => {
      let call = 0
      return vi.fn(async (): Promise<WallResponse> => {
        call += 1
        return call === 1 ? aPopulatedWall() : after()
      })
    }

    it('stops showing the album once the server says the event is gone, after the stream drops', async () => {
      const wall = photosThen(() => Promise.reject(theEventIsGone()))
      renderWithProviders(<WallPage />, { api: fakeApi({ wall }), route: ROUTE, path: PATH })
      await screen.findByTestId('wall-slide')
      await streamOpens()

      await streamDrops()

      expect(await screen.findByRole('status')).toHaveTextContent(fr.wall.notServedTitle)
      expect(screen.queryByTestId('wall-slide')).not.toBeInTheDocument()
      expect(wall).toHaveBeenCalledTimes(2)
    })

    it('stops showing the album when a refetch after a signal says the event is gone', async () => {
      const wall = photosThen(() => Promise.reject(theEventIsGone()))
      renderWithProviders(<WallPage />, { api: fakeApi({ wall }), route: ROUTE, path: PATH })
      await screen.findByTestId('wall-slide')
      await streamOpens()

      await streamSignals('event.statusChanged')

      expect(await screen.findByRole('status')).toHaveTextContent(fr.wall.notServedTitle)
      expect(screen.queryByTestId('wall-slide')).not.toBeInTheDocument()
    })

    it('keeps cycling its photos and says the connection is lost when the network drops', async () => {
      // The other branch, and the one the room needs every evening: no answer is not "gone".
      const wall = photosThen(() => Promise.reject(ApiError.network()))
      renderWithProviders(<WallPage />, { api: fakeApi({ wall }), route: ROUTE, path: PATH })
      await screen.findByTestId('wall-slide')
      await streamOpens()

      await streamDrops()

      await waitFor(() => expect(wall).toHaveBeenCalledTimes(2))
      expect(screen.getByTestId('wall-slide')).toBeVisible()
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('keeps its photos for a 404 that is not the server saying the event is gone', async () => {
      // A reverse proxy in the middle of a deploy answers an HTML page, which the transport
      // turns into \`unknown\`. Blanking a live party's projector for that would be the
      // opposite mistake.
      const wall = photosThen(() => Promise.reject(new ApiError(404, 'unknown')))
      renderWithProviders(<WallPage />, { api: fakeApi({ wall }), route: ROUTE, path: PATH })
      await screen.findByTestId('wall-slide')
      await streamOpens()

      await streamDrops()

      await waitFor(() => expect(wall).toHaveBeenCalledTimes(2))
      expect(screen.getByTestId('wall-slide')).toBeVisible()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('keeps its photos for a server error, which says nothing about the event', async () => {
      const wall = photosThen(() => Promise.reject(new ApiError(503, 'service.notReady')))
      renderWithProviders(<WallPage />, { api: fakeApi({ wall }), route: ROUTE, path: PATH })
      await screen.findByTestId('wall-slide')
      await streamOpens()

      await streamDrops()

      await waitFor(() => expect(wall).toHaveBeenCalledTimes(2))
      expect(screen.getByTestId('wall-slide')).toBeVisible()
    })

    it('asks nothing of the server when the stream was never open, beyond its own first read', async () => {
      const wall = vi.fn(async () => aPopulatedWall())
      renderWithProviders(<WallPage />, { api: fakeApi({ wall }), route: ROUTE, path: PATH })
      await screen.findByTestId('wall-slide')

      await streamDrops()

      expect(wall).toHaveBeenCalledTimes(1)
    })

    it('does not tell a room whose event is not served to check its network', async () => {
      // The page's first read of a draft, archived or suspended event. The server answered,
      // so the network is fine, and "Connexion perdue" over "check the venue's network"
      // sent a host looking at the wrong thing.
      const api = fakeApi({ wall: vi.fn(() => Promise.reject(theEventIsGone())) })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })

      await screen.findByRole('heading', { name: fr.wall.notServedTitle })
      const notice = screen.getByRole('status')

      expect(notice).toHaveTextContent(fr.wall.notServedTitle)
      expect(notice).toHaveTextContent(fr.wall.notServedHint)
      expect(notice).not.toHaveTextContent(fr.wall.errorTitle)
      expect(notice).not.toHaveTextContent(fr.wall.errorHint)
      expect(screen.queryByText(fr.wall.offline)).not.toBeInTheDocument()
    })

    it('waits calmly for an event that is not open yet: no danger icon, no button (MUR-4)', async () => {
      // A host who opens the projector's address the day before is testing. A red icon over
      // "Réessayer" on a screen with no mouse told them it was broken.
      const api = fakeApi({ wall: vi.fn(() => Promise.reject(theEventIsGone())) })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })

      await screen.findByRole('heading', { name: fr.wall.notServedTitle })
      const notice = screen.getByRole('status')

      expect(within(notice).queryByRole('button')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: fr.app.retry })).not.toBeInTheDocument()
      expect(notice).toHaveTextContent(fr.wall.notServedHint)
      // The hollow, quiet glyph: not the danger red the error state keeps.
      expect(classesOf(notice.querySelector('svg'))).toContain(cls(styles, 'calmIcon'))
    })

    it('does not name the event it is waiting for', async () => {
      // The server answers 404 to a draft and to a slug that does not exist alike, so the
      // screen has nothing to say about which one it is (and would reveal a draft's name).
      const api = fakeApi({ wall: vi.fn(() => Promise.reject(theEventIsGone())) })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })

      await screen.findByRole('heading', { name: fr.wall.notServedTitle })

      expect(screen.queryByText(/camille/i)).not.toBeInTheDocument()
    })

    it('keeps the retry button for a failure that is not the event being gone', async () => {
      const api = fakeApi({ wall: vi.fn(() => Promise.reject(ApiError.network())) })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })

      expect(await screen.findByRole('button', { name: fr.app.retry })).toBeVisible()
    })

    it('does not say the connection is lost over an album that is gone', async () => {
      const wall = photosThen(() => Promise.reject(theEventIsGone()))
      renderWithProviders(<WallPage />, { api: fakeApi({ wall }), route: ROUTE, path: PATH })
      await screen.findByTestId('wall-slide')
      await streamOpens()
      await streamDrops()
      await screen.findByRole('status')

      expect(screen.queryByText(fr.wall.offline)).not.toBeInTheDocument()
    })

    it('still sends a host to the network for a failure that is not the event being gone', async () => {
      const api = fakeApi({ wall: vi.fn(() => Promise.reject(ApiError.network())) })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })

      const failure = await screen.findByRole('alert')

      expect(failure).toHaveTextContent(fr.wall.errorHint)
      expect(failure).not.toHaveTextContent(fr.wall.notServedTitle)
    })

    it('stops showing the album when the stream never opens and the event is gone', async () => {
      // A feed refused for good (the per-client cap, a proxy that blocks event streams) never
      // delivers, so it never reports a loss. The wall was read once, before the archive, and
      // would keep the album until somebody reloaded it.
      vi.useFakeTimers({ shouldAdvanceTime: true })
      const wall = photosThen(() => Promise.reject(theEventIsGone()))
      renderWithProviders(<WallPage />, { api: fakeApi({ wall }), route: ROUTE, path: PATH })
      await screen.findByTestId('wall-slide')

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000)
      })

      expect(await screen.findByRole('status')).toHaveTextContent(fr.wall.notServedTitle)
      expect(screen.queryByTestId('wall-slide')).not.toBeInTheDocument()
    })

    it('reads nothing on a timer while the stream is delivering', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      const wall = vi.fn(async () => aPopulatedWall())
      renderWithProviders(<WallPage />, { api: fakeApi({ wall }), route: ROUTE, path: PATH })
      await screen.findByTestId('wall-slide')
      await streamOpens()

      // The server's heartbeat keeps the silence watchdog from reading this as a dead pipe.
      for (let beat = 0; beat < 3; beat += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(20_000)
          theStream().dispatchEvent(new MessageEvent('ping', { data: '{}' }))
        })
      }

      expect(wall).toHaveBeenCalledTimes(1)
    })

    it('comes back by itself when the event is served again', async () => {
      // A draft wall set up before the party, a suspension the operator lifts: nobody walks
      // over to the projector, so the page keeps asking.
      //
      // The clock is fully manual (no `shouldAdvanceTime`) and nothing here waits on a
      // `findBy*` timeout. The test used to let real time drive the fake clock and then raced
      // it: the retry timer is armed by a passive effect that runs after the "not served"
      // screen is committed, so on a loaded runner the 10 s advance could start before the
      // timer existed (it would then be due at 10 s + a little, past the advance), and the
      // answer was then awaited with the 1 s `findBy` default.
      vi.useFakeTimers()
      let served = false
      const wall = vi.fn(async (): Promise<WallResponse> => {
        if (!served) throw theEventIsGone()
        return aPopulatedWall()
      })
      renderWithProviders(<WallPage />, { api: fakeApi({ wall }), route: ROUTE, path: PATH })
      // Flushes the first read, the render of its failure and the effect that arms the retry.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(screen.getByRole('status')).toHaveTextContent(fr.wall.notServedTitle)
      expect(wall).toHaveBeenCalledTimes(1)

      served = true
      // One tick short of the retry: the page has not asked again.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(9_999)
      })
      expect(wall).toHaveBeenCalledTimes(1)
      expect(screen.queryByTestId('wall-slide')).not.toBeInTheDocument()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1)
      })

      expect(wall).toHaveBeenCalledTimes(2)
      expect(screen.getByTestId('wall-slide')).toBeVisible()
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })

  describe('an event the host has closed (MUR-3)', () => {
    const aClosedWall = (overrides: Partial<WallResponse> = {}): WallResponse =>
      aPopulatedWall({ acceptsGuests: false, ...overrides })

    it('stops inviting the room: no QR, no code, no reserved corner', async () => {
      // The wall keeps playing while people say goodbye, but a guest who scans the QR still
      // on it lands on "not open".
      const api = fakeApi({ wall: wallSequence(aClosedWall()) })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
      await screen.findByTestId('wall-slide')

      expect(screen.queryByText('H7K2QM')).not.toBeInTheDocument()
      expect(screen.queryByTitle(fr.wall.qrTitle)).not.toBeInTheDocument()
      expect(theWall()).not.toHaveAttribute('data-wall-chrome')
    })

    it('stops asking for photos with the host missions, which exist to prompt them', async () => {
      const api = fakeApi({
        wall: wallSequence(aClosedWall({ missions: [aWallMission({ prompt: 'un selfie' })] })),
      })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
      await screen.findByTestId('wall-slide')

      expect(screen.queryByText('un selfie')).not.toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: fr.wall.missionsTitle })).not.toBeInTheDocument()
    })

    it('draws no invitation on an empty wall either, and says thank you instead', async () => {
      const api = fakeApi({
        wall: wallSequence(aWallResponse({ items: [], acceptsGuests: false })),
      })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
      await screen.findByTestId('wall-empty')

      expect(screen.queryByTestId('wall-join')).not.toBeInTheDocument()
      expect(screen.queryByText('H7K2QM')).not.toBeInTheDocument()
      expect(screen.queryByText(fr.wall.joinPrompt)).not.toBeInTheDocument()
      expect(screen.getByText(fr.wall.emptyClosed)).toBeVisible()
    })

    it('takes the invitation off a running projector when the host closes the evening', async () => {
      // Closing moves no photograph, so `revision` is the same on both answers: only the
      // comparison of the settings can carry the change to a wall that is already playing.
      const api = fakeApi({ wall: wallSequence(aPopulatedWall(), aClosedWall()) })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
      await screen.findByTestId('wall-slide')
      await streamOpens()
      expect(screen.getByText('H7K2QM')).toBeVisible()

      await streamSignals('event.statusChanged')

      await waitFor(() => expect(screen.queryByText('H7K2QM')).not.toBeInTheDocument())
      expect(screen.getByTestId('wall-slide')).toBeVisible()
    })

    it('treats a server that does not send the field as an open event', async () => {
      const { acceptsGuests: _absent, ...older } = aPopulatedWall()
      const api = fakeApi({ wall: wallSequence(older) })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
      await screen.findByTestId('wall-slide')

      expect(screen.getByText('H7K2QM')).toBeVisible()
    })

    it('does not let a Q pressed on a closed event hide the card of a later one', async () => {
      // Nothing to put away, so the key does nothing, and flipping a flag anyway would hide
      // the card for ten minutes once the wall is reopened.
      const api = fakeApi({ wall: wallSequence(aClosedWall(), aPopulatedWall()) })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
      await screen.findByTestId('wall-slide')
      await streamOpens()

      await userEvent.keyboard('q')
      await streamSignals('event.statusChanged')

      expect(await screen.findByText('H7K2QM')).toBeVisible()
    })
  })

  describe('an asleep projector (MUR-2)', () => {
    const wakeLockStub = (request: () => Promise<unknown>): void => {
      Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } })
    }

    afterEach(() => {
      Reflect.deleteProperty(navigator, 'wakeLock')
    })

    it('asks the browser to keep the screen awake while the wall is open', async () => {
      const request = vi.fn(async () =>
        Object.assign(new EventTarget(), { release: async () => undefined }),
      )
      wakeLockStub(request)
      const api = fakeApi({ wall: wallSequence(aPopulatedWall()) })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
      await screen.findByTestId('wall-slide')

      await waitFor(() => expect(request).toHaveBeenCalledWith('screen'))
    })

    it('tells the host to turn the computer own sleep off when the browser cannot', async () => {
      // jsdom has no `navigator.wakeLock`, which is an older browser or a plain-http LAN.
      const api = fakeApi({ wall: wallSequence(aPopulatedWall()) })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
      await screen.findByTestId('wall-slide')

      await userEvent.keyboard('?')

      expect(await screen.findByRole('dialog')).toHaveTextContent(fr.wall.keepAwakeHint)
    })

    it('tells the host the same when the browser refuses', async () => {
      wakeLockStub(() => Promise.reject(new Error('NotAllowedError')))
      const api = fakeApi({ wall: wallSequence(aPopulatedWall()) })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
      await screen.findByTestId('wall-slide')

      await userEvent.keyboard('?')

      expect(await screen.findByRole('dialog')).toHaveTextContent(fr.wall.keepAwakeHint)
    })

    it('says nothing about sleep when the screen is being held awake', async () => {
      const request = vi.fn(async () =>
        Object.assign(new EventTarget(), { release: async () => undefined }),
      )
      wakeLockStub(request)
      const api = fakeApi({ wall: wallSequence(aPopulatedWall()) })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
      await screen.findByTestId('wall-slide')
      await waitFor(() => expect(request).toHaveBeenCalled())

      await userEvent.keyboard('?')

      const dialog = await screen.findByRole('dialog')
      expect(dialog).toHaveTextContent(fr.wall.shortcutsHint)
      expect(dialog).not.toHaveTextContent(fr.wall.keepAwakeHint)
    })
  })

  describe('the mouse arrow (MUR-2)', () => {
    it('leaves the photo after three still seconds, and comes back at a movement', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      const api = fakeApi({ wall: wallSequence(aPopulatedWall()) })
      renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
      await screen.findByTestId('wall-slide')
      expect(theWall()).not.toHaveAttribute('data-idle')

      await act(async () => {
        await vi.advanceTimersByTimeAsync(CURSOR_IDLE_MS + 100)
      })
      expect(theWall()).toHaveAttribute('data-idle', 'true')

      await act(async () => {
        window.dispatchEvent(new Event('pointermove'))
      })
      expect(theWall()).not.toHaveAttribute('data-idle')
    })
  })
})
