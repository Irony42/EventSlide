import { useCallback, useEffect, useRef, useState } from 'react'
import { decisionOnRelease, readSwipe } from '../swipe/swipeGesture'
import type { SwipeIntent, SwipeReading } from '../swipe/swipeGesture'
import type { PointerEvent as ReactPointerEvent } from 'react'

/**
 * One photo, one thumb: the pointer half of the swipe.
 *
 * Pointer events rather than a gesture library, and not for purity — there is no CDN
 * (`helmet`'s CSP forbids a remote script) and a runtime dependency shipped to the host
 * is a dependency shipped on a venue's Wi-Fi. `pointerdown` covers touch, pen and
 * mouse in one listener, which is also what lets an e2e drive a real drag.
 *
 * Two details that are not incidental:
 *
 * - **`pointermove` and `pointerup` are listened for on `window`, not on the card.** A
 *   thumb travelling 200 px leaves the element long before it lets go, and a listener
 *   on the card alone would hear the move and never the release — leaving a card stuck
 *   mid-swipe. `setPointerCapture` is the other way to do this and is deliberately not
 *   used: it is unimplemented in jsdom, so it would make the behaviour untestable at
 *   ring 5 for no gain.
 * - **The listeners are attached by an effect and removed by its cleanup**, so a host
 *   navigating away mid-gesture leaves nothing behind on `window`.
 *
 * What this hook does *not* own is the arithmetic. That lives in `../swipe/swipeGesture`
 * and is tested without a DOM.
 */

export interface SwipeDecisionOptions {
  /** Called once, on release, when the gesture committed to a direction. */
  readonly onDecide: (decision: SwipeIntent) => void
  /**
   * `true` while the surface cannot accept a decision — a previous one is still in
   * flight. A gesture that would be refused must not start: a card that moves and then
   * does nothing is worse feedback than a card that does not move.
   */
  readonly disabled?: boolean
}

export interface SwipeDecisionSurface extends SwipeReading {
  /** Whether a thumb is on the card right now. The card follows it without easing. */
  readonly dragging: boolean
  /** Put this on the element that should follow the thumb. */
  readonly onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
}

interface Drag {
  readonly pointerId: number
  readonly startX: number
  readonly startY: number
  /** Measured once, at the start: the card is moving, so its box is not a fixed thing. */
  readonly width: number
  readonly dx: number
  readonly dy: number
  /**
   * Whether this gesture has already been read as horizontal.
   *
   * Once it has, a thumb that then drifts down the screen keeps swiping instead of
   * silently becoming a scroll — which is what the browser does on touch, where
   * `touch-action: pan-y` hands us the gesture for good at that same moment. Without
   * the latch the card snaps back to centre under a thumb that never lifted, and on a
   * mouse — the laptop preview this screen supports — nothing hands us anything, so the
   * arc of a hand pivoting from the wrist cancels a deliberate swipe.
   */
  readonly locked: boolean
}

const AT_REST: SwipeReading = { offset: 0, intent: null, progress: 0, committed: false }

export const useSwipeDecision = ({
  onDecide,
  disabled = false,
}: SwipeDecisionOptions): SwipeDecisionSurface => {
  const [drag, setDrag] = useState<Drag | null>(null)

  /**
   * The same drag, readable from a listener that was attached once.
   *
   * The window listeners are bound when the gesture starts and must see the *latest*
   * position when the thumb is lifted; a closure over `drag` would hold the position as
   * it was at `pointerdown`, so every swipe would read as a release at zero.
   */
  const dragRef = useRef<Drag | null>(null)

  /** Held in a ref for the same reason: so a re-render does not re-bind the listeners. */
  const onDecideRef = useRef(onDecide)
  useEffect(() => {
    onDecideRef.current = onDecide
  }, [onDecide])

  const dragging = drag !== null

  useEffect(() => {
    if (!dragging) return

    const apply = (next: Drag | null) => {
      dragRef.current = next
      setDrag(next)
    }

    /** The gesture in hand, or `null` when this event belongs to another pointer. */
    const ours = (event: PointerEvent): Drag | null => {
      const current = dragRef.current
      return current !== null && event.pointerId === current.pointerId ? current : null
    }

    const onMove = (event: PointerEvent) => {
      const current = ours(event)
      if (current === null) return
      const next = {
        ...current,
        dx: event.clientX - current.startX,
        dy: event.clientY - current.startY,
      }
      // Latched, never released: a gesture the card has already claimed stays claimed
      // for the rest of its life.
      apply({ ...next, locked: current.locked || readSwipe(next).intent !== null })
    }

    const onUp = (event: PointerEvent) => {
      const current = ours(event)
      if (current === null) return
      apply(null)
      const decision = decisionOnRelease(readSwipe(current))
      if (decision !== null) onDecideRef.current(decision)
    }

    /**
     * The system took the gesture away — an incoming call, the browser deciding this
     * was a scroll after all. The card goes back, and nothing is decided: a cancelled
     * gesture is not a quiet publish.
     */
    const onCancel = (event: PointerEvent) => {
      if (ours(event) === null) return
      apply(null)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)

    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
    }
  }, [dragging])

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (disabled) return
      // The primary button only. A touch and a pen both report 0; a right-click opens a
      // context menu, over which no `pointerup` is guaranteed to arrive, so a drag
      // started there would be a card left stuck mid-swipe.
      if (event.button !== 0) return
      /**
       * One gesture at a time, and only the pointer that leads it.
       *
       * A phone is held in the hand that is swiping. A knuckle or a second thumb landing
       * on the card would otherwise re-base the drag on itself: the deliberate gesture's
       * origin is overwritten, so it reads as a swipe that never moved, and the stray
       * pointer's release is the one that decides. `isPrimary` is false for exactly
       * those extra contacts; the ref guard covers the case where the first one went
       * down somewhere else entirely.
       */
      if (!event.isPrimary) return
      if (dragRef.current !== null) return

      const next: Drag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        width: event.currentTarget.getBoundingClientRect().width,
        dx: 0,
        dy: 0,
        locked: false,
      }
      dragRef.current = next
      setDrag(next)
    },
    [disabled],
  )

  const reading = drag === null ? AT_REST : readSwipe(drag)

  return { ...reading, dragging, onPointerDown }
}
