import { useEffect, useRef } from 'react'

/**
 * Folds the upload pane when the guest scrolls up through the page.
 *
 * Going back up the feed or the guestbook is the moment the pane is in the way. The signal is a
 * net upward scroll of at least `FOLD_DISTANCE`: a tremor, or the few pixels a thumb gives back
 * after a flick down, never adds up (any downward movement forgets what was gathered). The page
 * is never unfolded from here: a pane that jumped open under the thumb would be worse than the
 * one that was in the way, so only a tap reopens it.
 *
 * **Only a scroll the guest made counts.** The page also moves by itself: the pane growing under a
 * photo just picked, the browser keeping a caption field in view, a script bringing a list into
 * view. A scroll counts only while a drag of the finger (and the momentum after it), the wheel
 * or a scrolling key is recent (`GESTURE_MS`); a tap is not a drag.
 *
 * Positions are clamped to the page (`0` to its scrollable length), so the rubber band of iOS
 * past either end, which reads as a scroll up on its way back, folds nothing.
 *
 * `allowed` is the caller's say: not while photos are going up, nor while a field has the focus.
 */

/** The net upward scroll, in CSS pixels, that counts as "going back up". */
export const FOLD_DISTANCE = 48

/** How long after the last drag, wheel tick or key a scroll is still the guest's (momentum). */
export const GESTURE_MS = 1500

const SCROLL_KEYS = new Set(['ArrowUp', 'PageUp', 'Home', ' '])

export const useFoldOnScroll = (allowed: boolean, onFold: () => void): void => {
  const fold = useRef(onFold)
  useEffect(() => {
    fold.current = onFold
  }, [onFold])

  useEffect(() => {
    if (!allowed) return
    const clamp = (y: number) => {
      const root = document.documentElement
      return Math.min(Math.max(y, 0), Math.max(root.scrollHeight - window.innerHeight, 0))
    }
    let last = clamp(window.scrollY)
    let gathered = 0
    let lastGesture = Number.NEGATIVE_INFINITY
    let dragged = false

    const gesture = () => {
      lastGesture = performance.now()
    }
    const onTouchStart = () => {
      dragged = false
    }
    const onTouchMove = () => {
      dragged = true
      gesture()
    }
    const onTouchEnd = () => {
      if (dragged) gesture()
    }
    const onKey = (event: KeyboardEvent) => {
      if (SCROLL_KEYS.has(event.key)) gesture()
    }
    const onScroll = () => {
      const y = clamp(window.scrollY)
      const theirs = performance.now() - lastGesture < GESTURE_MS
      gathered = theirs && y < last ? gathered + (last - y) : 0
      last = y
      if (gathered >= FOLD_DISTANCE) {
        gathered = 0
        fold.current()
      }
    }

    const passive = { passive: true } as const
    window.addEventListener('touchstart', onTouchStart, passive)
    window.addEventListener('touchmove', onTouchMove, passive)
    window.addEventListener('touchend', onTouchEnd, passive)
    window.addEventListener('wheel', gesture, passive)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, passive)
    return () => {
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('wheel', gesture)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll)
    }
  }, [allowed])
}
