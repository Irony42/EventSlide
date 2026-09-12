import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { SwipeCard } from './SwipeCard'
import { fr } from '../../../lib/i18n/fr'
import { aModerationPhoto } from '../../../testing/renderWithProviders'
import type { ModerationPhotoDto } from '../../../lib/api/dto'

/**
 * The gesture, as a host performs it.
 *
 * `fireEvent` rather than `userEvent` here, and it is the deliberate exception in this
 * folder: what is under test is a pointer travelling to specific coordinates, and
 * `userEvent.pointer` models a *user* — it hit-tests against a layout jsdom does not
 * have. The coordinates are the subject, so they are supplied directly.
 *
 * Nothing below asserts on a `transform`. The arithmetic has its own tests in
 * `../swipe/swipeGesture.test.ts`; what is asserted here is what a host gets out of it —
 * a decision, a cancelled gesture, and being told which way the card is going.
 *
 * jsdom measures every element at zero, so the card's commit distance falls back to its
 * floor of 56 px. `SHORT` and `FAR` sit either side of it.
 */

const SHORT = 30
const FAR = 120

const photo = (overrides: Partial<ModerationPhotoDto> = {}): ModerationPhotoDto =>
  aModerationPhoto({ authorName: 'Léa', caption: 'Les confettis', ...overrides })

const card = (): HTMLElement => screen.getByTestId('mobile-moderation-card')

interface Gesture {
  /** Where the thumb travels, in order. */
  readonly along: readonly number[]
  /** Down the screen, for a gesture that is really a scroll. */
  readonly down?: number
  /** `false` leaves the thumb on the card, mid-swipe. */
  readonly release?: boolean
}

const drag = ({ along, down = 0, release = true }: Gesture): void => {
  const target = card()
  // `isPrimary` is what a browser sets on the contact that leads a gesture, and what
  // separates a deliberate thumb from the knuckle of the hand holding the phone.
  fireEvent.pointerDown(target, {
    pointerId: 1,
    button: 0,
    isPrimary: true,
    clientX: 0,
    clientY: 0,
  })
  for (const x of along) {
    fireEvent.pointerMove(target, { pointerId: 1, clientX: x, clientY: down })
  }
  if (release) {
    fireEvent.pointerUp(target, { pointerId: 1, clientX: along.at(-1) ?? 0, clientY: down })
  }
}

describe('SwipeCard', () => {
  it('publishes a photo swiped to the right', () => {
    const onDecide = vi.fn()
    render(<SwipeCard photo={photo()} onDecide={onDecide} />)

    drag({ along: [40, FAR] })

    expect(onDecide).toHaveBeenCalledWith('publish', 'photo-1')
  })

  it('refuses a photo swiped to the left', () => {
    const onDecide = vi.fn()
    render(<SwipeCard photo={photo()} onDecide={onDecide} />)

    drag({ along: [-40, -FAR] })

    expect(onDecide).toHaveBeenCalledWith('reject', 'photo-1')
  })

  it('says which way the card is going before the host lets go', () => {
    // The gesture has to be readable while it can still be taken back. A card that only
    // reveals its direction at the moment it commits offers no way out.
    render(<SwipeCard photo={photo()} onDecide={vi.fn()} />)

    drag({ along: [40], release: false })

    expect(card()).toHaveAttribute('data-intent', 'publish')
    expect(card()).toHaveAttribute('data-committed', 'false')
    expect(screen.getByText(fr.moderation.publish)).toBeInTheDocument()
  })

  it('says the decision is one release away once the card has gone far enough', () => {
    render(<SwipeCard photo={photo()} onDecide={vi.fn()} />)

    drag({ along: [FAR], release: false })

    expect(card()).toHaveAttribute('data-committed', 'true')
    expect(screen.getByText(fr.mobileModeration.releaseToPublish)).toBeInTheDocument()
  })

  it('decides nothing when the host drags the card back before letting go', () => {
    // The way out of a swipe started by mistake, and the reason the gesture is safe
    // enough to put a publish behind.
    const onDecide = vi.fn()
    render(<SwipeCard photo={photo()} onDecide={onDecide} />)

    drag({ along: [FAR, 60, SHORT], release: false })
    // Still going the same way, no longer going to arrive: the card says both.
    expect(card()).toHaveAttribute('data-intent', 'publish')
    expect(card()).toHaveAttribute('data-committed', 'false')

    fireEvent.pointerUp(card(), { pointerId: 1, clientX: SHORT, clientY: 0 })

    expect(onDecide).not.toHaveBeenCalled()
  })

  it('decides nothing when the host lets go short of the threshold', () => {
    const onDecide = vi.fn()
    render(<SwipeCard photo={photo()} onDecide={onDecide} />)

    drag({ along: [SHORT] })

    expect(onDecide).not.toHaveBeenCalled()
  })

  it('decides nothing on a tap', () => {
    // A host tapping the photo to look at it must not publish it.
    const onDecide = vi.fn()
    render(<SwipeCard photo={photo()} onDecide={onDecide} />)

    drag({ along: [] })

    expect(onDecide).not.toHaveBeenCalled()
  })

  it('decides nothing when the thumb was really scrolling the page', () => {
    // A thumb travelling down a screen drifts sideways. Publishing on that is a
    // decision nobody took.
    const onDecide = vi.fn()
    render(<SwipeCard photo={photo()} onDecide={onDecide} />)

    drag({ along: [FAR], down: 300 })

    expect(onDecide).not.toHaveBeenCalled()
  })

  it('decides nothing when the system takes the gesture away', () => {
    // An incoming call, or the browser deciding this was a scroll after all. The card
    // returns and nothing is sent — a cancelled gesture is not a quiet publish.
    const onDecide = vi.fn()
    render(<SwipeCard photo={photo()} onDecide={onDecide} />)

    drag({ along: [FAR], release: false })
    fireEvent.pointerCancel(card(), { pointerId: 1 })

    expect(onDecide).not.toHaveBeenCalled()
    expect(card()).toHaveAttribute('data-intent', 'none')
  })

  it('ignores a second finger landing on the card mid-swipe', () => {
    /**
     * A phone is held in the hand that swipes it, so a knuckle or a second thumb
     * landing on the card is ordinary. Three things must not happen, and all three are
     * asserted: the gesture must not re-base itself on the new contact — which would
     * read as a swipe that never moved — the stray release must not decide, and the
     * deliberate gesture must survive intact.
     */
    const onDecide = vi.fn()
    render(<SwipeCard photo={photo()} onDecide={onDecide} />)

    drag({ along: [FAR], release: false })
    fireEvent.pointerDown(card(), {
      pointerId: 2,
      button: 0,
      isPrimary: false,
      clientX: FAR,
      clientY: 0,
    })
    fireEvent.pointerUp(card(), { pointerId: 2, clientX: FAR, clientY: 0 })

    expect(onDecide).not.toHaveBeenCalled()
    expect(card()).toHaveAttribute('data-committed', 'true')

    // And the first thumb still decides when it lifts.
    fireEvent.pointerUp(card(), { pointerId: 1, clientX: FAR, clientY: 0 })
    expect(onDecide).toHaveBeenCalledWith('publish', 'photo-1')
  })

  it('starts no gesture while a decision is still in flight', () => {
    // The card must not move for a swipe the page is about to refuse: a card that
    // travels and then does nothing is worse feedback than a card that stays put.
    const onDecide = vi.fn()
    render(<SwipeCard photo={photo()} disabled onDecide={onDecide} />)

    drag({ along: [FAR] })

    expect(onDecide).not.toHaveBeenCalled()
    expect(card()).toHaveAttribute('data-intent', 'none')
  })

  it('keeps a swipe that has gone sideways when the thumb then drifts down', () => {
    // A hand pivots from the wrist, so a "horizontal" swipe is an arc. Once the card
    // has claimed the gesture it keeps it, which is what a touch screen does on its own
    // under `touch-action: pan-y` — and what a mouse on the laptop preview does not.
    const onDecide = vi.fn()
    render(<SwipeCard photo={photo()} onDecide={onDecide} />)

    const target = card()
    fireEvent.pointerDown(target, {
      pointerId: 1,
      button: 0,
      isPrimary: true,
      clientX: 0,
      clientY: 0,
    })
    fireEvent.pointerMove(target, { pointerId: 1, clientX: FAR, clientY: 0 })
    fireEvent.pointerMove(target, { pointerId: 1, clientX: FAR, clientY: 200 })
    fireEvent.pointerUp(target, { pointerId: 1, clientX: FAR, clientY: 200 })

    expect(onDecide).toHaveBeenCalledWith('publish', 'photo-1')
  })

  it('starts no gesture from a right-click', () => {
    // The context menu opens over the card and no release is guaranteed to arrive, so a
    // drag begun here would leave the card stuck mid-swipe.
    const onDecide = vi.fn()
    render(<SwipeCard photo={photo()} onDecide={onDecide} />)

    const target = card()
    fireEvent.pointerDown(target, { pointerId: 1, button: 2, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(target, { pointerId: 1, clientX: FAR, clientY: 0 })
    fireEvent.pointerUp(target, { pointerId: 1, clientX: FAR, clientY: 0 })

    expect(onDecide).not.toHaveBeenCalled()
    expect(card()).toHaveAttribute('data-intent', 'none')
  })

  it('shows the photo full width, named for somebody who cannot see it', () => {
    render(<SwipeCard photo={photo()} onDecide={vi.fn()} />)

    expect(
      screen.getByRole('article', { name: fr.moderation.photoOf('Léa') }),
    ).toBeInTheDocument()
    expect(
      screen.getByAltText(fr.moderation.photoAltWithCaption('Les confettis', 'Léa')),
    ).toBeInTheDocument()
    expect(screen.getByText('Les confettis')).toBeInTheDocument()
    expect(screen.getByText(fr.moderation.by('Léa'))).toBeInTheDocument()
  })

  it('says a photo carries no caption rather than leaving the line out', () => {
    // The host is deciding whether that text goes on a wall in front of the room; an
    // absent line reads exactly like a caption that failed to arrive.
    render(<SwipeCard photo={photo({ caption: null })} onDecide={vi.fn()} />)

    expect(screen.getByText(fr.moderation.noCaption)).toBeInTheDocument()
    expect(card()).not.toHaveTextContent('undefined')
  })

  it('names an anonymous guest’s photo without inventing a name', () => {
    render(<SwipeCard photo={photo({ authorName: null })} onDecide={vi.fn()} />)

    expect(screen.getByText(fr.moderation.byAnonymous)).toBeInTheDocument()
    expect(
      screen.getByRole('article', {
        name: fr.moderation.photoOf(fr.moderation.anonymousInName),
      }),
    ).toBeInTheDocument()
  })
})
