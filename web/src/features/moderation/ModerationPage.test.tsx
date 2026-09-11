import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ModerationPage } from './ModerationPage'
import { aModerationPhoto, fakeApi, renderWithProviders } from '../../testing/renderWithProviders'
import { ApiError } from '../../lib/http'
import { fr } from '../../lib/i18n/fr'
import type { Api } from '../../lib/api/client'
import type { ModerationPhotoDto, ModerationQueueResponse } from '../../lib/api/dto'

/**
 * The console, from the host's side of the laptop.
 *
 * The stream is driven through a stand-in for `EventSource` rather than a real
 * connection: what these tests are about is that a signal makes the console refetch,
 * not that a socket can be opened. `useEventStream` owns the transport and has its own
 * test.
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

const stream = (): FakeEventSource => {
  const instance = FakeEventSource.instances[FakeEventSource.instances.length - 1]
  if (instance === undefined) throw new Error('the console opened no stream')
  return instance
}

/** What the server sends when something in the event changed. Never data. */
const emitSignal = (type: string): void => {
  act(() => {
    stream().dispatchEvent(new MessageEvent('change', { data: JSON.stringify({ type }) }))
  })
}

const emitConnected = (): void => {
  act(() => {
    stream().dispatchEvent(new Event('open'))
  })
}

const SLUG = 'camille-et-sacha'

const queueOf = (
  items: readonly ModerationPhotoDto[],
  pendingCount = items.filter((item) => item.status === 'pending').length,
): ModerationQueueResponse => ({ items, pendingCount, nextCursor: null })

const lea = (overrides: Partial<ModerationPhotoDto> = {}): ModerationPhotoDto =>
  aModerationPhoto({ id: 'photo-1', authorName: 'Léa', caption: 'Les confettis', ...overrides })

const sacha = (overrides: Partial<ModerationPhotoDto> = {}): ModerationPhotoDto =>
  aModerationPhoto({ id: 'photo-2', authorName: 'Sacha', caption: null, ...overrides })

const renderConsole = (api: Api) =>
  renderWithProviders(<ModerationPage />, {
    api,
    route: `/admin/events/${SLUG}/moderation`,
    path: '/admin/events/:slug/moderation',
  })

const cardOf = (author: string): HTMLElement =>
  screen.getByRole('article', { name: fr.moderation.photoOf(author) })

describe('ModerationPage', () => {
  beforeEach(() => {
    FakeEventSource.instances = []
    vi.stubGlobal('EventSource', FakeEventSource)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('shows a wait while the first queue is loading', () => {
    const api = fakeApi({
      moderationQueue: vi.fn(() => new Promise<ModerationQueueResponse>(() => {})),
    })

    renderConsole(api)

    expect(screen.getByText(fr.app.loading)).toBeInTheDocument()
    expect(screen.queryByRole('article')).toBeNull()
  })

  it('says the queue is empty and that no reload is needed', async () => {
    // 1.0 rendered a bare empty grid here, which is indistinguishable from a screen
    // that failed to load — and a host with a projector waiting reloads, then reboots.
    renderConsole(fakeApi())

    expect(await screen.findByText(fr.moderation.empty)).toBeInTheDocument()
    expect(screen.getByText(fr.moderation.emptyHint)).toBeInTheDocument()
  })

  it('offers a retry when the queue could not be loaded', async () => {
    const api = fakeApi({
      moderationQueue: vi.fn(async () => {
        throw ApiError.network()
      }),
    })
    renderConsole(api)

    expect(await screen.findByText(fr.moderation.loadFailed)).toBeInTheDocument()
    expect(screen.getByText(fr.errors.network)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: fr.app.retry }))

    expect(api.moderationQueue).toHaveBeenCalledTimes(2)
  })

  it('lists what has arrived, with the caption, the author and the status as a word', async () => {
    const api = fakeApi({ moderationQueue: vi.fn(async () => queueOf([lea()])) })
    renderConsole(api)

    const card = await screen.findByTestId('moderation-card')

    expect(within(card).getByText('Les confettis')).toBeInTheDocument()
    expect(within(card).getByText(fr.moderation.by('Léa'))).toBeInTheDocument()
    // Colour is never the only signal: the border tint is paired with this word and
    // with the Badge's glyph, for a red-green colourblind host under stage lighting.
    expect(within(card).getByText(fr.moderation.statePending)).toBeInTheDocument()
    expect(screen.getByText(fr.moderation.pending(1))).toBeInTheDocument()
  })

  it('loads thumbnails lazily at a known size, so the grid does not reflow', async () => {
    const api = fakeApi({ moderationQueue: vi.fn(async () => queueOf([lea()])) })
    renderConsole(api)
    await screen.findByTestId('moderation-card')

    const thumbnail = screen.getByRole('button', { name: fr.moderation.enlargePhoto('Léa') })
    const image = thumbnail.querySelector('img')
    if (image === null) throw new Error('the tile rendered no thumbnail')

    expect(image).toHaveAttribute('loading', 'lazy')
    expect(image).toHaveAttribute('decoding', 'async')
    expect(image).toHaveAttribute('width', '2560')
    expect(image).toHaveAttribute('height', '1707')
  })

  it('names every decision after the photo it acts on', async () => {
    // A screen-reader user working a queue of a hundred has to know which photo a
    // button belongs to. 1.0 shipped four unlabelled icon buttons per tile.
    const api = fakeApi({ moderationQueue: vi.fn(async () => queueOf([lea()])) })
    renderConsole(api)
    const card = await screen.findByTestId('moderation-card')

    expect(
      within(card).getByRole('button', { name: fr.moderation.publishPhoto('Léa') }),
    ).toBeInTheDocument()
    expect(
      within(card).getByRole('button', { name: fr.moderation.rejectPhoto('Léa') }),
    ).toBeInTheDocument()
    expect(
      within(card).getByRole('button', { name: fr.moderation.hidePhoto('Léa') }),
    ).toBeInTheDocument()
    expect(
      within(card).getByRole('checkbox', { name: fr.moderation.selectPhoto('Léa') }),
    ).toBeInTheDocument()
  })

  it('names the decisions on an anonymous guest’s photo without inventing a name', async () => {
    const api = fakeApi({
      moderationQueue: vi.fn(async () => queueOf([lea({ authorName: null })])),
    })
    renderConsole(api)
    const card = await screen.findByTestId('moderation-card')

    expect(within(card).getByText(fr.moderation.byAnonymous)).toBeInTheDocument()
    expect(
      within(card).getByRole('button', {
        name: fr.moderation.publishPhoto(fr.moderation.anonymousInName),
      }),
    ).toBeInTheDocument()
  })

  it('shows a decision before the server confirms it', async () => {
    const api = fakeApi({ moderationQueue: vi.fn(async () => queueOf([lea()])) })
    renderConsole(api)
    const card = await screen.findByTestId('moderation-card')

    await userEvent.click(
      within(card).getByRole('button', { name: fr.moderation.publishPhoto('Léa') }),
    )

    expect(api.moderate).toHaveBeenCalledWith(SLUG, 'photo-1', 'publish')
    expect(within(card).getByText(fr.moderation.statePublished)).toBeInTheDocument()
    // The count is the number the host glances at; it has to move with the decision.
    expect(screen.getByText(fr.moderation.pending(0))).toBeInTheDocument()
  })

  it('puts the photo back when the server refuses the decision', async () => {
    let refuse: ((cause: unknown) => void) | undefined
    const api = fakeApi({
      moderationQueue: vi.fn(async () => queueOf([lea()])),
      moderate: vi.fn(
        () =>
          new Promise<void>((_resolve, reject) => {
            refuse = reject
          }),
      ),
    })
    renderConsole(api)
    const card = await screen.findByTestId('moderation-card')
    await userEvent.click(
      within(card).getByRole('button', { name: fr.moderation.publishPhoto('Léa') }),
    )
    expect(within(card).getByText(fr.moderation.statePublished)).toBeInTheDocument()

    await act(async () => {
      refuse?.(new ApiError(409, 'photo.illegalTransition'))
    })

    expect(within(card).getByText(fr.moderation.statePending)).toBeInTheDocument()
    expect(screen.getByText(fr.moderation.pending(1))).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(fr.errors['photo.illegalTransition'])
  })

  it('undoes a decision, putting the photo back where it was', async () => {
    const api = fakeApi({
      moderationQueue: vi.fn(async () => queueOf([lea({ status: 'published' })])),
      moderateBulk: vi.fn(async () => ({ applied: ['photo-1'], skipped: [] })),
    })
    renderConsole(api)
    const card = await screen.findByTestId('moderation-card')
    await userEvent.click(
      within(card).getByRole('button', { name: fr.moderation.hidePhoto('Léa') }),
    )
    expect(await within(card).findByText(fr.moderation.stateHidden)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: fr.moderation.undo }))

    // The previous status is the client's to keep and to supply: the server records
    // what a decision moved a photo to, never where it came from.
    expect(api.moderateBulk).toHaveBeenCalledWith(SLUG, ['photo-1'], 'publish')
    expect(await within(card).findByText(fr.moderation.statePublished)).toBeInTheDocument()
    expect(screen.getByText(fr.moderation.undone)).toBeInTheDocument()
  })

  it('undoes a bulk reject fired by accident', async () => {
    const api = fakeApi({
      moderationQueue: vi.fn(async () =>
        queueOf([lea({ status: 'published' }), sacha({ status: 'published' })], 0),
      ),
      moderateBulk: vi.fn(async () => ({ applied: ['photo-1', 'photo-2'], skipped: [] })),
    })
    renderConsole(api)
    await screen.findAllByTestId('moderation-card')
    await userEvent.click(screen.getByRole('button', { name: fr.moderation.selectAll }))

    await userEvent.click(screen.getByRole('button', { name: fr.moderation.bulkReject(2) }))
    expect(await within(cardOf('Léa')).findByText(fr.moderation.stateRejected)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: fr.moderation.undo }))

    expect(api.moderateBulk).toHaveBeenLastCalledWith(SLUG, ['photo-1', 'photo-2'], 'publish')
    expect(await within(cardOf('Léa')).findByText(fr.moderation.statePublished)).toBeInTheDocument()
    expect(within(cardOf('Sacha')).getByText(fr.moderation.statePublished)).toBeInTheDocument()
  })

  it('offers no undo for a decision that cannot be reversed', async () => {
    // Nothing puts a photo back to `pending`: no decision verb produces that status.
    // Offering "annuler" and then publishing an unapproved photo instead would break
    // the one promise the host is given.
    const api = fakeApi({ moderationQueue: vi.fn(async () => queueOf([lea()])) })
    renderConsole(api)
    const card = await screen.findByTestId('moderation-card')

    await userEvent.click(
      within(card).getByRole('button', { name: fr.moderation.rejectPhoto('Léa') }),
    )

    expect(await screen.findByText(fr.moderation.refused(1))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: fr.moderation.undo })).toBeNull()
  })

  it('keeps the undo reachable while the host looks up at the projector', async () => {
    /**
     * The one test in this file that drives the DOM directly instead of through
     * `userEvent`, and the only one with no `findBy`.
     *
     * Testing Library's async helpers decide whether the clock is faked by looking for
     * a `jest` global, which vitest does not define — so under fake timers they wait
     * on a `setTimeout` that will never fire and the test hangs rather than failing.
     * Only `setTimeout` is faked here for the same reason: faking the whole clock takes
     * `setImmediate` with it, which is how React's `act` drains its queue.
     */
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const api = fakeApi({
      moderationQueue: vi.fn(async () => queueOf([lea({ status: 'published' })])),
      moderateBulk: vi.fn(async () => ({ applied: ['photo-1'], skipped: [] })),
    })
    renderConsole(api)
    await act(async () => {})
    const card = screen.getByTestId('moderation-card')

    await act(async () => {
      within(card)
        .getByRole('button', { name: fr.moderation.hidePhoto('Léa') })
        .click()
    })
    expect(screen.getByRole('button', { name: fr.moderation.undo })).toBeInTheDocument()

    // Past the four seconds an ordinary notice lives. A host presses a key, looks up at
    // the screen in the room, looks back — an undo that expired in between is worse
    // than no undo at all, because they believed the decision was reversible.
    act(() => {
      vi.advanceTimersByTime(5_000)
    })

    expect(screen.getByRole('button', { name: fr.moderation.undo })).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(5_000)
    })

    expect(screen.queryByRole('button', { name: fr.moderation.undo })).toBeNull()
  })

  it('reports the photos a batch left alone', async () => {
    const api = fakeApi({
      moderationQueue: vi.fn(async () => queueOf([lea({ status: 'published' }), sacha()])),
      // `hidden` is unreachable from `pending`, so the batch skips Sacha's photo
      // instead of failing all of it.
      moderateBulk: vi.fn(async () => ({ applied: ['photo-1'], skipped: ['photo-2'] })),
    })
    renderConsole(api)
    await screen.findAllByTestId('moderation-card')
    await userEvent.click(screen.getByRole('checkbox', { name: fr.moderation.selectPhoto('Léa') }))
    await userEvent.click(
      screen.getByRole('checkbox', { name: fr.moderation.selectPhoto('Sacha') }),
    )
    expect(screen.getByText(fr.moderation.selected(2))).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: fr.moderation.bulkHide(2) }))

    expect(api.moderateBulk).toHaveBeenCalledWith(SLUG, ['photo-1', 'photo-2'], 'hide')
    expect(await screen.findByText(fr.moderation.bulkSkipped(1))).toBeInTheDocument()
    expect(within(cardOf('Léa')).getByText(fr.moderation.stateHidden)).toBeInTheDocument()
    // The optimism was wrong for the skipped one, so it goes back where it was.
    expect(within(cardOf('Sacha')).getByText(fr.moderation.statePending)).toBeInTheDocument()
  })

  it('refetches the queue when the stream says a photo arrived', async () => {
    let answered = 0
    const api = fakeApi({
      moderationQueue: vi.fn(async () => {
        answered += 1
        return answered === 1 ? queueOf([lea()]) : queueOf([lea(), sacha()])
      }),
    })
    renderConsole(api)
    await screen.findByTestId('moderation-card')
    expect(screen.getAllByTestId('moderation-card')).toHaveLength(1)

    // A signal, not a payload: the console refetches rather than trusting a push.
    emitSignal('photo.uploaded')

    await waitFor(() => expect(screen.getAllByTestId('moderation-card')).toHaveLength(2))
    expect(api.moderationQueue).toHaveBeenCalledTimes(2)
  })

  it('ignores a burst of reactions, which cannot change the queue', async () => {
    const api = fakeApi({ moderationQueue: vi.fn(async () => queueOf([lea()])) })
    renderConsole(api)
    await screen.findByTestId('moderation-card')

    emitSignal('reaction.added')

    // A room full of guests tapping hearts would otherwise refetch the console once
    // per tap, on the laptop with the least time to spare.
    expect(api.moderationQueue).toHaveBeenCalledTimes(1)
  })

  it('says when it has stopped being told about new photos', async () => {
    const api = fakeApi({ moderationQueue: vi.fn(async () => queueOf([lea()])) })
    renderConsole(api)
    await screen.findByTestId('moderation-card')

    expect(screen.getByText(fr.moderation.liveLost)).toBeInTheDocument()

    emitConnected()

    expect(screen.getByText(fr.moderation.live)).toBeInTheDocument()
  })

  it('asks the server for the filter the host chose', async () => {
    const api = fakeApi({ moderationQueue: vi.fn(async () => queueOf([])) })
    renderConsole(api)
    await screen.findByText(fr.moderation.empty)

    await userEvent.click(screen.getByRole('button', { name: fr.moderation.filterRejected }))

    expect(api.moderationQueue).toHaveBeenLastCalledWith(
      SLUG,
      { status: 'rejected' },
      expect.anything(),
    )
    expect(await screen.findByText(fr.moderation.emptyFiltered)).toBeInTheDocument()
  })

  it('opens a photo full size and walks the queue with the arrow keys', async () => {
    const api = fakeApi({ moderationQueue: vi.fn(async () => queueOf([lea(), sacha()])) })
    renderConsole(api)
    await screen.findAllByTestId('moderation-card')

    await userEvent.click(screen.getByRole('button', { name: fr.moderation.enlargePhoto('Léa') }))
    const dialog = await screen.findByRole('dialog')

    expect(
      within(dialog).getByAltText(fr.moderation.photoAltWithCaption('Les confettis', 'Léa')),
    ).toBeInTheDocument()

    await userEvent.keyboard('{ArrowRight}')

    expect(
      within(dialog).getByRole('heading', { name: fr.moderation.photoOf('Sacha') }),
    ).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('heading', { name: fr.moderation.photoOf('Sacha') })).toBeNull()
  })

  it('decides from the lightbox, on the photo the host is looking at', async () => {
    const api = fakeApi({ moderationQueue: vi.fn(async () => queueOf([lea(), sacha()])) })
    renderConsole(api)
    await screen.findAllByTestId('moderation-card')
    await userEvent.click(screen.getByRole('button', { name: fr.moderation.enlargePhoto('Léa') }))
    const dialog = await screen.findByRole('dialog')

    await userEvent.click(
      within(dialog).getByRole('button', { name: fr.moderation.publishPhoto('Léa') }),
    )

    expect(api.moderate).toHaveBeenCalledWith(SLUG, 'photo-1', 'publish')
    expect(screen.queryByRole('heading', { name: fr.moderation.photoOf('Léa') })).toBeNull()
  })

  it('walks the queue and decides from the keyboard alone', async () => {
    const api = fakeApi({ moderationQueue: vi.fn(async () => queueOf([lea(), sacha()])) })
    renderConsole(api)
    await screen.findAllByTestId('moderation-card')

    await userEvent.keyboard('j')
    expect(cardOf('Léa')).toHaveFocus()

    await userEvent.keyboard('p')

    expect(api.moderate).toHaveBeenCalledWith(SLUG, 'photo-1', 'publish')
    // The queue moves on with the host, so the next decision needs no navigation.
    expect(cardOf('Sacha')).toHaveFocus()
  })

  it('refuses the photo under the keyboard on R and takes it off the screen on H', async () => {
    const api = fakeApi({
      moderationQueue: vi.fn(async () => queueOf([lea(), sacha({ status: 'published' })])),
    })
    renderConsole(api)
    await screen.findAllByTestId('moderation-card')

    await userEvent.keyboard('j')
    await userEvent.keyboard('r')
    expect(api.moderate).toHaveBeenLastCalledWith(SLUG, 'photo-1', 'reject')

    await userEvent.keyboard('h')
    expect(api.moderate).toHaveBeenLastCalledWith(SLUG, 'photo-2', 'hide')
  })

  it('selects with Space and acts on the whole selection', async () => {
    const api = fakeApi({
      moderationQueue: vi.fn(async () => queueOf([lea(), sacha()])),
      moderateBulk: vi.fn(async () => ({ applied: ['photo-1', 'photo-2'], skipped: [] })),
    })
    renderConsole(api)
    await screen.findAllByTestId('moderation-card')

    await userEvent.keyboard('j')
    await userEvent.keyboard(' ')
    await userEvent.keyboard('j')
    await userEvent.keyboard(' ')
    expect(screen.getByText(fr.moderation.selected(2))).toBeInTheDocument()

    await userEvent.keyboard('p')

    expect(api.moderateBulk).toHaveBeenCalledWith(SLUG, ['photo-1', 'photo-2'], 'publish')
  })

  it('selects nothing on Space with no photo under the keyboard', async () => {
    // A host who has only scrolled has nothing focused. Space must not pick whichever
    // photo happens to be first: the next P would then act on a tile they never looked
    // at, which is how something unwanted reaches the projector.
    const api = fakeApi({ moderationQueue: vi.fn(async () => queueOf([lea(), sacha()])) })
    renderConsole(api)
    await screen.findAllByTestId('moderation-card')

    await userEvent.keyboard(' ')

    expect(screen.queryByText(fr.moderation.selected(1))).toBeNull()
    expect(
      screen.getByRole('checkbox', { name: fr.moderation.selectPhoto('Léa') }),
    ).not.toBeChecked()
  })

  it('drops the selection on Escape', async () => {
    const api = fakeApi({ moderationQueue: vi.fn(async () => queueOf([lea()])) })
    renderConsole(api)
    await screen.findByTestId('moderation-card')

    await userEvent.keyboard('j')
    await userEvent.keyboard(' ')
    expect(screen.getByText(fr.moderation.selected(1))).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')

    expect(screen.queryByText(fr.moderation.selected(1))).toBeNull()
  })

  it('undoes the last decision on Z', async () => {
    const api = fakeApi({
      moderationQueue: vi.fn(async () => queueOf([lea({ status: 'published' })])),
      moderateBulk: vi.fn(async () => ({ applied: ['photo-1'], skipped: [] })),
    })
    renderConsole(api)
    const card = await screen.findByTestId('moderation-card')
    await userEvent.click(
      within(card).getByRole('button', { name: fr.moderation.hidePhoto('Léa') }),
    )
    expect(await within(card).findByText(fr.moderation.stateHidden)).toBeInTheDocument()

    await userEvent.keyboard('z')

    expect(api.moderateBulk).toHaveBeenCalledWith(SLUG, ['photo-1'], 'publish')
    expect(await within(card).findByText(fr.moderation.statePublished)).toBeInTheDocument()
  })

  it('does nothing on Z when there is no decision to take back', async () => {
    // Z is the one shortcut a host presses reflexively, including before they have
    // decided anything. It must not re-send the last batch, and it must not claim an
    // undo happened.
    const api = fakeApi({ moderationQueue: vi.fn(async () => queueOf([lea()])) })
    renderConsole(api)
    await screen.findByTestId('moderation-card')

    await userEvent.keyboard('z')

    expect(api.moderateBulk).not.toHaveBeenCalled()
    expect(screen.queryByText(fr.moderation.undone)).toBeNull()
  })

  it('shows the keyboard shortcuts, because nobody guesses them', async () => {
    renderConsole(fakeApi())
    await screen.findByText(fr.moderation.empty)

    expect(screen.getByText(fr.moderation.shortcuts)).toBeInTheDocument()
    expect(screen.getByText(fr.moderation.shortcutsHint, { exact: false })).toBeInTheDocument()
  })

  it('keeps the queue on screen when a refresh fails under the host', async () => {
    let answered = 0
    const api = fakeApi({
      moderationQueue: vi.fn(async () => {
        answered += 1
        if (answered === 1) return queueOf([lea()])
        throw ApiError.network()
      }),
    })
    renderConsole(api)
    await screen.findByTestId('moderation-card')

    emitSignal('photo.uploaded')

    // Replacing a usable queue with an error page mid-event is worse than a line
    // saying the refresh failed.
    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors.network)
    expect(screen.getByTestId('moderation-card')).toBeInTheDocument()
  })

  it('says so when an undo could not put every photo back', async () => {
    // Another moderator moved the photo in between, so the batch skips it. Silence
    // here would leave the host believing the accident was fully reversed.
    const api = fakeApi({
      moderationQueue: vi.fn(async () => queueOf([lea({ status: 'published' })])),
      moderateBulk: vi.fn(async () => ({ applied: [], skipped: ['photo-1'] })),
    })
    renderConsole(api)
    const card = await screen.findByTestId('moderation-card')
    await userEvent.click(
      within(card).getByRole('button', { name: fr.moderation.hidePhoto('Léa') }),
    )
    expect(await within(card).findByText(fr.moderation.stateHidden)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: fr.moderation.undo }))

    expect(await screen.findByText(fr.moderation.bulkSkipped(1))).toBeInTheDocument()
  })

  it('re-applies the decision when the undo itself fails', async () => {
    const api = fakeApi({
      moderationQueue: vi.fn(async () => queueOf([lea({ status: 'published' })])),
      moderateBulk: vi.fn(async () => {
        throw ApiError.network()
      }),
    })
    renderConsole(api)
    const card = await screen.findByTestId('moderation-card')
    await userEvent.click(
      within(card).getByRole('button', { name: fr.moderation.hidePhoto('Léa') }),
    )
    expect(await within(card).findByText(fr.moderation.stateHidden)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: fr.moderation.undo }))

    // The decision stands, because the server still has it. Leaving the tile showing
    // the old status would tell the host the photo is back on the wall when it is not.
    expect(await within(card).findByText(fr.moderation.stateHidden)).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(fr.errors.network)
  })

  it('puts a whole batch back when the request fails', async () => {
    const api = fakeApi({
      moderationQueue: vi.fn(async () => queueOf([lea(), sacha()])),
      moderateBulk: vi.fn(async () => {
        throw ApiError.network()
      }),
    })
    renderConsole(api)
    await screen.findAllByTestId('moderation-card')
    await userEvent.click(screen.getByRole('button', { name: fr.moderation.selectAll }))

    await userEvent.click(screen.getByRole('button', { name: fr.moderation.bulkPublish(2) }))

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors.network)
    expect(within(cardOf('Léa')).getByText(fr.moderation.statePending)).toBeInTheDocument()
    expect(within(cardOf('Sacha')).getByText(fr.moderation.statePending)).toBeInTheDocument()
    expect(screen.getByText(fr.moderation.pending(2))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: fr.moderation.undo })).toBeNull()
  })

  it('takes a photo off the screen from the lightbox', async () => {
    const api = fakeApi({
      moderationQueue: vi.fn(async () => queueOf([lea({ status: 'published' })])),
    })
    renderConsole(api)
    await screen.findByTestId('moderation-card')
    await userEvent.click(screen.getByRole('button', { name: fr.moderation.enlargePhoto('Léa') }))
    const dialog = await screen.findByRole('dialog')

    await userEvent.click(
      within(dialog).getByRole('button', { name: fr.moderation.hidePhoto('Léa') }),
    )

    expect(api.moderate).toHaveBeenCalledWith(SLUG, 'photo-1', 'hide')
  })

  it('walks back through the queue from the lightbox on the left arrow', async () => {
    const api = fakeApi({ moderationQueue: vi.fn(async () => queueOf([lea(), sacha()])) })
    renderConsole(api)
    await screen.findAllByTestId('moderation-card')
    await userEvent.click(screen.getByRole('button', { name: fr.moderation.enlargePhoto('Sacha') }))
    const dialog = await screen.findByRole('dialog')

    await userEvent.keyboard('{ArrowLeft}')

    expect(
      within(dialog).getByRole('heading', { name: fr.moderation.photoOf('Léa') }),
    ).toBeInTheDocument()
  })

  it('refuses a photo from the lightbox', async () => {
    const api = fakeApi({ moderationQueue: vi.fn(async () => queueOf([lea()])) })
    renderConsole(api)
    await screen.findByTestId('moderation-card')
    await userEvent.click(screen.getByRole('button', { name: fr.moderation.enlargePhoto('Léa') }))
    const dialog = await screen.findByRole('dialog')

    await userEvent.click(
      within(dialog).getByRole('button', { name: fr.moderation.rejectPhoto('Léa') }),
    )

    expect(api.moderate).toHaveBeenCalledWith(SLUG, 'photo-1', 'reject')
  })

  it('names an anonymous guest’s photo full size without inventing a name', async () => {
    const api = fakeApi({
      moderationQueue: vi.fn(async () => queueOf([lea({ authorName: null, caption: null })])),
    })
    renderConsole(api)
    await screen.findByTestId('moderation-card')

    await userEvent.click(
      screen.getByRole('button', {
        name: fr.moderation.enlargePhoto(fr.moderation.anonymousInName),
      }),
    )

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(fr.moderation.byAnonymous)).toBeInTheDocument()
    expect(
      within(dialog).getByAltText(fr.moderation.photoAlt(fr.moderation.anonymousInName)),
    ).toBeInTheDocument()
  })

  it('walks back up the queue on K, and decides nothing with no photo under it', async () => {
    const api = fakeApi({ moderationQueue: vi.fn(async () => queueOf([lea(), sacha()])) })
    renderConsole(api)
    await screen.findAllByTestId('moderation-card')

    // Nothing focused yet: a stray keystroke on a fresh console must not decide.
    await userEvent.keyboard('p')
    expect(api.moderate).not.toHaveBeenCalled()

    await userEvent.keyboard('k')

    expect(cardOf('Sacha')).toHaveFocus()
  })

  it('says nothing was found when the address carries no event', () => {
    // Rendered outside the /admin/events/:slug route, so there is no event to load.
    renderWithProviders(<ModerationPage />, { api: fakeApi() })

    expect(screen.getByText(fr.shell.notFoundTitle)).toBeInTheDocument()
    expect(FakeEventSource.instances).toHaveLength(0)
  })

  it('closes the stream when the host leaves the console', async () => {
    const api = fakeApi({ moderationQueue: vi.fn(async () => queueOf([lea()])) })
    const { unmount } = renderConsole(api)
    await screen.findByTestId('moderation-card')

    unmount()

    // An eight-hour evening with a host moving between screens must not leave a
    // connection per visit open against the event.
    expect(stream().readyState).toBe(2)
  })
})
