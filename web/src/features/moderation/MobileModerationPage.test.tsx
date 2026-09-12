import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MobileModerationPage } from './MobileModerationPage'
import { ApiError } from '../../lib/http'
import { fr } from '../../lib/i18n/fr'
import { aModerationPhoto, fakeApi, renderWithProviders } from '../../testing/renderWithProviders'
import type { Api } from '../../lib/api/client'
import type { ModerationPhotoDto, ModerationQueueResponse } from '../../lib/api/dto'

/**
 * The console a host uses standing up, with one thumb.
 *
 * Everything here goes through the same `useModerationQueue` the desktop console uses,
 * so what these tests are about is the *view*: that one photo is offered at a time, that
 * the gesture and the buttons reach the same decision, and that the way back is on the
 * screen rather than in a notice that expires.
 *
 * The stream is driven through a stand-in for `EventSource`, as in
 * `ModerationPage.test.tsx`: what matters is that a signal makes the console refetch,
 * not that a socket can be opened. The stand-in is duplicated rather than shared,
 * because `web/src/testing/` is a file several branches write to at once.
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

const SLUG = 'camille-et-sacha'

/** jsdom measures the card at zero, so the commit distance is its 56 px floor. */
const FAR = 120

const queueOf = (
  items: readonly ModerationPhotoDto[],
  pendingCount = items.filter((item) => item.status === 'pending').length,
): ModerationQueueResponse => ({ items, pendingCount, nextCursor: null })

const lea = (overrides: Partial<ModerationPhotoDto> = {}): ModerationPhotoDto =>
  aModerationPhoto({ id: 'photo-1', authorName: 'Léa', caption: 'Les confettis', ...overrides })

const sacha = (overrides: Partial<ModerationPhotoDto> = {}): ModerationPhotoDto =>
  aModerationPhoto({ id: 'photo-2', authorName: 'Sacha', caption: null, ...overrides })

const renderPhone = (api: Api) =>
  renderWithProviders(<MobileModerationPage />, {
    api,
    route: `/admin/events/${SLUG}/moderation/mobile`,
    path: '/admin/events/:slug/moderation/mobile',
  })

const card = (): HTMLElement => screen.getByTestId('mobile-moderation-card')

/** A thumb crossing the card from the middle outwards, and lifting at the end. */
const swipe = (to: number): void => {
  const target = card()
  fireEvent.pointerDown(target, {
    pointerId: 1,
    button: 0,
    isPrimary: true,
    clientX: 0,
    clientY: 0,
  })
  fireEvent.pointerMove(target, { pointerId: 1, clientX: to / 2, clientY: 0 })
  fireEvent.pointerMove(target, { pointerId: 1, clientX: to, clientY: 0 })
  fireEvent.pointerUp(target, { pointerId: 1, clientX: to, clientY: 0 })
}

describe('MobileModerationPage', () => {
  beforeEach(() => {
    FakeEventSource.instances = []
    vi.stubGlobal('EventSource', FakeEventSource)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows a wait while the first queue is loading', () => {
    const api = fakeApi({
      moderationQueue: vi.fn(() => new Promise<ModerationQueueResponse>(() => {})),
    })

    renderPhone(api)

    expect(screen.getByText(fr.app.loading)).toBeInTheDocument()
    expect(screen.queryByTestId('mobile-moderation-card')).toBeNull()
    // And the live region stays quiet: announcing "rien à valider" over a spinner
    // describes an empty queue that has not been fetched yet.
    expect(screen.queryByText(fr.moderation.empty)).toBeNull()
  })

  it('says the queue is empty and that no reload is needed', async () => {
    renderPhone(fakeApi())

    expect(await screen.findByRole('heading', { name: fr.moderation.empty })).toBeInTheDocument()
    expect(screen.getByText(fr.moderation.emptyHint)).toBeInTheDocument()
  })

  it('offers a retry when the queue could not be loaded', async () => {
    const api = fakeApi({
      moderationQueue: vi.fn(async () => {
        throw ApiError.network()
      }),
    })
    renderPhone(api)

    expect(await screen.findByText(fr.moderation.loadFailed)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: fr.app.retry }))

    expect(api.moderationQueue).toHaveBeenCalledTimes(2)
  })

  it('offers one photo at a time, whatever is waiting behind it', async () => {
    // The whole point of this surface. A grid of five is what the laptop is for.
    const api = fakeApi({ moderationQueue: vi.fn(async () => queueOf([lea(), sacha()])) })
    renderPhone(api)

    await screen.findByTestId('mobile-moderation-card')

    expect(screen.getAllByTestId('mobile-moderation-card')).toHaveLength(1)
    expect(within(card()).getByText('Les confettis')).toBeInTheDocument()
    expect(screen.getByText(fr.moderation.pending(2))).toBeInTheDocument()
  })

  it('publishes the photo in hand from the button, and moves on to the next', async () => {
    // The buttons are not a fallback for the gesture: they are the path that works with
    // a screen reader, and for a host who cannot make a 100 px drag with one thumb.
    const api = fakeApi({ moderationQueue: vi.fn(async () => queueOf([lea(), sacha()])) })
    renderPhone(api)
    await screen.findByTestId('mobile-moderation-card')

    await userEvent.click(screen.getByRole('button', { name: fr.moderation.publishPhoto('Léa') }))

    expect(api.moderate).toHaveBeenCalledWith(SLUG, 'photo-1', 'publish')
    // The queue moves on with the host, without waiting for the server: on venue Wi-Fi
    // a card that sat there would be pressed twice.
    expect(
      await screen.findByRole('article', { name: fr.moderation.photoOf('Sacha') }),
    ).toBeInTheDocument()
    expect(screen.getByText(fr.moderation.pending(1))).toBeInTheDocument()
  })

  it('refuses the photo in hand from the button', async () => {
    const api = fakeApi({ moderationQueue: vi.fn(async () => queueOf([lea()])) })
    renderPhone(api)
    await screen.findByTestId('mobile-moderation-card')

    await userEvent.click(screen.getByRole('button', { name: fr.moderation.rejectPhoto('Léa') }))

    expect(api.moderate).toHaveBeenCalledWith(SLUG, 'photo-1', 'reject')
    expect(await screen.findByRole('heading', { name: fr.moderation.empty })).toBeInTheDocument()
  })

  it('publishes the photo swiped to the right', async () => {
    const api = fakeApi({ moderationQueue: vi.fn(async () => queueOf([lea()])) })
    renderPhone(api)
    await screen.findByTestId('mobile-moderation-card')

    swipe(FAR)

    await waitFor(() => expect(api.moderate).toHaveBeenCalledWith(SLUG, 'photo-1', 'publish'))
  })

  it('refuses the photo swiped to the left', async () => {
    const api = fakeApi({ moderationQueue: vi.fn(async () => queueOf([lea()])) })
    renderPhone(api)
    await screen.findByTestId('mobile-moderation-card')

    swipe(-FAR)

    await waitFor(() => expect(api.moderate).toHaveBeenCalledWith(SLUG, 'photo-1', 'reject'))
  })

  it('decides nothing when the swipe is taken back', async () => {
    // Asserted on the page as well as on the card, because this is the property that
    // makes a gesture safe enough to put a publish behind: a host who realises halfway
    // that they had the wrong photo has a way out that needs no undo.
    const api = fakeApi({ moderationQueue: vi.fn(async () => queueOf([lea()])) })
    renderPhone(api)
    await screen.findByTestId('mobile-moderation-card')

    const target = card()
    fireEvent.pointerDown(target, {
      pointerId: 1,
      button: 0,
      isPrimary: true,
      clientX: 0,
      clientY: 0,
    })
    fireEvent.pointerMove(target, { pointerId: 1, clientX: FAR, clientY: 0 })
    fireEvent.pointerMove(target, { pointerId: 1, clientX: 10, clientY: 0 })
    fireEvent.pointerUp(target, { pointerId: 1, clientX: 10, clientY: 0 })

    expect(api.moderate).not.toHaveBeenCalled()
    expect(within(card()).getByText('Les confettis')).toBeInTheDocument()
  })

  it('takes a publication back off the wall, from a control that is still there', async () => {
    /**
     * The affordance the roadmap asks for, and the one the desktop cannot lend as is.
     *
     * On the laptop, undo is an action on the decision's own notice — reachable because
     * the keyboard is under the host's hands. Standing at a table, the photo is gone
     * from the screen the instant it is decided, so the way back has to be a fixed
     * control. What it sends is `hide`: nothing puts a photo back to "en attente", and
     * taking it off the wall is the one reversal that cannot publish something nobody
     * approved.
     */
    const api = fakeApi({
      moderationQueue: vi.fn(async () => queueOf([lea()])),
      moderateBulk: vi.fn(async () => ({ applied: ['photo-1'], skipped: [] })),
    })
    renderPhone(api)
    await screen.findByTestId('mobile-moderation-card')
    await userEvent.click(screen.getByRole('button', { name: fr.moderation.publishPhoto('Léa') }))

    const undo = screen.getByRole('button', { name: fr.mobileModeration.undoLast })
    expect(undo).toBeEnabled()
    await userEvent.click(undo)

    expect(api.moderateBulk).toHaveBeenCalledWith(SLUG, ['photo-1'], 'hide')
    // "Retirée de l'écran", not "Décision annulée": the photo is `hidden` now, not back
    // in the queue, and a host told the decision was cancelled would go looking for it
    // where it is not. Honest about what happened is worth more than the nicer word.
    expect(await screen.findByText(fr.moderation.removed(1))).toBeInTheDocument()
    expect(screen.queryByText(fr.moderation.undone)).toBeNull()
  })

  it('refuses a second decision while the first is still in flight', async () => {
    /**
     * The failure this exists to prevent, in order: the host taps "Publier"; the
     * request hangs on a venue's Wi-Fi; the card advances immediately, because that
     * optimism is what keeps the console usable; the host taps again — and the second
     * tap lands on a photo nobody has looked at, which then goes on a wall in front of
     * two hundred people.
     */
    const api = fakeApi({
      moderationQueue: vi.fn(async () => queueOf([lea(), sacha()])),
      moderate: vi.fn(() => new Promise<void>(() => {})),
    })
    renderPhone(api)
    await screen.findByTestId('mobile-moderation-card')

    await userEvent.click(screen.getByRole('button', { name: fr.moderation.publishPhoto('Léa') }))

    // The next photo is in hand, and both decisions are shut while the first is out.
    expect(
      await screen.findByRole('article', { name: fr.moderation.photoOf('Sacha') }),
    ).toBeInTheDocument()
    const publish = screen.getByRole('button', { name: fr.moderation.publishPhoto('Sacha') })
    expect(publish).toBeDisabled()
    // Said, not only done: a control that silently ignores a tap is one people tap
    // harder.
    expect(publish).toHaveAttribute('aria-busy', 'true')

    await userEvent.click(publish)

    expect(api.moderate).toHaveBeenCalledTimes(1)
    expect(api.moderate).toHaveBeenCalledWith(SLUG, 'photo-1', 'publish')
  })

  it('refuses a second swipe while the first decision is still in flight', async () => {
    // The same hazard with a thumb. Two quick swipes are easier to fire than two quick
    // taps, and the card is what the host is looking at.
    const api = fakeApi({
      moderationQueue: vi.fn(async () => queueOf([lea(), sacha()])),
      moderate: vi.fn(() => new Promise<void>(() => {})),
    })
    renderPhone(api)
    await screen.findByTestId('mobile-moderation-card')

    swipe(FAR)
    await waitFor(() => expect(api.moderate).toHaveBeenCalledTimes(1))
    await screen.findByRole('article', { name: fr.moderation.photoOf('Sacha') })

    swipe(FAR)

    expect(api.moderate).toHaveBeenCalledTimes(1)
    // The card did not move either: a gesture that will be refused must not look like
    // one that is being taken.
    expect(card()).toHaveAttribute('data-intent', 'none')
  })

  it('takes the stale undo off the screen when the next decision lands', async () => {
    /**
     * Two publications a few seconds apart used to leave two textually identical "1
     * photo publiée — Annuler" notices stacked on the screen, both live for nine
     * seconds. Pressing the older one hides the photo the host had *just* deliberately
     * published and leaves the first one on the wall, and nothing about the two
     * notices tells them apart.
     *
     * The offer is per decision, so there is never more than one.
     */
    const api = fakeApi({
      moderationQueue: vi.fn(async () => queueOf([lea(), sacha()])),
      moderateBulk: vi.fn(async () => ({ applied: ['photo-2'], skipped: [] })),
    })
    renderPhone(api)
    await screen.findByTestId('mobile-moderation-card')

    await userEvent.click(screen.getByRole('button', { name: fr.moderation.publishPhoto('Léa') }))
    await screen.findByRole('article', { name: fr.moderation.photoOf('Sacha') })
    await userEvent.click(screen.getByRole('button', { name: fr.moderation.publishPhoto('Sacha') }))

    expect(screen.getAllByRole('button', { name: fr.moderation.undo })).toHaveLength(1)

    await userEvent.click(screen.getByRole('button', { name: fr.moderation.undo }))

    // The one offer on screen belongs to the decision the host just took.
    expect(api.moderateBulk).toHaveBeenCalledWith(SLUG, ['photo-2'], 'hide')
  })

  it('takes the undo offer away when the next decision cannot be undone', async () => {
    // Publish, then refuse. The page button greys out correctly, but the publication's
    // notice used to stay on screen carrying the only visible "Annuler" — and pressing
    // it did nothing at all, silently, while the host believed the refusal had been
    // taken back.
    const api = fakeApi({ moderationQueue: vi.fn(async () => queueOf([lea(), sacha()])) })
    renderPhone(api)
    await screen.findByTestId('mobile-moderation-card')

    await userEvent.click(screen.getByRole('button', { name: fr.moderation.publishPhoto('Léa') }))
    await screen.findByRole('article', { name: fr.moderation.photoOf('Sacha') })
    await userEvent.click(screen.getByRole('button', { name: fr.moderation.rejectPhoto('Sacha') }))

    expect(await screen.findByText(fr.moderation.refused(1))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: fr.moderation.undo })).toBeNull()
    expect(screen.getByRole('button', { name: fr.mobileModeration.undoLast })).toBeDisabled()
  })

  it('says nothing was taken back when the server refused the undo', async () => {
    // A second moderator rejected the photo on the laptop in between, so `rejected ->
    // hidden` is illegal and the server skips it rather than failing. A green "décision
    // annulée" beside that warning is the console telling the host the opposite of what
    // happened.
    const api = fakeApi({
      moderationQueue: vi.fn(async () => queueOf([lea()])),
      moderateBulk: vi.fn(async () => ({ applied: [], skipped: ['photo-1'] })),
    })
    renderPhone(api)
    await screen.findByTestId('mobile-moderation-card')
    await userEvent.click(screen.getByRole('button', { name: fr.moderation.publishPhoto('Léa') }))

    await userEvent.click(screen.getByRole('button', { name: fr.mobileModeration.undoLast }))

    expect(await screen.findByText(fr.moderation.bulkSkipped(1))).toBeInTheDocument()
    expect(screen.queryByText(fr.moderation.removed(1))).toBeNull()
    expect(screen.queryByText(fr.moderation.undone)).toBeNull()
  })

  it('announces the photo that has arrived in the host’s hand', async () => {
    // The card is replaced silently when a decision lands. Without this a host using a
    // screen reader is told what they published and nothing at all about what they are
    // now being asked to decide.
    const api = fakeApi({ moderationQueue: vi.fn(async () => queueOf([lea(), sacha()])) })
    renderPhone(api)
    await screen.findByTestId('mobile-moderation-card')

    const announcement = screen.getByText(
      fr.mobileModeration.nowDeciding(fr.moderation.photoAltWithCaption('Les confettis', 'Léa')),
    )
    expect(announcement).toHaveAttribute('aria-live', 'polite')

    await userEvent.click(screen.getByRole('button', { name: fr.moderation.publishPhoto('Léa') }))

    expect(
      await screen.findByText(fr.mobileModeration.nowDeciding(fr.moderation.photoAlt('Sacha'))),
    ).toBeInTheDocument()
  })

  it('announces that the queue is empty once the last photo is decided', async () => {
    const api = fakeApi({ moderationQueue: vi.fn(async () => queueOf([lea()])) })
    renderPhone(api)
    await screen.findByTestId('mobile-moderation-card')

    await userEvent.click(screen.getByRole('button', { name: fr.moderation.rejectPhoto('Léa') }))

    // Two of them now: the empty state's own copy, and the live region that says so out
    // loud to a host who is not looking at the phone.
    expect(await screen.findAllByText(fr.moderation.empty)).toHaveLength(2)
  })

  it('offers no way back from a refusal, and says where one is', async () => {
    // The deliberate gap. The only verb that would reverse a refusal is `publish`, and
    // the photo was still awaiting a decision — so "annuler" would throw it onto the
    // projector with nobody's approval behind it. The console says what it can do
    // instead of offering something it cannot.
    const api = fakeApi({ moderationQueue: vi.fn(async () => queueOf([lea()])) })
    renderPhone(api)
    await screen.findByTestId('mobile-moderation-card')

    await userEvent.click(screen.getByRole('button', { name: fr.moderation.rejectPhoto('Léa') }))

    expect(await screen.findByText(fr.moderation.refused(1))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: fr.mobileModeration.undoLast })).toBeDisabled()
    expect(screen.getByText(fr.mobileModeration.undoUnavailable)).toBeInTheDocument()
  })

  it('leaves the undo alone, and unexplained, until something has been decided', async () => {
    // Disabled, because there is nothing to take back — but silent about why. A line
    // saying refusals cannot be undone, on a screen where nothing has been refused,
    // explains a situation the host is not in.
    renderPhone(fakeApi({ moderationQueue: vi.fn(async () => queueOf([lea()])) }))
    await screen.findByTestId('mobile-moderation-card')

    expect(screen.getByRole('button', { name: fr.mobileModeration.undoLast })).toBeDisabled()
    expect(screen.queryByText(fr.mobileModeration.undoUnavailable)).toBeNull()
  })

  it('keeps the decisions pressable with nothing left to decide', async () => {
    // Rendered whether or not a photo is in hand, so the two targets do not move
    // between decisions — a button that shifts under a thumb is how a host publishes
    // the photo they meant to refuse.
    renderPhone(fakeApi())
    await screen.findByRole('heading', { name: fr.moderation.empty })

    expect(screen.getByRole('button', { name: fr.moderation.publish })).toBeDisabled()
    expect(screen.getByRole('button', { name: fr.moderation.reject })).toBeDisabled()
  })

  it('takes in a photo that arrives while the host is standing there', async () => {
    // The stream is the reason this screen is worth opening at all: the host is not
    // going to pull to refresh between courses.
    let answered = 0
    const api = fakeApi({
      moderationQueue: vi.fn(async () => {
        answered += 1
        return answered === 1 ? queueOf([lea()]) : queueOf([lea(), sacha()])
      }),
    })
    renderPhone(api)
    await screen.findByTestId('mobile-moderation-card')
    expect(screen.getByText(fr.moderation.pending(1))).toBeInTheDocument()

    // A signal, not a payload: the console refetches rather than trusting a push.
    emitSignal('photo.uploaded')

    expect(await screen.findByText(fr.moderation.pending(2))).toBeInTheDocument()
    // Still one photo in hand. A new arrival must not replace the one being judged.
    expect(within(card()).getByText('Les confettis')).toBeInTheDocument()
  })

  it('keeps the photo on screen when a refresh fails under the host', async () => {
    let answered = 0
    const api = fakeApi({
      moderationQueue: vi.fn(async () => {
        answered += 1
        if (answered === 1) return queueOf([lea()])
        throw ApiError.network()
      }),
    })
    renderPhone(api)
    await screen.findByTestId('mobile-moderation-card')

    emitSignal('photo.uploaded')

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors.network)
    expect(card()).toBeInTheDocument()
  })

  it('names an anonymous guest’s photo on both decisions without inventing a name', async () => {
    const api = fakeApi({
      moderationQueue: vi.fn(async () => queueOf([lea({ authorName: null })])),
    })
    renderPhone(api)
    await screen.findByTestId('mobile-moderation-card')

    expect(
      screen.getByRole('button', {
        name: fr.moderation.publishPhoto(fr.moderation.anonymousInName),
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: fr.moderation.rejectPhoto(fr.moderation.anonymousInName),
      }),
    ).toBeInTheDocument()
  })

  it('says nothing was found when the address carries no event', () => {
    renderWithProviders(<MobileModerationPage />, { api: fakeApi() })

    expect(screen.getByText(fr.shell.notFoundTitle)).toBeInTheDocument()
    expect(FakeEventSource.instances).toHaveLength(0)
  })

  it('closes the stream when the host puts the phone away', async () => {
    const api = fakeApi({ moderationQueue: vi.fn(async () => queueOf([lea()])) })
    const { unmount } = renderPhone(api)
    await screen.findByTestId('mobile-moderation-card')

    unmount()

    expect(stream().readyState).toBe(2)
  })
})
