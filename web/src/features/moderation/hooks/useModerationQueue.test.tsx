import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, screen, waitFor } from '@testing-library/react'
import { ApiProvider } from '../../../app/ApiProvider'
import { ToastProvider } from '../../../design-system/components/ToastProvider'
import { ApiError } from '../../../lib/http'
import { fr } from '../../../lib/i18n/fr'
import { aModerationPhoto, fakeApi } from '../../../testing/renderWithProviders'
import { useModerationQueue } from './useModerationQueue'
import type { ModerationQueueOptions } from './useModerationQueue'
import type { ReactNode } from 'react'
import type { Api } from '../../../lib/api/client'
import type {
  BulkModerationResponse,
  ModerationPhotoDto,
  ModerationQueueResponse,
} from '../../../lib/api/dto'

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

/** What the server sends when something in the event changed. Never data. */
const emitSignal = (type: string): void => {
  const instance = FakeEventSource.instances[FakeEventSource.instances.length - 1]
  if (instance === undefined) throw new Error('the console opened no stream')
  act(() => {
    instance.dispatchEvent(new MessageEvent('change', { data: JSON.stringify({ type }) }))
  })
}

const SLUG = 'camille-et-sacha'

const queueOf = (
  items: readonly ModerationPhotoDto[],
  pendingCount = items.filter((item) => item.status === 'pending').length,
): ModerationQueueResponse => ({ items, pendingCount, nextCursor: null })

/** A promise the test settles by hand, to hold a fetch open across another render. */
const deferred = <T,>() => {
  let settle: (value: T) => void = () => {}
  let fail: (cause: unknown) => void = () => {}
  const promise = new Promise<T>((resolve, reject) => {
    settle = resolve
    fail = reject
  })
  return { promise, settle: (value: T) => settle(value), fail: (cause: unknown) => fail(cause) }
}

const mountFor = (api: Api, slug: string | undefined, options: ModerationQueueOptions = {}) => {
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <ApiProvider api={api}>
      <ToastProvider>{children}</ToastProvider>
    </ApiProvider>
  )
  return renderHook(() => useModerationQueue(slug, options), { wrapper })
}

const mount = (api: Api) => mountFor(api, SLUG)

/** The phone console's queue: the one caller that asks for a publish to be reversible. */
const mountWithUndoOfPublish = (api: Api) => mountFor(api, SLUG, { undoOfPublish: 'hide' })

/** `/admin/events//moderation`, or a route pattern that stopped carrying the slug. */
const mountWithoutEvent = (api: Api) => mountFor(api, undefined)

describe('useModerationQueue', () => {
  beforeEach(() => {
    FakeEventSource.instances = []
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

  it('offers no undo for a publish, unless the caller asked for one', async () => {
    /**
     * The invariant the phone console's `undoOfPublish` option must not have broken.
     *
     * A photo that was awaiting a decision has no status any verb puts it back into, so
     * the desktop console offers nothing — and it must keep offering nothing by default,
     * because the tempting substitute for a *refusal* is `publish`, which would project
     * a photo the host has just turned down. The option is opt-in for exactly that
     * reason, and a default that quietly acquired an undo is the shape that regression
     * would take.
     */
    const api = fakeApi({
      moderationQueue: vi.fn(async () => queueOf([aModerationPhoto({ id: 'photo-1' })])),
    })
    const { result } = mount(api)
    await waitFor(() => expect(result.current.items).toHaveLength(1))

    await act(async () => {
      await result.current.decide('photo-1', 'publish')
    })

    expect(api.moderate).toHaveBeenCalledWith(SLUG, 'photo-1', 'publish')
    expect(result.current.canUndo).toBe(false)
  })

  it('offers an undo for a publish when the caller supplies the decision to use', async () => {
    // The phone console's side of the same rule: it has no grid to press "retirer de
    // l'écran" on, so the offer exists there and is performed with `hide` — the one
    // reversal that cannot put an unapproved photo on a screen.
    const api = fakeApi({
      moderationQueue: vi.fn(async () => queueOf([aModerationPhoto({ id: 'photo-1' })])),
      moderateBulk: vi.fn(
        async (): Promise<BulkModerationResponse> => ({ applied: ['photo-1'], skipped: [] }),
      ),
    })
    const { result } = mountWithUndoOfPublish(api)
    await waitFor(() => expect(result.current.items).toHaveLength(1))

    await act(async () => {
      await result.current.decide('photo-1', 'publish')
    })
    expect(result.current.canUndo).toBe(true)

    await act(async () => {
      await result.current.undo()
    })

    expect(api.moderateBulk).toHaveBeenCalledWith(SLUG, ['photo-1'], 'hide')
    // Never `publish` on a refusal, whatever the option says: the dangerous direction
    // stays closed.
    expect(result.current.canUndo).toBe(false)
  })

  it('offers no undo for a refusal even when the caller asked for one', async () => {
    const api = fakeApi({
      moderationQueue: vi.fn(async () => queueOf([aModerationPhoto({ id: 'photo-1' })])),
    })
    const { result } = mountWithUndoOfPublish(api)
    await waitFor(() => expect(result.current.items).toHaveLength(1))

    await act(async () => {
      await result.current.decide('photo-1', 'reject')
    })

    expect(result.current.canUndo).toBe(false)
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
    const api = fakeApi({
      moderationQueue: vi.fn(async () => queueOf([aModerationPhoto({ id: 'photo-1' })])),
      moderateBulk: vi.fn(async (): Promise<BulkModerationResponse> => ({
        applied: ['photo-1'],
        skipped: ['photo-oubliee'],
      })),
    })
    const { result } = mount(api)
    await waitFor(() => expect(result.current.items).toHaveLength(1))

    await act(async () => {
      await result.current.decideBulk(['photo-1'], 'publish')
    })

    expect(screen.getByText(fr.moderation.bulkSkipped(1))).toBeInTheDocument()
    expect(result.current.items[0]?.status).toBe('published')
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
      pending.settle(queueOf([aModerationPhoto({ id: 'photo-pending' })]))
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
      pending.fail(ApiError.network())
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
      aborted.fail(new DOMException('The user aborted a request.', 'AbortError'))
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
})
