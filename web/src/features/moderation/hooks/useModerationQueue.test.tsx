import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, screen, waitFor } from '@testing-library/react'
import { ApiProvider } from '../../../lib/ApiProvider'
import { ToastProvider } from '../../../design-system/components/ToastProvider'
import { ApiError } from '../../../lib/http'
import { fr } from '../../../lib/i18n/fr'
import { aModerationPhoto, fakeApi } from '../../../testing/renderWithProviders'
import { heldModerationServer, moderationServer } from '../testing/moderationServer'
import { MODERATION_READ_DEBOUNCE_MS, useModerationQueue } from './useModerationQueue'
import type { ModerationQueueOptions } from './useModerationQueue'
import type { ReactNode } from 'react'
import type { Api } from '../../../lib/api/client'
import type {
  BulkModerationResponse,
  ModerationPhotoDto,
  ModerationQueueResponse,
} from '../../../lib/api/dto'
import { FakeEventSource } from '../../../testing/fakeEventSource'
import { deferred } from '../../../testing/deferred'

/** The query `api.moderationQueue` takes, which defaults to `{}` in the client. */
type ModerationQuery = Parameters<Api['moderationQueue']>[1]

/**
 * The queue as state, tested directly rather than only through the console.
 *
 * `ModerationPage.test.tsx` covers what the host sees and presses. What is left here is
 * the set of states where the console's optimism is *wrong* — an answer that arrives for
 * a filter the host already left, a photo a second moderator dealt with first, an
 * address with no event in it — and none of those has a button to press.
 */

/** What the server sends when something in the event changed. Never data. */
const emitSignal = (type: string): void => {
  act(() => {
    FakeEventSource.latest('the console').emitSignal(type)
  })
}

const SLUG = 'camille-et-sacha'

const queueOf = (
  items: readonly ModerationPhotoDto[],
  pendingCount = items.filter((item) => item.status === 'pending').length,
): ModerationQueueResponse => ({ items, pendingCount, nextCursor: null })

const mountFor = (api: Api, slug: string | undefined, options: ModerationQueueOptions = {}) => {
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <ApiProvider api={api}>
      <ToastProvider>{children}</ToastProvider>
    </ApiProvider>
  )
  return renderHook(() => useModerationQueue(slug, options), { wrapper })
}

const mount = (api: Api) => mountFor(api, SLUG)

/** `/admin/events//moderation`, or a route pattern that stopped carrying the slug. */
const mountWithoutEvent = (api: Api) => mountFor(api, undefined)

describe('useModerationQueue', () => {
  beforeEach(() => {
    FakeEventSource.reset()
    vi.stubGlobal('EventSource', FakeEventSource)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('subscribes to the moderation channel, not to the wall’s public one', () => {
    // The console used to open `streamUrl` — the projector's channel, which asks for no
    // authentication at all. Nothing broke visibly, because the two carry identical
    // frames; what was wrong is that the screen deciding what reaches a room of two
    // hundred people held an unauthenticated connection to do it, while its authorised
    // twin sat unused. Only an assertion on the address can tell the two apart.
    const api = fakeApi()

    mount(api)

    expect(api.moderationStreamUrl).toHaveBeenCalledWith(SLUG)
    expect(api.streamUrl).not.toHaveBeenCalled()
    expect(FakeEventSource.instances[0]?.url).toBe(`/api/events/${SLUG}/moderation/stream`)
  })

  it('asks the server nothing when the address carries no event', () => {
    const api = fakeApi()

    const { result } = mountWithoutEvent(api)

    // Not a spinner either: a route with no slug never fetches, so a console that sat
    // on "chargement" for ever would look like a server that never answers.
    expect(result.current.loading).toBe(false)
    expect(api.moderationQueue).not.toHaveBeenCalled()
  })

  it('records no decision when the address carries no event', async () => {
    const api = fakeApi()
    const { result } = mountWithoutEvent(api)

    await act(async () => {
      await result.current.decide('photo-1', 'publish')
    })

    expect(api.moderate).not.toHaveBeenCalled()
  })

  it('records no bulk decision when the address carries no event', async () => {
    const api = fakeApi()
    const { result } = mountWithoutEvent(api)

    await act(async () => {
      await result.current.decideBulk(['photo-1'], 'publish')
    })

    expect(api.moderateBulk).not.toHaveBeenCalled()
  })

  it('asks the server nothing for a bulk decision with nothing selected', async () => {
    const api = fakeApi({ moderationQueue: vi.fn(async () => queueOf([aModerationPhoto()])) })
    const { result } = mount(api)
    await waitFor(() => expect(result.current.items).toHaveLength(1))

    await act(async () => {
      await result.current.decideBulk([], 'publish')
    })

    expect(api.moderateBulk).not.toHaveBeenCalled()
  })

  it('offers an undo for a publish on every console, performed with hide (MOD-1)', async () => {
    /**
     * The desktop console used to offer none, on the argument that the published tile
     * stays on screen with a "retirer" button on it. It does not: the server signals
     * `photo.moderated`, "En attente" reloads, and the tile is gone within the second,
     * so a mis-pressed P left a photo on the wall that only a change of tab could take
     * down. The undo is `hide`, the one reversal that cannot put an unapproved photo on
     * a screen, and it is the same for every caller: there is no option to forget.
     */
    const api = fakeApi({
      moderationQueue: vi.fn(async () => queueOf([aModerationPhoto({ id: 'photo-1' })])),
      moderateBulk: vi.fn(async (): Promise<BulkModerationResponse> => ({
        applied: ['photo-1'],
        skipped: [],
      })),
    })
    const { result } = mount(api)
    await waitFor(() => expect(result.current.items).toHaveLength(1))

    await act(async () => {
      await result.current.decide('photo-1', 'publish')
    })
    expect(api.moderate).toHaveBeenCalledWith(SLUG, 'photo-1', 'publish')
    expect(result.current.canUndo).toBe(true)

    await act(async () => {
      await result.current.undo()
    })

    expect(api.moderateBulk).toHaveBeenCalledWith(SLUG, ['photo-1'], 'hide')
    expect(result.current.canUndo).toBe(false)
  })

  it('offers no undo for a refusal of a waiting photo, whatever else changed', async () => {
    const api = fakeApi({
      moderationQueue: vi.fn(async () => queueOf([aModerationPhoto({ id: 'photo-1' })])),
    })
    const { result } = mount(api)
    await waitFor(() => expect(result.current.items).toHaveLength(1))

    await act(async () => {
      await result.current.decide('photo-1', 'reject')
    })

    expect(result.current.canUndo).toBe(false)
  })

  it('refusing a hidden photo offers no undo, because a refused photo can only return to the wall', async () => {
    const api = fakeApi({
      moderationQueue: vi.fn(async () =>
        queueOf([aModerationPhoto({ id: 'photo-1', status: 'hidden' })]),
      ),
    })
    const { result } = mount(api)
    await waitFor(() => expect(result.current.items).toHaveLength(1))

    await act(async () => {
      await result.current.decide('photo-1', 'reject')
    })

    expect(result.current.canUndo).toBe(false)
    expect(screen.queryByRole('button', { name: fr.moderation.undo })).toBeNull()
  })

  it('offers no undo for a bulk refusal that includes a hidden photo', async () => {
    const api = fakeApi({
      moderationQueue: vi.fn(async () =>
        queueOf([
          aModerationPhoto({ id: 'photo-1', status: 'published' }),
          aModerationPhoto({ id: 'photo-2', status: 'hidden' }),
        ]),
      ),
      moderateBulk: vi.fn(async (): Promise<BulkModerationResponse> => ({
        applied: ['photo-1', 'photo-2'],
        skipped: [],
      })),
    })
    const { result } = mount(api)
    await waitFor(() => expect(result.current.items).toHaveLength(2))

    await act(async () => {
      await result.current.decideBulk(['photo-1', 'photo-2'], 'reject')
    })

    expect(result.current.canUndo).toBe(false)
  })

  it('still offers an undo for the refusal of a published photo', async () => {
    const api = fakeApi({
      moderationQueue: vi.fn(async () =>
        queueOf([aModerationPhoto({ id: 'photo-1', status: 'published' })]),
      ),
    })
    const { result } = mount(api)
    await waitFor(() => expect(result.current.items).toHaveLength(1))

    await act(async () => {
      await result.current.decide('photo-1', 'reject')
    })

    expect(result.current.canUndo).toBe(true)
  })

  it('does not say a decision was undone when the photo is gone, counting what the server applied', async () => {
    // Its guest erased the photo between the refusal and "Annuler": the server names it
    // in neither applied nor skipped. Asked minus skipped is one, and a green
    // "décision annulée" then sits over a photo that no longer exists.
    const api = fakeApi({
      moderationQueue: vi.fn(async () =>
        queueOf([aModerationPhoto({ id: 'photo-1', status: 'published' })]),
      ),
      moderateBulk: vi.fn(async (): Promise<BulkModerationResponse> => ({
        applied: [],
        skipped: [],
      })),
    })
    const { result } = mount(api)
    await waitFor(() => expect(result.current.items).toHaveLength(1))
    await act(async () => {
      await result.current.decide('photo-1', 'reject')
    })

    await act(async () => {
      await result.current.undo()
    })

    expect(api.moderateBulk).toHaveBeenCalledWith(SLUG, ['photo-1'], 'publish')
    expect(screen.queryByText(fr.moderation.undone)).toBeNull()
  })

  it('reads a row without allowedDecisions as one that allows nothing, on the queue and on the strip', async () => {
    const bare = (id: string) => {
      const { allowedDecisions: absent, ...row } = aModerationPhoto({ id, status: 'published' })
      void absent
      return row as unknown as ModerationPhotoDto
    }
    const api = fakeApi({
      moderationQueue: vi.fn(async () => queueOf([bare('photo-1')])),
    })
    const { result } = mountFor(api, SLUG, { onScreenLimit: 6 })
    await waitFor(() => expect(result.current.items).toHaveLength(1))
    await waitFor(() => expect(result.current.onScreen).toHaveLength(1))

    expect(result.current.items[0]?.allowedDecisions).toEqual([])
    expect(result.current.onScreen?.[0]?.allowedDecisions).toEqual([])
  })

  it('does not decide a photo a second moderator has already dealt with', async () => {
    // Two laptops at the same event. The stream carries an invalidation signal, the
    // console refetches, and the tile is gone — so the decision the host was about to
    // take has nothing left to act on and must not be sent a second time.
    let round = 0
    const api = fakeApi({
      moderationQueue: vi.fn(async () => {
        round += 1
        return round === 1 ? queueOf([aModerationPhoto({ id: 'photo-1' })]) : queueOf([])
      }),
    })
    const { result } = mount(api)
    await waitFor(() => expect(result.current.items).toHaveLength(1))

    emitSignal('photo.moderated')
    await waitFor(() => expect(result.current.items).toHaveLength(0))
    await act(async () => {
      await result.current.decide('photo-1', 'publish')
    })

    expect(api.moderate).not.toHaveBeenCalled()
  })

  const settle = (ms: number) =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ms))
    })

  it('coalesces a burst of photo signals into one read', async () => {
    const moderationQueue = vi.fn(async () => queueOf([aModerationPhoto({ id: 'photo-1' })]))
    const { result } = mount(fakeApi({ moderationQueue }))
    await waitFor(() => expect(result.current.items).toHaveLength(1))

    for (let i = 0; i < 10; i += 1) emitSignal('photo.uploaded')
    await settle(MODERATION_READ_DEBOUNCE_MS + 100)

    expect(moderationQueue).toHaveBeenCalledTimes(2)
  })

  it('does not abort the read in flight when another photo signal arrives', async () => {
    const slow = deferred<ModerationQueueResponse>()
    const moderationQueue = vi
      .fn<Api['moderationQueue']>()
      .mockResolvedValueOnce(queueOf([aModerationPhoto({ id: 'photo-1' })]))
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValue(queueOf([aModerationPhoto({ id: 'photo-3' })]))
    const { result } = mount(fakeApi({ moderationQueue }))
    await waitFor(() => expect(result.current.items).toHaveLength(1))
    emitSignal('photo.uploaded')
    await settle(MODERATION_READ_DEBOUNCE_MS + 100)
    emitSignal('photo.uploaded')
    await settle(MODERATION_READ_DEBOUNCE_MS + 100)

    expect(moderationQueue.mock.calls[1]?.[2]?.aborted).toBe(false)
    await act(async () => {
      slow.resolve(queueOf([aModerationPhoto({ id: 'photo-2' })]))
    })

    // The answer of the read that was running is applied, then the one signal that arrived
    // meanwhile is read once: two reads after the first, not one per signal.
    await waitFor(() => expect(result.current.items[0]?.id).toBe('photo-3'))
    expect(moderationQueue).toHaveBeenCalledTimes(3)
  })

  it('leaves the first read running when a photo signal arrives during it', async () => {
    const first = deferred<ModerationQueueResponse>()
    const moderationQueue = vi
      .fn<Api['moderationQueue']>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(queueOf([aModerationPhoto({ id: 'photo-2' })]))
    const { result } = mount(fakeApi({ moderationQueue }))
    await waitFor(() => expect(moderationQueue).toHaveBeenCalledTimes(1))

    emitSignal('photo.uploaded')
    await settle(MODERATION_READ_DEBOUNCE_MS + 100)

    expect(moderationQueue).toHaveBeenCalledTimes(1)
    expect(moderationQueue.mock.calls[0]?.[2]?.aborted).toBe(false)
    await act(async () => {
      first.resolve(queueOf([aModerationPhoto({ id: 'photo-1' })]))
    })
    await waitFor(() => expect(result.current.items[0]?.id).toBe('photo-2'))
    expect(moderationQueue).toHaveBeenCalledTimes(2)
  })

  it('reads nothing for a reaction', async () => {
    const moderationQueue = vi.fn(async () => queueOf([aModerationPhoto({ id: 'photo-1' })]))
    const { result } = mount(fakeApi({ moderationQueue }))
    await waitFor(() => expect(result.current.items).toHaveLength(1))

    emitSignal('reaction.added')
    await settle(MODERATION_READ_DEBOUNCE_MS + 100)

    expect(moderationQueue).toHaveBeenCalledTimes(1)
  })

  it('reads the queue again when the stream reopens after a drop', async () => {
    const moderationQueue = vi.fn(async () => queueOf([aModerationPhoto({ id: 'photo-1' })]))
    const { result } = mount(fakeApi({ moderationQueue }))
    await waitFor(() => expect(result.current.items).toHaveLength(1))
    act(() => FakeEventSource.latest('the console').emitOpen())
    act(() => FakeEventSource.latest('the console').emitDrop())
    // The server forgot what happened while nobody was connected: no signal will tell.
    expect(moderationQueue).toHaveBeenCalledTimes(1)

    act(() => FakeEventSource.latest('the console').emitOpen())

    await waitFor(() => expect(moderationQueue).toHaveBeenCalledTimes(2))
    expect(result.current.connected).toBe(true)
  })

  it('ignores a signal it has never heard of, such as the photo book changing (spec 04)', async () => {
    // `book.changed` travels on this channel and concerns no photograph of the queue: reading the
    // queue again for it would be a request per book state change, and an unknown type from a
    // newer server must never be an error either.
    const moderationQueue = vi.fn(async () => queueOf([aModerationPhoto({ id: 'photo-1' })]))
    const { result } = mount(fakeApi({ moderationQueue }))
    await waitFor(() => expect(result.current.items).toHaveLength(1))

    emitSignal('book.changed')
    emitSignal('something.from.a.newer.server')
    await act(async () => {
      await Promise.resolve()
    })

    expect(moderationQueue).toHaveBeenCalledTimes(1)
    expect(result.current.items).toHaveLength(1)
  })

  it('stays usable after a decision on a photo that has vanished', async () => {
    // The failure this guards against is a wedged console: a decision that returns
    // early must still leave `busy` down, or every later keystroke is ignored and the
    // host reboots the laptop mid-event.
    const api = fakeApi({
      moderationQueue: vi.fn(async () => queueOf([aModerationPhoto({ id: 'photo-2' })])),
    })
    const { result } = mount(api)
    await waitFor(() => expect(result.current.items).toHaveLength(1))

    await act(async () => {
      await result.current.decide('photo-1', 'publish')
    })

    expect(result.current.busy).toBe(false)
    await act(async () => {
      await result.current.decide('photo-2', 'publish')
    })
    expect(api.moderate).toHaveBeenCalledWith(SLUG, 'photo-2', 'publish')
  })

  it('asks the server nothing when every photo in a batch has left the queue', async () => {
    const api = fakeApi({
      moderationQueue: vi.fn(async () => queueOf([aModerationPhoto({ id: 'photo-2' })])),
    })
    const { result } = mount(api)
    await waitFor(() => expect(result.current.items).toHaveLength(1))

    await act(async () => {
      await result.current.decideBulk(['photo-1'], 'publish')
    })

    expect(api.moderateBulk).not.toHaveBeenCalled()
  })

  it('counts a skipped photo it never loaded without moving one that it did', async () => {
    // `skipped` is the server's answer, not an echo of the request. An id the console
    // has never seen still has to be counted out loud, and must not be allowed to
    // silently roll back the tile that happens to be on screen.
    const server = moderationServer([aModerationPhoto({ id: 'photo-1' })], { filtered: false })
    const api = fakeApi({
      ...server,
      moderateBulk: vi.fn(
        async (...args: Parameters<Api['moderateBulk']>): Promise<BulkModerationResponse> => {
          const answer = await server.moderateBulk(...args)
          return { ...answer, skipped: ['photo-oubliee'] }
        },
      ),
    })
    const { result } = mount(api)
    await waitFor(() => expect(result.current.items).toHaveLength(1))

    await act(async () => {
      await result.current.decideBulk(['photo-1'], 'publish')
    })

    expect(screen.getByText(fr.moderation.bulkSkipped(1))).toBeInTheDocument()
    expect(result.current.items[0]?.status).toBe('published')
  })

  it('a failed second group does not roll back the first, and reads the queue again (BUG-06)', async () => {
    // Undoing one bulk publish of a hidden and a refused photo takes two requests: `hide`
    // for the first, `reject` for the second. The first has landed on the server when the
    // second fails; drawing it as not restored lies about a photo already off the wall.
    const rows = [
      aModerationPhoto({ id: 'photo-1', status: 'hidden' }),
      aModerationPhoto({ id: 'photo-2', status: 'rejected' }),
    ]
    const queue = vi.fn(async () => queueOf(rows))
    const moderateBulk = vi.fn(
      async (
        _slug: string,
        ids: readonly string[],
        decision: string,
      ): Promise<BulkModerationResponse> => {
        if (decision === 'reject') throw new ApiError(503, 'unavailable')
        return { applied: [...ids], skipped: [] }
      },
    )
    const api = fakeApi({ moderationQueue: queue, moderateBulk })
    const { result } = mount(api)
    await waitFor(() => expect(result.current.items).toHaveLength(2))
    // Let the decision go through, then hold every further read: only the local state speaks.
    moderateBulk.mockImplementationOnce(async (_slug, ids) => ({ applied: [...ids], skipped: [] }))
    await act(async () => {
      await result.current.decideBulk(['photo-1', 'photo-2'], 'publish')
    })
    queue.mockClear()
    queue.mockImplementation(() => new Promise<ModerationQueueResponse>(() => undefined))

    await act(async () => {
      await result.current.undo()
    })

    const status = (id: string) => result.current.items.find((row) => row.id === id)?.status
    expect(status('photo-1')).toBe('hidden')
    expect(status('photo-2')).toBe('published')
    expect(queue).toHaveBeenCalled()
  })

  it('offers to take back only the photos it can put somewhere', async () => {
    // `applied` can name a photo this console never loaded, and there is no previous
    // status recorded for one. Undoing it would guess — and a guess here is a photo
    // thrown onto the projector with no approval behind it.
    const api = fakeApi({
      moderationQueue: vi.fn(async () =>
        queueOf([aModerationPhoto({ id: 'photo-1', status: 'published' })]),
      ),
      moderateBulk: vi.fn(async (): Promise<BulkModerationResponse> => ({
        applied: ['photo-1', 'photo-oubliee'],
        skipped: [],
      })),
    })
    const { result } = mount(api)
    await waitFor(() => expect(result.current.items).toHaveLength(1))
    await act(async () => {
      await result.current.decideBulk(['photo-1'], 'hide')
    })

    await act(async () => {
      await result.current.undo()
    })

    // The photo it knows about goes back to `published`; the one it does not is left
    // to the server and the next refetch, not guessed at.
    expect(api.moderateBulk).toHaveBeenLastCalledWith(SLUG, ['photo-1'], 'publish')
  })

  it('keeps the answer for the filter the host is on, not the one they left', async () => {
    // The two requests are in flight together on venue Wi-Fi and come back in the
    // wrong order. Without the liveness guard the abandoned tab's photos land under
    // the new label, and publishing something twice starts there.
    const pending = deferred<ModerationQueueResponse>()
    const api = fakeApi({
      moderationQueue: vi.fn(async (_slug: string, query: ModerationQuery = {}) =>
        query.status === 'pending'
          ? pending.promise
          : queueOf([aModerationPhoto({ id: 'photo-published', status: 'published' })]),
      ),
    })
    const { result } = mount(api)

    act(() => result.current.setFilter('published'))
    await waitFor(() => expect(result.current.items).toHaveLength(1))
    await act(async () => {
      pending.resolve(queueOf([aModerationPhoto({ id: 'photo-pending' })]))
      await pending.promise
    })

    expect(result.current.items.map((item) => item.id)).toEqual(['photo-published'])
  })

  it('does not report a failure from the filter the host already left', async () => {
    const pending = deferred<ModerationQueueResponse>()
    const api = fakeApi({
      moderationQueue: vi.fn(async (_slug: string, query: ModerationQuery = {}) =>
        query.status === 'pending' ? pending.promise : queueOf([aModerationPhoto()]),
      ),
    })
    const { result } = mount(api)

    act(() => result.current.setFilter('published'))
    await waitFor(() => expect(result.current.items).toHaveLength(1))
    await act(async () => {
      pending.reject(ApiError.network())
      await pending.promise.catch(() => undefined)
    })

    expect(result.current.error).toBeNull()
  })

  it('does not call an aborted queue request a failure', async () => {
    // The transport rethrows the browser's `AbortError` untouched, so it arrives here
    // like any other rejection. Reported as one, it would put "réessayez" in front of
    // a host whose request was simply superseded.
    const aborted = deferred<ModerationQueueResponse>()
    const api = fakeApi({ moderationQueue: vi.fn(() => aborted.promise) })
    const { result } = mount(api)

    await act(async () => {
      aborted.reject(new DOMException('The user aborted a request.', 'AbortError'))
      await aborted.promise.catch(() => undefined)
    })

    expect(result.current.error).toBeNull()
    // Still waiting, not failed: the console shows the same thing it showed before the
    // superseded request was made.
    expect(result.current.loading).toBe(true)
  })

  it('still reports a failure the transport did not describe as an error', async () => {
    const api = fakeApi({
      moderationQueue: vi.fn(async () => {
        // A transport that rejects with a bare value, not an Error: a proxy error
        // page, or a build older than this one. The guard exists for exactly that.
        throw 'chunk de réponse illisible'
      }),
    })

    const { result } = mount(api)

    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(result.current.loading).toBe(false)
    // An Error the consoles can branch on, carrying what was thrown, and not the bare string.
    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.error?.message).toBe('chunk de réponse illisible')
  })

  it('says a decision failed in French when the failure carries no error code', async () => {
    // Anything that is not an `ApiError` is a bug in this build, and its message is an
    // internal English string. A host mid-event must never be shown one.
    const api = fakeApi({
      moderationQueue: vi.fn(async () => queueOf([aModerationPhoto({ id: 'photo-1' })])),
      moderate: vi.fn(async () => {
        throw new TypeError('Cannot read properties of undefined')
      }),
    })
    const { result } = mount(api)
    await waitFor(() => expect(result.current.items).toHaveLength(1))

    await act(async () => {
      await result.current.decide('photo-1', 'publish')
    })

    expect(screen.getByText(fr.moderation.decisionFailed)).toBeInTheDocument()
    expect(screen.queryByText(/Cannot read properties/)).toBeNull()
  })

  it('says there is nothing to undo, rather than ignoring Z (MOD-1)', async () => {
    const api = fakeApi({
      moderationQueue: vi.fn(async () => queueOf([aModerationPhoto({ id: 'photo-1' })])),
    })
    const { result } = mount(api)
    await waitFor(() => expect(result.current.items).toHaveLength(1))

    await act(async () => {
      await result.current.undo()
    })

    expect(screen.getByText(fr.moderation.nothingToUndo)).toBeInTheDocument()
    expect(api.moderateBulk).not.toHaveBeenCalled()
  })

  it('reads the photos on the wall beside the queue when asked for them (MOD-2)', async () => {
    const onWall = [
      aModerationPhoto({ id: 'wall-2', status: 'published' }),
      aModerationPhoto({ id: 'wall-1', status: 'published' }),
    ]
    const api = fakeApi({
      moderationQueue: vi.fn(async (_slug: string, query: ModerationQuery) =>
        query?.status === 'published'
          ? queueOf(onWall)
          : queueOf([aModerationPhoto({ id: 'photo-1' })]),
      ),
    })

    const { result } = mountFor(api, SLUG, { onScreenLimit: 6 })
    await waitFor(() => expect(result.current.onScreen).toHaveLength(2))

    expect(api.moderationQueue).toHaveBeenCalledWith(
      SLUG,
      { status: 'published', limit: 6 },
      expect.anything(),
    )
    expect(result.current.items.map((item) => item.id)).toEqual(['photo-1'])
  })

  it('asks for no wall strip unless the caller wants one', async () => {
    const api = fakeApi({ moderationQueue: vi.fn(async () => queueOf([])) })

    const { result } = mount(api)
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(api.moderationQueue).toHaveBeenCalledTimes(1)
    expect(result.current.onScreen).toBeNull()
  })

  it('takes a photo off the wall from the strip, and can put it back (MOD-2)', async () => {
    const { endpoints, hold } = heldModerationServer([
      aModerationPhoto({ id: 'wall-1', status: 'published' }),
    ])
    const api = fakeApi(endpoints)
    const { result } = mountFor(api, SLUG, { onScreenLimit: 6 })
    await waitFor(() => expect(result.current.onScreen).toHaveLength(1))

    const answer = hold('moderate')
    let pending: Promise<void> = Promise.resolve()
    act(() => {
      pending = result.current.decide('wall-1', 'hide')
    })

    // While the request is out the strip already shows the photo as taken off the wall,
    // with no decision to press: it is the host's own change, not the server's answer.
    expect(result.current.onScreen?.[0]?.status).toBe('hidden')
    expect(result.current.onScreen?.[0]?.allowedDecisions).toEqual([])

    answer.settle()
    await act(async () => {
      await pending
    })

    expect(api.moderate).toHaveBeenCalledWith(SLUG, 'wall-1', 'hide')
    expect(screen.getByText(fr.moderation.removed(1))).toBeInTheDocument()
    // The server's own strip answers once the decision has landed: the photo has left it.
    await waitFor(() => expect(result.current.onScreen).toHaveLength(0))

    await act(async () => {
      await result.current.undo()
    })

    expect(api.moderateBulk).toHaveBeenCalledWith(SLUG, ['wall-1'], 'publish')
    await waitFor(() => expect(result.current.onScreen?.[0]?.status).toBe('published'))
  })

  it('offers no decision on a photo until the server has said what it may take (MOD-4)', async () => {
    /**
     * A decision is applied locally before the server confirms it, and the list of what a
     * photo may do next is the server's reading of its status machine. This console keeps
     * no copy of that rule, so a locally decided photo shows none rather than the old
     * photo's list under its new status — and a rollback gets the server's own answer back.
     */
    const answer = deferred<void>()
    const api = fakeApi({
      moderationQueue: vi.fn(async () => queueOf([aModerationPhoto({ id: 'photo-1' })])),
      moderate: vi.fn(() => answer.promise),
    })
    const { result } = mount(api)
    await waitFor(() => expect(result.current.items).toHaveLength(1))
    expect(result.current.items[0]?.allowedDecisions).toEqual(['publish', 'reject'])

    let pending: Promise<void> = Promise.resolve()
    act(() => {
      pending = result.current.decide('photo-1', 'publish')
    })
    expect(result.current.items[0]?.status).toBe('published')
    expect(result.current.items[0]?.allowedDecisions).toEqual([])

    answer.reject(new ApiError(409, 'photo.illegalTransition'))
    await act(async () => {
      await pending
    })

    expect(result.current.items[0]?.status).toBe('pending')
    expect(result.current.items[0]?.allowedDecisions).toEqual(['publish', 'reject'])
  })

  describe('a decided photo gets its buttons back from the server, with no stream signal', () => {
    /**
     * A photo decided locally shows no buttons until the server says what it may do next,
     * and that answer used to arrive only with a stream signal. With the stream down — a
     * venue network is exactly where it is — a photo the host had just published showed
     * none, so it could not be taken back off the wall from that tile. The answer is now
     * fetched after the decision lands, and none of these tests emits a signal.
     *
     * The server is a closure over what it last did, as the real one is: the queue answers
     * with the status the decision produced and the decisions that status allows.
     */
    /**
     * The same fixture the console tests use. Unfiltered here: these hooks sit on the
     * default "en attente" tab and look at the tile of a photo that has just left it, which
     * a server honouring the filter would no longer send.
     */
    const serverWith = (initial: ModerationPhotoDto) =>
      fakeApi(moderationServer([initial], { filtered: false }))

    it('offers "hide" on a photo just published', async () => {
      const api = serverWith(aModerationPhoto({ id: 'photo-1' }))
      const { result } = mount(api)
      await waitFor(() => expect(result.current.items).toHaveLength(1))

      await act(async () => {
        await result.current.decide('photo-1', 'publish')
      })

      await waitFor(() =>
        expect(result.current.items[0]?.allowedDecisions).toEqual(['reject', 'hide']),
      )
      expect(result.current.items[0]?.status).toBe('published')
    })

    it('offers the next decisions on photos just decided in bulk', async () => {
      const api = serverWith(aModerationPhoto({ id: 'photo-1' }))
      const { result } = mount(api)
      await waitFor(() => expect(result.current.items).toHaveLength(1))

      await act(async () => {
        await result.current.decideBulk(['photo-1'], 'publish')
      })

      await waitFor(() =>
        expect(result.current.items[0]?.allowedDecisions).toEqual(['reject', 'hide']),
      )
    })

    it('offers the next decisions on a photo whose publication was just taken back', async () => {
      const api = serverWith(aModerationPhoto({ id: 'photo-1' }))
      const { result } = mount(api)
      await waitFor(() => expect(result.current.items).toHaveLength(1))
      await act(async () => {
        await result.current.decide('photo-1', 'publish')
      })
      await waitFor(() => expect(result.current.items[0]?.allowedDecisions).toHaveLength(2))

      await act(async () => {
        await result.current.undo()
      })

      expect(api.moderateBulk).toHaveBeenCalledWith(SLUG, ['photo-1'], 'hide')
      await waitFor(() =>
        expect(result.current.items[0]?.allowedDecisions).toEqual(['publish', 'reject']),
      )
      expect(result.current.items[0]?.status).toBe('hidden')
    })

    it('does not blank the grid while it asks', async () => {
      const api = serverWith(aModerationPhoto({ id: 'photo-1' }))
      const { result } = mount(api)
      await waitFor(() => expect(result.current.items).toHaveLength(1))

      await act(async () => {
        await result.current.decide('photo-1', 'publish')
      })

      expect(result.current.loading).toBe(false)
      expect(result.current.items).toHaveLength(1)
    })
  })

  describe('a read that was asked before a decision does not undo it', () => {
    /**
     * The race: the host decides A, the server answers, and the console reads the queue
     * again (F1). While F1 is on the wire the host decides B, whose request is still out.
     * F1 answers with B as it was, and a console that replaced its rows with the answer
     * would put B's tile back where it started, buttons included - a photo the host has
     * already published, offered for publishing a second time.
     *
     * Every test below holds the read, decides B, releases the read, and looks at B. The
     * server does not honour the tab (`filtered: false`): they look at the tile of a photo
     * that has just been decided, which the real queue would no longer send on this tab.
     */
    const photos = () => [
      aModerationPhoto({ id: 'photo-1' }),
      aModerationPhoto({ id: 'photo-2', authorName: 'Sacha' }),
    ]

    const rowOf = (
      result: { readonly current: { readonly items: readonly ModerationPhotoDto[] } },
      id: string,
    ) => result.current.items.find((item) => item.id === id)

    it('keeps a photo decided while the console re-reads after another decision, then gives it the server’s buttons', async () => {
      const { endpoints, hold } = heldModerationServer(photos(), { filtered: false })
      const api = fakeApi(endpoints)
      const { result } = mount(api)
      await waitFor(() => expect(result.current.items).toHaveLength(2))

      const read = hold('read')
      await act(async () => {
        await result.current.decide('photo-1', 'publish')
      })
      await waitFor(() => expect(api.moderationQueue).toHaveBeenCalledTimes(2))

      const answer = hold('moderate')
      let pending: Promise<void> = Promise.resolve()
      act(() => {
        pending = result.current.decide('photo-2', 'publish')
      })
      await act(async () => {
        read.settle()
        await read.promise
      })

      expect(rowOf(result, 'photo-2')?.status).toBe('published')
      expect(rowOf(result, 'photo-2')?.allowedDecisions).toEqual([])
      // Nothing is waiting any more, and the console does not count it as if it were.
      expect(result.current.pendingCount).toBe(0)
      // The other photo, whose decision had landed, gets the server's buttons from that read.
      expect(rowOf(result, 'photo-1')?.allowedDecisions).toEqual(['reject', 'hide'])

      answer.settle()
      await act(async () => {
        await pending
      })
      await waitFor(() =>
        expect(rowOf(result, 'photo-2')?.allowedDecisions).toEqual(['reject', 'hide']),
      )
      expect(rowOf(result, 'photo-2')?.status).toBe('published')
      expect(result.current.pendingCount).toBe(0)
    })

    it('keeps a photo decided in bulk while the console re-reads after a decision', async () => {
      const { endpoints, hold } = heldModerationServer(photos(), { filtered: false })
      const api = fakeApi(endpoints)
      const { result } = mount(api)
      await waitFor(() => expect(result.current.items).toHaveLength(2))

      const read = hold('read')
      await act(async () => {
        await result.current.decide('photo-1', 'publish')
      })
      await waitFor(() => expect(api.moderationQueue).toHaveBeenCalledTimes(2))

      const answer = hold('moderate')
      let pending: Promise<void> = Promise.resolve()
      act(() => {
        pending = result.current.decideBulk(['photo-2'], 'reject')
      })
      await act(async () => {
        read.settle()
        await read.promise
      })

      expect(rowOf(result, 'photo-2')?.status).toBe('rejected')
      expect(rowOf(result, 'photo-2')?.allowedDecisions).toEqual([])

      answer.settle()
      await act(async () => {
        await pending
      })
      await waitFor(() => expect(rowOf(result, 'photo-2')?.allowedDecisions).toEqual(['publish']))
    })

    it('keeps a photo whose publication is being taken back while a stream signal re-reads', async () => {
      const { endpoints, hold } = heldModerationServer(photos(), { filtered: false })
      const api = fakeApi(endpoints)
      const { result } = mount(api)
      await waitFor(() => expect(result.current.items).toHaveLength(2))
      await act(async () => {
        await result.current.decide('photo-1', 'publish')
      })
      await waitFor(() => expect(rowOf(result, 'photo-1')?.allowedDecisions).toHaveLength(2))

      const answer = hold('moderate')
      let pending: Promise<void> = Promise.resolve()
      act(() => {
        pending = result.current.undo()
      })
      expect(rowOf(result, 'photo-1')?.status).toBe('hidden')

      const read = hold('read')
      emitSignal('photo.moderated')
      await waitFor(() => expect(api.moderationQueue).toHaveBeenCalledTimes(3))
      await act(async () => {
        read.settle()
        await read.promise
      })

      expect(rowOf(result, 'photo-1')?.status).toBe('hidden')
      expect(rowOf(result, 'photo-1')?.allowedDecisions).toEqual([])

      answer.settle()
      await act(async () => {
        await pending
      })
      await waitFor(() =>
        expect(rowOf(result, 'photo-1')?.allowedDecisions).toEqual(['publish', 'reject']),
      )
    })

    it('keeps a photo decided while a stream signal re-reads', async () => {
      const { endpoints, hold } = heldModerationServer(photos(), { filtered: false })
      const api = fakeApi(endpoints)
      const { result } = mount(api)
      await waitFor(() => expect(result.current.items).toHaveLength(2))

      const answer = hold('moderate')
      let pending: Promise<void> = Promise.resolve()
      act(() => {
        pending = result.current.decide('photo-2', 'publish')
      })
      const read = hold('read')
      emitSignal('photo.uploaded')
      await waitFor(() => expect(api.moderationQueue).toHaveBeenCalledTimes(2))
      await act(async () => {
        read.settle()
        await read.promise
      })

      expect(rowOf(result, 'photo-2')?.status).toBe('published')
      expect(rowOf(result, 'photo-2')?.allowedDecisions).toEqual([])
      expect(result.current.pendingCount).toBe(1)

      answer.settle()
      await act(async () => {
        await pending
      })
      await waitFor(() =>
        expect(rowOf(result, 'photo-2')?.allowedDecisions).toEqual(['reject', 'hide']),
      )
    })

    it('does not let a read that was in flight when the request answered undo the decision', async () => {
      // The answer and the read arrive in the same tick, the answer first: nothing has
      // rendered in between, so the read that predates it is still on the wire as far as
      // the console can tell. It has to be written over as well, and the read that
      // follows the answer is the one that hands the buttons back.
      const request = deferred<void>()
      const signalRead = deferred<ModerationQueueResponse>()
      const followingRead = deferred<ModerationQueueResponse>()
      let call = 0
      const api = fakeApi({
        moderate: vi.fn(() => request.promise),
        moderationQueue: vi.fn(async () => {
          call += 1
          if (call === 2) return signalRead.promise
          if (call === 3) return followingRead.promise
          return queueOf([aModerationPhoto({ id: 'photo-1' })])
        }),
      })
      const { result } = mount(api)
      await waitFor(() => expect(result.current.items).toHaveLength(1))

      let pending: Promise<void> = Promise.resolve()
      act(() => {
        pending = result.current.decide('photo-1', 'publish')
      })
      emitSignal('photo.uploaded')
      await waitFor(() => expect(api.moderationQueue).toHaveBeenCalledTimes(2))

      await act(async () => {
        request.resolve()
        signalRead.resolve(queueOf([aModerationPhoto({ id: 'photo-1' })]))
        await pending
      })

      expect(result.current.items[0]?.status).toBe('published')
      expect(result.current.items[0]?.allowedDecisions).toEqual([])

      await waitFor(() => expect(api.moderationQueue).toHaveBeenCalledTimes(3))
      await act(async () => {
        followingRead.resolve(queueOf([aModerationPhoto({ id: 'photo-1', status: 'published' })]))
        await followingRead.promise
      })
      expect(result.current.items[0]?.allowedDecisions).toEqual(['reject', 'hide'])
    })

    it('puts a refused decision back from the server’s own answer, not from the held one', async () => {
      const request = deferred<void>()
      const api = fakeApi({
        moderationQueue: vi.fn(async () => queueOf(photos())),
        moderate: vi.fn(() => request.promise),
      })
      const { result } = mount(api)
      await waitFor(() => expect(result.current.items).toHaveLength(2))

      let pending: Promise<void> = Promise.resolve()
      act(() => {
        pending = result.current.decide('photo-2', 'publish')
      })
      request.reject(new ApiError(409, 'photo.illegalTransition'))
      await act(async () => {
        await pending
      })
      // A read that follows the failure has nothing to write over.
      emitSignal('photo.uploaded')
      await waitFor(() => expect(api.moderationQueue).toHaveBeenCalledTimes(2))

      expect(rowOf(result, 'photo-2')?.status).toBe('pending')
      expect(rowOf(result, 'photo-2')?.allowedDecisions).toEqual(['publish', 'reject'])
    })

    it('puts a skipped photo back even when a read that predates the answer arrives with it', async () => {
      // Same tick, answer first: the read is still stale as far as the console can tell,
      // but the batch refused this photo, so there is no decision of the host's to keep
      // showing over it.
      const request = deferred<BulkModerationResponse>()
      const signalRead = deferred<ModerationQueueResponse>()
      const followingRead = deferred<ModerationQueueResponse>()
      let call = 0
      const api = fakeApi({
        moderateBulk: vi.fn(() => request.promise),
        moderationQueue: vi.fn(async () => {
          call += 1
          if (call === 2) return signalRead.promise
          // Held, so that what the host sees before the read that follows the answer is
          // the read that predates it.
          if (call === 3) return followingRead.promise
          return queueOf([aModerationPhoto({ id: 'photo-1' })])
        }),
      })
      const { result } = mount(api)
      await waitFor(() => expect(result.current.items).toHaveLength(1))

      let pending: Promise<void> = Promise.resolve()
      act(() => {
        pending = result.current.decideBulk(['photo-1'], 'publish')
      })
      emitSignal('photo.uploaded')
      await waitFor(() => expect(api.moderationQueue).toHaveBeenCalledTimes(2))
      await act(async () => {
        request.resolve({ applied: [], skipped: ['photo-1'] })
        signalRead.resolve(queueOf([aModerationPhoto({ id: 'photo-1' })]))
        await pending
      })

      expect(result.current.items[0]?.status).toBe('pending')
      expect(result.current.items[0]?.allowedDecisions).toEqual(['publish', 'reject'])
      followingRead.resolve(queueOf([aModerationPhoto({ id: 'photo-1' })]))
    })

    it('forgets a photo the batch skipped, which the server did not decide', async () => {
      const server = moderationServer(photos(), { skip: ['photo-2'] })
      const api = fakeApi(server)
      const { result } = mount(api)
      await waitFor(() => expect(result.current.items).toHaveLength(2))

      await act(async () => {
        await result.current.decideBulk(['photo-1', 'photo-2'], 'publish')
      })
      await waitFor(() => expect(api.moderationQueue).toHaveBeenCalledTimes(2))

      expect(rowOf(result, 'photo-2')?.status).toBe('pending')
      await waitFor(() =>
        expect(rowOf(result, 'photo-2')?.allowedDecisions).toEqual(['publish', 'reject']),
      )
    })
  })

  describe('a read nobody asked for that fails is not a failure to show', () => {
    /**
     * After a decision, and on every stream signal, the console reads the queue again to
     * learn what the server thinks. When that read fails the rows on screen are still the
     * last good ones, and the host can do nothing about the failure: a "stale queue" line
     * over a tile they are about to decide, or an error page over a phone queue that was
     * "all done", reports a problem with nothing to act on. Only the first read, a tab
     * change and a retry the host asked for may say so.
     */
    it('stays silent when the read after a decision fails', async () => {
      const server = moderationServer([aModerationPhoto({ id: 'photo-1' })])
      let reads = 0
      const api = fakeApi({
        ...server,
        moderationQueue: vi.fn(async (...args: Parameters<Api['moderationQueue']>) => {
          reads += 1
          if (reads > 1) throw ApiError.network()
          return server.moderationQueue(...args)
        }),
      })
      const { result } = mount(api)
      await waitFor(() => expect(result.current.items).toHaveLength(1))

      await act(async () => {
        await result.current.decide('photo-1', 'publish')
      })
      await waitFor(() => expect(api.moderationQueue).toHaveBeenCalledTimes(2))

      expect(result.current.error).toBeNull()
      expect(result.current.items).toHaveLength(1)
      expect(result.current.items[0]?.status).toBe('published')
    })

    it('stays silent when the read after a stream signal fails', async () => {
      let reads = 0
      const api = fakeApi({
        moderationQueue: vi.fn(async () => {
          reads += 1
          if (reads > 1) throw ApiError.network()
          return queueOf([aModerationPhoto({ id: 'photo-1' })])
        }),
      })
      const { result } = mount(api)
      await waitFor(() => expect(result.current.items).toHaveLength(1))

      emitSignal('photo.uploaded')
      await waitFor(() => expect(api.moderationQueue).toHaveBeenCalledTimes(2))

      expect(result.current.error).toBeNull()
      expect(result.current.items).toHaveLength(1)
    })

    it('still reports a failure when the first read of a tab fails', async () => {
      let reads = 0
      const api = fakeApi({
        moderationQueue: vi.fn(async () => {
          reads += 1
          if (reads > 1) throw ApiError.network()
          return queueOf([aModerationPhoto({ id: 'photo-1' })])
        }),
      })
      const { result } = mount(api)
      await waitFor(() => expect(result.current.items).toHaveLength(1))

      act(() => result.current.setFilter('published'))

      await waitFor(() => expect(result.current.error).not.toBeNull())
    })

    it('still reports a failure when the host comes back to a tab it had loaded and its read fails', async () => {
      // The tab change empties the grid, so coming back to "en attente" has nothing left
      // to keep: a swallowed failure would leave a spinner over an empty grid, no retry.
      let reads = 0
      const api = fakeApi({
        moderationQueue: vi.fn(async () => {
          reads += 1
          if (reads > 1) throw ApiError.network()
          return queueOf([aModerationPhoto({ id: 'photo-1' })])
        }),
      })
      const { result } = mount(api)
      await waitFor(() => expect(result.current.items).toHaveLength(1))

      act(() => result.current.setFilter('published'))
      await waitFor(() => expect(result.current.error).not.toBeNull())
      act(() => result.current.setFilter('pending'))

      await waitFor(() => expect(api.moderationQueue).toHaveBeenCalledTimes(3))
      await waitFor(() => expect(result.current.error).not.toBeNull())
      expect(result.current.loading).toBe(false)
    })

    it('still reports a refused session on a read nobody asked for, since every read after it will be refused too', async () => {
      let reads = 0
      const api = fakeApi({
        moderationQueue: vi.fn(async () => {
          reads += 1
          if (reads > 1) throw new ApiError(401, 'auth.required')
          return queueOf([aModerationPhoto({ id: 'photo-1' })])
        }),
      })
      const { result } = mount(api)
      await waitFor(() => expect(result.current.items).toHaveLength(1))

      emitSignal('photo.uploaded')

      await waitFor(() => expect(result.current.error).not.toBeNull())
      expect(result.current.items).toHaveLength(1)
    })

    it('still reports a failure when the host asked for the refresh', async () => {
      let reads = 0
      const api = fakeApi({
        moderationQueue: vi.fn(async () => {
          reads += 1
          if (reads > 1) throw ApiError.network()
          return queueOf([aModerationPhoto({ id: 'photo-1' })])
        }),
      })
      const { result } = mount(api)
      await waitFor(() => expect(result.current.items).toHaveLength(1))

      act(() => result.current.refresh())

      await waitFor(() => expect(result.current.error).not.toBeNull())
      // The photos stay under it: a retry that failed does not empty the grid.
      expect(result.current.items).toHaveLength(1)
    })

    it('stops the spinner of a refresh whose read a signal superseded and that then fails (WEB-HOST-01)', async () => {
      // "Actualiser" arms the loud read and shows the spinner; a decision's own revalidation
      // then starts a new read before that one answers (a stream signal no longer does: it
      // waits for the read in flight). The superseded read is aborted, the new one is a
      // quiet read, and when it fails nothing used to clear the spinner: an emptied phone
      // queue sat on "chargement" with nothing to retry from.
      const superseded = deferred<ModerationQueueResponse>()
      let reads = 0
      const api = fakeApi({
        moderationQueue: vi.fn(async () => {
          reads += 1
          if (reads === 1) return queueOf([aModerationPhoto({ id: 'photo-1' })])
          if (reads === 2) return superseded.promise
          throw ApiError.network()
        }),
      })
      const { result } = mount(api)
      await waitFor(() => expect(result.current.items).toHaveLength(1))
      act(() => result.current.refresh())
      expect(result.current.loading).toBe(true)

      await act(async () => {
        await result.current.decide('photo-1', 'publish')
      })

      await waitFor(() => expect(result.current.loading).toBe(false))
      expect(api.moderationQueue).toHaveBeenCalledTimes(3)
      expect(result.current.items).toHaveLength(1)
    })
  })

  describe('busy counts the decisions in flight', () => {
    const photos = () => [aModerationPhoto({ id: 'photo-1' }), aModerationPhoto({ id: 'photo-2' })]

    it('stays busy until the last of two decisions has answered (WEB-HOST-06)', async () => {
      const { endpoints, hold } = heldModerationServer(photos())
      const api = fakeApi(endpoints)
      const { result } = mount(api)
      await waitFor(() => expect(result.current.items).toHaveLength(2))
      const first = hold('moderate')
      const second = hold('moderate')
      let firstDone: Promise<void> = Promise.resolve()
      let secondDone: Promise<void> = Promise.resolve()
      act(() => {
        firstDone = result.current.decide('photo-1', 'publish')
        secondDone = result.current.decide('photo-2', 'publish')
      })
      expect(result.current.busy).toBe(true)

      await act(async () => {
        first.settle()
        await firstDone
      })
      expect(result.current.busy).toBe(true)

      await act(async () => {
        second.settle()
        await secondDone
      })
      expect(result.current.busy).toBe(false)
    })

    it('stays busy while an undo is in flight after the decision it undoes answered (WEB-HOST-06)', async () => {
      const { endpoints, hold } = heldModerationServer(photos())
      const api = fakeApi(endpoints)
      const { result } = mount(api)
      await waitFor(() => expect(result.current.items).toHaveLength(2))
      await act(async () => {
        await result.current.decide('photo-1', 'publish')
      })
      const undoAnswer = hold('moderate')
      const secondAnswer = hold('moderate')
      let undone: Promise<void> = Promise.resolve()
      let decided: Promise<void> = Promise.resolve()
      act(() => {
        undone = result.current.undo()
        decided = result.current.decide('photo-2', 'publish')
      })

      await act(async () => {
        secondAnswer.settle()
        await decided
      })
      expect(result.current.busy).toBe(true)

      await act(async () => {
        undoAnswer.settle()
        await undone
      })
      expect(result.current.busy).toBe(false)
    })
  })

  describe('the highlight toggle (WEB-HOST-14)', () => {
    const published = () => [
      aModerationPhoto({ id: 'photo-1', status: 'published', highlighted: false }),
    ]

    it('is not undone by a read that started before the toggle and answers after it', async () => {
      const stale = deferred<ModerationQueueResponse>()
      let reads = 0
      const api = fakeApi({
        moderationQueue: vi.fn(async () => {
          reads += 1
          if (reads === 2) return stale.promise
          return queueOf(published())
        }),
      })
      const { result } = mount(api)
      await waitFor(() => expect(result.current.items).toHaveLength(1))
      emitSignal('photo.uploaded')
      await waitFor(() => expect(api.moderationQueue).toHaveBeenCalledTimes(2))

      await act(async () => {
        await result.current.toggleHighlight('photo-1')
      })
      expect(result.current.items[0]?.highlighted).toBe(true)
      await act(async () => {
        stale.resolve(queueOf(published()))
        await stale.promise
      })

      expect(result.current.items[0]?.highlighted).toBe(true)
    })

    it('shows the server on a read that started after the toggle was answered', async () => {
      let reads = 0
      const api = fakeApi({
        moderationQueue: vi.fn(async () => {
          reads += 1
          return queueOf(
            reads === 1
              ? published()
              : [aModerationPhoto({ id: 'photo-1', status: 'published', highlighted: false })],
          )
        }),
      })
      const { result } = mount(api)
      await waitFor(() => expect(result.current.items).toHaveLength(1))
      await act(async () => {
        await result.current.toggleHighlight('photo-1')
      })
      expect(result.current.items[0]?.highlighted).toBe(true)

      emitSignal('photo.uploaded')
      await waitFor(() => expect(api.moderationQueue).toHaveBeenCalledTimes(2))

      await waitFor(() => expect(result.current.items[0]?.highlighted).toBe(false))
    })

    it('ignores a second press while the first is still on the wire', async () => {
      const answer = deferred<undefined>()
      const api = fakeApi({
        moderationQueue: vi.fn(async () => queueOf(published())),
        highlightPhoto: vi.fn(() => answer.promise),
      })
      const { result } = mount(api)
      await waitFor(() => expect(result.current.items).toHaveLength(1))
      let first: Promise<void> = Promise.resolve()
      act(() => {
        first = result.current.toggleHighlight('photo-1')
      })

      await act(async () => {
        await result.current.toggleHighlight('photo-1')
      })

      expect(api.highlightPhoto).toHaveBeenCalledTimes(1)
      expect(api.unhighlightPhoto).not.toHaveBeenCalled()
      expect(result.current.items[0]?.highlighted).toBe(true)

      await act(async () => {
        answer.resolve(undefined)
        await first
      })
    })

    it('puts the old value back when the request fails', async () => {
      const api = fakeApi({
        moderationQueue: vi.fn(async () => queueOf(published())),
        highlightPhoto: vi.fn(async () => {
          throw ApiError.network()
        }),
      })
      const { result } = mount(api)
      await waitFor(() => expect(result.current.items).toHaveLength(1))

      await act(async () => {
        await result.current.toggleHighlight('photo-1')
      })

      expect(result.current.items[0]?.highlighted).toBe(false)
    })

    it('lets the host press again after a failed request', async () => {
      const api = fakeApi({
        moderationQueue: vi.fn(async () => queueOf(published())),
        highlightPhoto: vi
          .fn<Api['highlightPhoto']>()
          .mockRejectedValueOnce(ApiError.network())
          .mockResolvedValue(undefined),
      })
      const { result } = mount(api)
      await waitFor(() => expect(result.current.items).toHaveLength(1))
      await act(async () => {
        await result.current.toggleHighlight('photo-1')
      })

      await act(async () => {
        await result.current.toggleHighlight('photo-1')
      })

      expect(api.highlightPhoto).toHaveBeenCalledTimes(2)
      expect(result.current.items[0]?.highlighted).toBe(true)
    })
  })
})
