import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/http'
import { fr } from '../../lib/i18n/fr'
import type { WallItemDto, WallResponse } from '../../lib/api/dto'
import {
  aWallItem,
  aWallResponse,
  fakeApi,
  renderWithProviders,
} from '../../testing/renderWithProviders'
import { WallPage } from './WallPage'

/**
 * The projected surface: a screen nobody touches for eight hours.
 *
 * Every state below is one a room actually sees. The two that 1.0 shipped as a black
 * screen — nothing published yet, and a failed load — are the first ones here.
 */

const ROUTE = '/e/camille-et-sacha/display'
const PATH = '/e/:slug/display'

/**
 * A controllable `EventSource`.
 *
 * jsdom has none, and the harness installs a stand-in that never opens and never
 * delivers. The wall's whole resilience story is about the stream opening, dropping
 * and delivering, so a test has to be able to drive those three. This stubs a browser
 * API and nothing else: `useEventStream` under it is the real one.
 */
class FakeEventSource extends EventTarget {
  static instances: FakeEventSource[] = []

  readonly readyState = 1
  closed = false

  constructor(readonly url: string) {
    super()
    FakeEventSource.instances.push(this)
  }

  close(): void {
    this.closed = true
  }
}

const theStream = (): FakeEventSource => {
  const instance = FakeEventSource.instances.at(-1)
  if (instance === undefined) throw new Error('the wall opened no stream')
  return instance
}

const streamOpens = async (): Promise<void> => {
  const stream = theStream()
  await act(async () => {
    stream.dispatchEvent(new Event('open'))
  })
}

const streamSignals = async (type: string): Promise<void> => {
  const stream = theStream()
  await act(async () => {
    stream.dispatchEvent(new MessageEvent('change', { data: JSON.stringify({ type }) }))
  })
}

const aPopulatedWall = (overrides: Partial<WallResponse> = {}): WallResponse =>
  aWallResponse({ joinCode: 'H7K2QM', items: [aWallItem()], ...overrides })

const anEmptyWall = (): WallResponse => aWallResponse({ joinCode: 'H7K2QM', items: [] })

const somePhotos = (count: number): readonly WallItemDto[] =>
  Array.from({ length: count }, (_unused, at) =>
    aWallItem({ id: `photo-${at}`, caption: `Photo ${at}`, authorName: 'Léa' }),
  )

/** Answers with each response in turn, then repeats the last one. */
const wallSequence = (...responses: readonly WallResponse[]) => {
  let call = -1
  return vi.fn(async (): Promise<WallResponse> => {
    call += 1
    const response = responses[Math.min(call, responses.length - 1)]
    if (response === undefined) throw new Error('wallSequence needs at least one response')
    return response
  })
}

/** Fails the given number of reads, then answers. */
const wallAfterFailures = (failures: number, response: WallResponse) => {
  let call = 0
  return vi.fn(async (): Promise<WallResponse> => {
    call += 1
    if (call <= failures) throw ApiError.network()
    return response
  })
}

interface Pending {
  readonly promise: Promise<WallResponse>
  readonly arrives: (response: WallResponse) => void
}

/** A read the test decides the moment of, for the states that exist only while waiting. */
const pendingWall = (): Pending => {
  let arrives: (response: WallResponse) => void = () => undefined
  const promise = new Promise<WallResponse>((resolve) => {
    arrives = resolve
  })
  return { promise, arrives }
}

/**
 * Reduced motion, as the browser reports it.
 *
 * The design system also handles the query in CSS, but the Ken Burns duration and the
 * reaction floaters are created in JavaScript and have to be withheld rather than
 * merely shortened.
 */
const prefersReducedMotion = (): void => {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: query.includes('prefers-reduced-motion'),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
        // A hand-written stub cannot satisfy a whole DOM interface, which is the one
        // place the web app allows a structural cast.
      }) as unknown as MediaQueryList,
  )
}

describe('WallPage', () => {
  const nativeEventSource = window.EventSource
  /**
   * The fullscreen API is stood in for by `web/src/testing/setup.ts`, so the originals
   * are captured per test rather than at collection time — and restored, because one
   * test below has to describe a browser that implements none of it.
   */
  let nativeRequestFullscreen: () => Promise<void>
  let nativeExitFullscreen: () => Promise<void>

  beforeEach(() => {
    FakeEventSource.instances = []
    window.EventSource = FakeEventSource as unknown as typeof window.EventSource
    nativeRequestFullscreen = document.documentElement.requestFullscreen
    nativeExitFullscreen = document.exitFullscreen
  })

  afterEach(() => {
    window.EventSource = nativeEventSource
    document.documentElement.requestFullscreen = nativeRequestFullscreen
    document.exitFullscreen = nativeExitFullscreen
    Reflect.deleteProperty(document, 'fullscreenElement')
    vi.useRealTimers()
  })

  /** jsdom tracks no fullscreen state, so the projector's is described here. */
  const alreadyFullscreen = (): void => {
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => document.documentElement,
    })
  }

  it('waits with a spinner while the first playlist is on its way', () => {
    const api = fakeApi({ wall: vi.fn(() => new Promise<WallResponse>(() => {})) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })

    expect(screen.getByRole('status')).toHaveTextContent(fr.app.loading)
  })

  it('invites the room to join while nothing has been published yet', async () => {
    const api = fakeApi({ wall: wallSequence(anEmptyWall()) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })

    const invitation = await screen.findByTestId('wall-empty')

    // The wall is the invitation for the first twenty minutes of the party: the event,
    // the code that gets read out across a table, and a QR drawn inline rather than
    // fetched from anywhere.
    expect(within(invitation).getByRole('heading', { name: 'Camille & Sacha' })).toBeVisible()
    expect(within(invitation).getByText('H7K2QM')).toBeVisible()
    expect(within(invitation).getByTitle(fr.wall.qrTitle)).toBeInTheDocument()
  })

  it('still invites the room when the server presents no join code', async () => {
    const api = fakeApi({ wall: wallSequence(aWallResponse({ items: [] })) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })

    const invitation = await screen.findByTestId('wall-empty')

    expect(within(invitation).getByText(fr.wall.empty)).toBeVisible()
    expect(within(invitation).queryByTitle(fr.wall.qrTitle)).not.toBeInTheDocument()
  })

  it('puts the photo, its caption and its author on the screen', async () => {
    const api = fakeApi({ wall: wallSequence(aPopulatedWall()) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })

    const slide = await screen.findByTestId('wall-slide')

    expect(within(slide).getByText('Les confettis')).toBeVisible()
    expect(within(slide).getByText('Léa')).toBeVisible()
    // The alt is the caption and the author. 1.0 used the stored filename, which reads
    // aloud as IMG_4821.jpg.
    expect(within(slide).getByRole('img')).toHaveAccessibleName(
      `Les confettis — ${fr.wall.photoBy('Léa')}`,
    )
  })

  it('says what to do next when the first load fails, instead of going black', async () => {
    const api = fakeApi({ wall: vi.fn(() => Promise.reject(new ApiError(404, 'event.notFound'))) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })

    const failure = await screen.findByRole('alert')

    expect(failure).toHaveTextContent(fr.errors['event.notFound'])
    expect(failure).toHaveTextContent(fr.wall.errorHint)
  })

  it('takes the Ken Burns duration from the response, not from a constant', async () => {
    // 1.0 hardcoded a 20 s zoom beside a 10 s slide, so every image snapped back.
    const api = fakeApi({ wall: wallSequence(aPopulatedWall({ kenBurnsDurationMs: 12_345 })) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })

    const slide = await screen.findByTestId('wall-slide')

    expect(slide.style.getPropertyValue('--wall-kenburns-duration')).toBe('12345ms')
    expect(slide).toHaveAttribute('data-motion', 'kenburns')
  })

  it('runs no Ken Burns animation at all when the viewer asked for no motion', async () => {
    prefersReducedMotion()
    const api = fakeApi({ wall: wallSequence(aPopulatedWall({ kenBurnsDurationMs: 12_345 })) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })

    const slide = await screen.findByTestId('wall-slide')

    // Removed rather than shortened: a 0.01 ms zoom with a fill mode still snaps to the
    // zoomed frame, and a projected zoom is the worst case for a vestibular disorder.
    expect(slide).toHaveAttribute('data-motion', 'still')
    expect(slide.style.getPropertyValue('--wall-kenburns-duration')).toBe('')
  })

  it('reports a dropped stream while the loaded photos keep playing', async () => {
    const api = fakeApi({ wall: wallSequence(aPopulatedWall()) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })

    await screen.findByTestId('wall-slide')

    // Never a spinner over the room's photos and never a blank screen: the notice sits
    // in a corner and the slideshow carries on with what it already has.
    expect(screen.getByText(fr.wall.offline)).toBeVisible()
    expect(screen.getByTestId('wall-slide')).toBeVisible()
  })

  it('says nothing about the connection once the stream is open', async () => {
    const api = fakeApi({ wall: wallSequence(aPopulatedWall()) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })

    await screen.findByTestId('wall-slide')
    await streamOpens()

    expect(screen.queryByText(fr.wall.offline)).not.toBeInTheDocument()
  })

  it('shows a newly published photo when the stream signals a change', async () => {
    const api = fakeApi({
      wall: wallSequence(
        anEmptyWall(),
        aPopulatedWall({ revision: 'rev-2', items: [aWallItem({ caption: 'La première danse' })] }),
      ),
    })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })

    await screen.findByTestId('wall-empty')
    await streamSignals('photo.moderated')

    const slide = await screen.findByTestId('wall-slide')
    expect(within(slide).getByText('La première danse')).toBeVisible()
  })

  it('leaves the wall alone when a refetch comes back on the same revision', async () => {
    /**
     * The revision is the whole mechanism. A signal fires for anything happening at the
     * event — a guest joining, a photo submitted for moderation — and each one provokes
     * one refetch. The second answer here carries a different photo under the *same*
     * revision, which a real server would never do; it is the only way to prove the
     * client trusts the revision rather than the payload. Without that comparison the
     * wall jumps every time anything happens in the room.
     */
    const wall = wallSequence(
      aPopulatedWall(),
      aPopulatedWall({ items: [aWallItem({ id: 'photo-2', caption: 'Le gâteau' })] }),
    )
    renderWithProviders(<WallPage />, { api: fakeApi({ wall }), route: ROUTE, path: PATH })

    await screen.findByTestId('wall-slide')
    await streamSignals('guest.joined')

    await waitFor(() => expect(wall).toHaveBeenCalledTimes(2))
    expect(within(screen.getByTestId('wall-slide')).getByText('Les confettis')).toBeVisible()
    expect(screen.queryByText('Le gâteau')).not.toBeInTheDocument()
  })

  it('keeps the photos on screen when a refetch fails', async () => {
    let call = 0
    const wall = vi.fn(async (): Promise<WallResponse> => {
      call += 1
      if (call === 1) return aPopulatedWall()
      throw ApiError.network()
    })
    renderWithProviders(<WallPage />, { api: fakeApi({ wall }), route: ROUTE, path: PATH })

    await screen.findByTestId('wall-slide')
    await streamSignals('photo.moderated')

    await waitFor(() => expect(wall).toHaveBeenCalledTimes(2))
    // A venue's network drops several times an evening. The room keeps its photos.
    expect(screen.getByTestId('wall-slide')).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('floats a capped number of reactions and asks for no playlist', async () => {
    const wall = wallSequence(aPopulatedWall())
    renderWithProviders(<WallPage />, { api: fakeApi({ wall }), route: ROUTE, path: PATH })

    await screen.findByTestId('wall-slide')
    for (let sent = 0; sent < 12; sent += 1) await streamSignals('reaction.added')

    // Capped by construction: an eight-hour reception sends thousands of these, and
    // 1.0's confetti grew a node for every one of them.
    expect(screen.getAllByTestId('wall-reaction')).toHaveLength(8)
    // A reaction changes no photo, so it must not provoke a wall read.
    expect(wall).toHaveBeenCalledTimes(1)
  })

  it('shows no reactions when the viewer asked for no motion', async () => {
    prefersReducedMotion()
    const api = fakeApi({ wall: wallSequence(aPopulatedWall()) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })

    await screen.findByTestId('wall-slide')
    await streamSignals('reaction.added')

    expect(screen.queryByTestId('wall-reaction')).not.toBeInTheDocument()
  })

  it('pauses and resumes for a host who presses the space bar', async () => {
    const api = fakeApi({ wall: wallSequence(aPopulatedWall({ items: somePhotos(3) })) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
    await screen.findByTestId('wall-slide')

    await userEvent.keyboard(' ')
    expect(screen.getByText(fr.wall.paused)).toBeVisible()

    await userEvent.keyboard(' ')
    expect(screen.queryByText(fr.wall.paused)).not.toBeInTheDocument()
  })

  it('steps to the next photo when the host presses the right arrow', async () => {
    const api = fakeApi({ wall: wallSequence(aPopulatedWall({ items: somePhotos(3) })) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
    await screen.findByTestId('wall-slide')

    await userEvent.keyboard('{ArrowRight}')

    expect(within(screen.getByTestId('wall-slide')).getByText('Photo 1')).toBeVisible()
  })

  it('cycles to the mosaic when the host presses L', async () => {
    const api = fakeApi({ wall: wallSequence(aPopulatedWall({ items: somePhotos(8) })) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
    await screen.findByTestId('wall-slide')

    await userEvent.keyboard('l')

    // Six slots, and no captions: a caption is unreadable at five metres, while a name
    // is short enough to survive the size.
    expect(screen.getAllByTestId('wall-slide')).toHaveLength(6)
    expect(screen.queryByText('Photo 0')).not.toBeInTheDocument()
    expect(screen.getAllByText('Léa')).toHaveLength(6)
  })

  it('explains its keyboard shortcuts when the host presses the question mark', async () => {
    const api = fakeApi({ wall: wallSequence(aPopulatedWall()) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
    await screen.findByTestId('wall-slide')

    await userEvent.keyboard('?')

    expect(await screen.findByRole('dialog')).toHaveTextContent(fr.wall.shortcutsHint)
  })

  it('keeps a join reminder in the corner and puts it away with a key', async () => {
    const api = fakeApi({ wall: wallSequence(aPopulatedWall()) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
    await screen.findByTestId('wall-slide')

    // Somebody arriving at 23:00 has only the screen to read.
    expect(screen.getByText('H7K2QM')).toBeVisible()

    await userEvent.keyboard('{Escape}')

    expect(screen.queryByText('H7K2QM')).not.toBeInTheDocument()
  })

  it('lets a host dismiss the join reminder with the button as well', async () => {
    const api = fakeApi({ wall: wallSequence(aPopulatedWall()) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
    await screen.findByTestId('wall-slide')

    await userEvent.click(screen.getByRole('button', { name: fr.wall.dismissJoinCard }))

    expect(screen.queryByText('H7K2QM')).not.toBeInTheDocument()
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

  it('puts the projector into fullscreen when the host presses F', async () => {
    const request = vi.spyOn(document.documentElement, 'requestFullscreen')
    const api = fakeApi({ wall: wallSequence(aPopulatedWall()) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
    await screen.findByTestId('wall-slide')

    await userEvent.keyboard('f')

    // The browser API is the boundary here: asking for fullscreen is the whole of the
    // observable effect, the same way a use-case call is for a screen that talks to the
    // server.
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('brings the projector back out of fullscreen when the host presses F again', async () => {
    alreadyFullscreen()
    const exit = vi.spyOn(document, 'exitFullscreen')
    const api = fakeApi({ wall: wallSequence(aPopulatedWall()) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
    await screen.findByTestId('wall-slide')

    await userEvent.keyboard('f')

    expect(exit).toHaveBeenCalledTimes(1)
  })

  it('keeps the wall up when leaving fullscreen fails', async () => {
    alreadyFullscreen()
    vi.spyOn(document, 'exitFullscreen').mockRejectedValue(new Error('Not allowed'))
    const api = fakeApi({ wall: wallSequence(aPopulatedWall()) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
    await screen.findByTestId('wall-slide')

    await userEvent.keyboard('f')

    expect(screen.getByTestId('wall-slide')).toBeVisible()
  })

  it('ignores F for leaving fullscreen on a browser that cannot leave it', async () => {
    alreadyFullscreen()
    Reflect.deleteProperty(document, 'exitFullscreen')
    const api = fakeApi({ wall: wallSequence(aPopulatedWall()) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
    await screen.findByTestId('wall-slide')

    await userEvent.keyboard('f')

    // A kiosk browser can put a page into fullscreen and implement no way back out.
    // Calling the method anyway would take the photos off the screen with a TypeError.
    expect(screen.getByTestId('wall-slide')).toBeVisible()
  })

  it('keeps the wall up when the projector’s browser refuses fullscreen', async () => {
    vi.spyOn(document.documentElement, 'requestFullscreen').mockRejectedValue(
      new Error('Permission denied'),
    )
    const api = fakeApi({ wall: wallSequence(aPopulatedWall()) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
    await screen.findByTestId('wall-slide')

    await userEvent.keyboard('f')

    // A projector browser may refuse without a user gesture it recognises. That is not
    // worth taking the photos off the screen for, and an unhandled rejection would.
    expect(screen.getByTestId('wall-slide')).toBeVisible()
  })

  it('ignores F on a browser that has no fullscreen at all', async () => {
    Reflect.deleteProperty(document.documentElement, 'requestFullscreen')
    const api = fakeApi({ wall: wallSequence(aPopulatedWall()) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
    await screen.findByTestId('wall-slide')

    await userEvent.keyboard('f')

    // Some in-app and kiosk browsers implement none of it. Calling it anyway would take
    // the whole wall down with a TypeError.
    expect(screen.getByTestId('wall-slide')).toBeVisible()
  })

  it('puts the shortcuts panel away before it starts hiding the join reminder', async () => {
    const api = fakeApi({ wall: wallSequence(aPopulatedWall()) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
    await screen.findByTestId('wall-slide')
    await userEvent.keyboard('?')
    await screen.findByRole('dialog')
    // The host looks back at the photo, so the panel's close button no longer has the
    // keyboard: Escape now reaches the wall itself.
    await userEvent.click(screen.getByTestId('wall-slide'))

    await userEvent.keyboard('{Escape}')

    // One key, the obvious meaning: put away whatever is covering the photos — starting
    // with the thing that covers most of them.
    expect(screen.queryByText(fr.wall.shortcutsHint)).not.toBeInTheDocument()
    expect(screen.getByText('H7K2QM')).toBeVisible()
  })

  it('closes the shortcuts panel from its own close button', async () => {
    const api = fakeApi({ wall: wallSequence(aPopulatedWall()) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
    await screen.findByTestId('wall-slide')
    await userEvent.keyboard('?')
    await screen.findByRole('dialog')

    await userEvent.click(screen.getByRole('button', { name: fr.ui.dialogClose }))

    // The host who opened the panel with a key may well be holding a mouse by the time
    // they want it gone, and the panel covers the photos while it is up.
    expect(screen.queryByText(fr.wall.shortcutsHint)).not.toBeInTheDocument()
  })

  it('leaves the slideshow alone while the shortcuts panel has the keyboard', async () => {
    const api = fakeApi({ wall: wallSequence(aPopulatedWall({ items: somePhotos(3) })) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
    await screen.findByTestId('wall-slide')
    await userEvent.keyboard('?')
    await screen.findByRole('dialog')

    await userEvent.keyboard('{ArrowRight}')

    // The panel's own controls own the arrows while it is open. Stepping the wall behind
    // it would move the photo the host opened the panel to ask about.
    expect(within(screen.getByTestId('wall-slide')).getByText('Photo 0')).toBeVisible()
  })

  it('shows the layout the host chose while the first playlist was still on its way', async () => {
    const pending = pendingWall()
    const api = fakeApi({ wall: vi.fn(() => pending.promise) })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })

    await userEvent.keyboard('l')
    await act(async () => {
      pending.arrives(aPopulatedWall({ items: somePhotos(8) }))
    })

    // The host sets the wall up for a cocktail hour while the server is still answering.
    // Losing that choice the moment the photos arrive would send them back to the
    // keyboard in front of the room.
    expect(await screen.findAllByTestId('wall-slide')).toHaveLength(6)
  })

  it('never confuses the zoom’s length with the slide’s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const api = fakeApi({
      wall: wallSequence(
        aPopulatedWall({
          items: somePhotos(3),
          slideIntervalMs: 8_000,
          kenBurnsDurationMs: 8_800,
        }),
      ),
    })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })

    const slide = await screen.findByTestId('wall-slide')

    // Both numbers come from one event setting in `src/domain/slideshow/`, where the
    // zoom is the interval plus the crossfade; the wall's job is to keep them apart.
    // Swapping them is what made 1.0's zoom outlive its slide and every photo jump.
    expect(slide.style.getPropertyValue('--wall-kenburns-duration')).toBe('8800ms')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000)
    })
    expect(within(screen.getByTestId('wall-slide')).getByText('Photo 1')).toBeVisible()
  })
})
