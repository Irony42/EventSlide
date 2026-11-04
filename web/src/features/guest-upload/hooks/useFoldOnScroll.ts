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
 * Positions are clamped to the page (`0` to its scrollable length), so the rubber band of iOS
 * past either end, which reads as a scroll up on its way back, folds nothing.
 *
 * `allowed` is the caller's say: not while photos are going up, nor while a field has the focus.
 */

/** The net upward scroll, in CSS pixels, that counts as "going back up". */
export const FOLD_DISTANCE = 48

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
    const onScroll = () => {
      const y = clamp(window.scrollY)
      gathered = y < last ? gathered + (last - y) : 0
      last = y
      if (gathered >= FOLD_DISTANCE) {
        gathered = 0
        fold.current()
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [allowed])
}
