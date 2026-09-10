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

  beforeEach(() => {
    FakeEventSource.instances = []
    window.EventSource = FakeEventSource as unknown as typeof window.EventSource
  })

  afterEach(() => {
    window.EventSource = nativeEventSource
  })

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
})
