import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { WallResponse } from '../../../lib/api/dto'
import { aWallResponse, fakeApi, renderWithProviders } from '../../../testing/renderWithProviders'
import { useWallPlaylist } from './useWallPlaylist'

/**
 * The playlist, kept current over an evening on a venue's network.
 *
 * Everything here is about what the wall does when a read does *not* come back the way
 * it was supposed to: the venue's Wi-Fi drops several times a night, the server gets
 * restarted between courses, and the room must never be shown a black screen or a
 * spinner that does not stop.
 */

interface ProbeProps {
  readonly slug: string
}

function Probe({ slug }: ProbeProps) {
  const { wall, loading, error, refresh } = useWallPlaylist(slug)

  return (
    <div>
      <p>évènement {wall === null ? 'aucun' : wall.event.name}</p>
      <p>révision {wall === null ? 'aucune' : wall.revision}</p>
      <p>lecture {loading ? 'en cours' : 'terminée'}</p>
      <p>échec {error === null ? 'aucun' : error.message}</p>
      <button onClick={refresh}>réessayer</button>
    </div>
  )
}

interface Deferred<T> {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
  readonly reject: (cause: unknown) => void
}

const deferred = <T,>(): Deferred<T> => {
  let resolve: (value: T) => void = () => undefined
  let reject: (cause: unknown) => void = () => undefined
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

const aWall = (name: string, revision: string): WallResponse =>
  aWallResponse({ event: { slug: 'camille-et-sacha', name }, revision })

/** Answers with each outcome in turn, then repeats the last one. */
const reads = (...outcomes: readonly (WallResponse | (() => Promise<never>))[]) => {
  let call = -1
  return vi.fn(async (): Promise<WallResponse> => {
    call += 1
    const outcome = outcomes[Math.min(call, outcomes.length - 1)]
    if (outcome === undefined) throw new Error('reads needs at least one outcome')
    return typeof outcome === 'function' ? outcome() : outcome
  })
}

const rejectsWith = (cause: unknown) => () => Promise.reject(cause)

const retry = async (): Promise<void> => {
  await userEvent.click(screen.getByRole('button', { name: 'réessayer' }))
}

describe('useWallPlaylist', () => {
  it('asks for nothing at all when the route carries no event', async () => {
    const api = fakeApi()

    renderWithProviders(<Probe slug="" />, { api })

    // Reported as settled and not as loading: a slug-less route is broken, and the one
    // thing the room must never be left looking at is a spinner that never stops.
    expect(screen.getByText('lecture terminée')).toBeInTheDocument()
    expect(api.wall).not.toHaveBeenCalled()
    expect(api.streamUrl).not.toHaveBeenCalled()
  })

  it('treats an aborted read as no news rather than as a failure', async () => {
    // React mounts effects twice in development, so the first read is aborted by the
    // cleanup of the mount that set it going. The room must not be told about that.
    const api = fakeApi({
      wall: reads(rejectsWith(new DOMException('Aborted', 'AbortError'))),
    })

    renderWithProviders(<Probe slug="camille-et-sacha" />, { api })
    await waitFor(() => expect(api.wall).toHaveBeenCalled())

    expect(screen.getByText('échec aucun')).toBeInTheDocument()
    expect(screen.getByText('lecture en cours')).toBeInTheDocument()
  })

  it('reports a DOMException that is not an abort as the failure it is', async () => {
    const api = fakeApi({
      wall: reads(rejectsWith(new DOMException('Trop de données', 'QuotaExceededError'))),
    })

    renderWithProviders(<Probe slug="camille-et-sacha" />, { api })

    // A `DOMException` is not an `Error` subclass in any engine, so it arrives wrapped;
    // what matters is that it arrives rather than being swallowed with the aborts.
    expect(await screen.findByText(/^échec .*Trop de données/)).toBeInTheDocument()
  })

  it('reports a rejection that is not an Error at all', async () => {
    // Nothing in the transport throws a bare string today; if something ever does, the
    // wall has to end up on its failure screen rather than stuck on a spinner.
    const api = fakeApi({ wall: reads(rejectsWith('coupure réseau')) })

    renderWithProviders(<Probe slug="camille-et-sacha" />, { api })

    expect(await screen.findByText('échec coupure réseau')).toBeInTheDocument()
  })

  it('ignores a slow read for an event the wall has already left', async () => {
    const late = deferred<WallResponse>()
    const api = fakeApi({
      wall: vi.fn(async (slug: string) =>
        slug === 'camille-et-sacha' ? late.promise : aWall('Gala Irony42', 'rev-gala'),
      ),
    })
    const { rerender } = renderWithProviders(<Probe slug="camille-et-sacha" />, { api })

    rerender(<Probe slug="gala-irony42" />)
    await screen.findByText('évènement Gala Irony42')
    await act(async () => {
      late.resolve(aWall('Camille & Sacha', 'rev-1'))
    })

    // A read still in flight when the wall moved on belongs to another event. Letting
    // it land would put one event's photos on the other event's screen.
    expect(screen.getByText('évènement Gala Irony42')).toBeInTheDocument()
  })

  it('ignores a failed read for an event the wall has already left', async () => {
    const late = deferred<WallResponse>()
    const api = fakeApi({
      wall: vi.fn(async (slug: string) =>
        slug === 'camille-et-sacha' ? late.promise : aWall('Gala Irony42', 'rev-gala'),
      ),
    })
    const { rerender } = renderWithProviders(<Probe slug="camille-et-sacha" />, { api })

    rerender(<Probe slug="gala-irony42" />)
    await screen.findByText('évènement Gala Irony42')
    await act(async () => {
      late.reject(new Error('Le réseau a lâché'))
    })

    // The event that failed is not the event on screen, so its failure is not news.
    expect(screen.getByText('échec aucun')).toBeInTheDocument()
  })

  it('clears the failure when a read comes back on the revision already on screen', async () => {
    const api = fakeApi({
      wall: reads(
        aWall('Camille & Sacha', 'rev-1'),
        rejectsWith(new Error('Le réseau a lâché')),
        aWall('Camille & Sacha', 'rev-1'),
      ),
    })
    renderWithProviders(<Probe slug="camille-et-sacha" />, { api })
    await screen.findByText('révision rev-1')

    await retry()
    await screen.findByText('échec Le réseau a lâché')
    await retry()

    // The playlist never moved, so nothing on the wall changes — but the wall is not in
    // a failed state any more, and a state that still says it is would keep the
    // recovery notice up for the rest of the evening.
    expect(await screen.findByText('échec aucun')).toBeInTheDocument()
    expect(screen.getByText('révision rev-1')).toBeInTheDocument()
  })

  it('keeps the playlist it already has when a refetch fails', async () => {
    const api = fakeApi({
      wall: reads(aWall('Camille & Sacha', 'rev-1'), rejectsWith(new Error('Le réseau a lâché'))),
    })
    renderWithProviders(<Probe slug="camille-et-sacha" />, { api })
    await screen.findByText('révision rev-1')

    await retry()

    // A venue's network drops for thirty seconds several times an evening. The correct
    // behaviour is to carry on showing the photos the projector already holds.
    expect(await screen.findByText('échec Le réseau a lâché')).toBeInTheDocument()
    expect(screen.getByText('évènement Camille & Sacha')).toBeInTheDocument()
  })
})
