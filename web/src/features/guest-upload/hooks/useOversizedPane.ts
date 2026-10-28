import { useLayoutEffect, useRef, useState, type RefObject } from 'react'

/**
 * Whether a pane is too tall to be pinned to the bottom of the screen.
 *
 * A sticky pane covers whatever scrolls behind it, so the taller it is, the less of the page
 * the guest can see — and a pane at 100% of the viewport or more has a top edge that can never
 * be scrolled into view, with everything above it permanently underneath. The upload composer
 * grows with every photo the guest picks, with the guest's own text size and with whatever the
 * host switched on (captions, video, prompts), so no stylesheet can know ahead of time which
 * side of that line it is on. It has to be measured, on the pane that is actually on screen.
 *
 * The answer is a view fact and not a business rule: it only decides whether the pane is
 * pinned or in the flow, and nothing is hidden either way.
 */

/**
 * The tokens.css property holding the share of the viewport a pinned pane may take
 * (`--sticky-pane-max-share`). Read from the element rather than written here, so the number
 * lives with every other design value.
 */
export const MAX_SHARE_PROPERTY = '--sticky-pane-max-share'

/**
 * `true` when the pane takes more than `share` of the viewport, `false` at exactly `share`:
 * "at most two thirds" is allowed. Unmeasurable (no viewport) is never "too tall".
 */
export const exceedsShare = (paneHeight: number, viewportHeight: number, share: number): boolean =>
  viewportHeight > 0 && paneHeight > viewportHeight * share

const shareFor = (pane: Element): number | null => {
  const share = Number.parseFloat(getComputedStyle(pane).getPropertyValue(MAX_SHARE_PROPERTY))
  return Number.isFinite(share) ? share : null
}

export const useOversizedPane = (pane: RefObject<HTMLElement | null>): boolean => {
  const [oversized, setOversized] = useState(false)
  const bringIntoView = useRef(false)

  // Assumes the pane lives as long as the component that owns this hook, which it does: the
  // screen that mounts it never mounts it again. (Layout effect so the first answer comes
  // before the first paint; nothing tests that, and nothing depends on it.)
  useLayoutEffect(() => {
    const element = pane.current
    if (element === null) return

    // The height of the screen, taken when the pane is mounted and again when the width changes,
    // and not read afresh by every measurement. A phone whose address bar slides away, or whose
    // keyboard opens under a caption being typed, changes `innerHeight` and nothing else — and a
    // pane that is re-decided against that height drops out of the screen under the thumb that
    // is typing. The pane growing (every photo picked, a larger text size) is what the observer
    // reports; a rotation or a page zoom is what changes the width.
    let viewportHeight = window.innerHeight
    let width = window.innerWidth

    const measure = (grew = false) => {
      const share = shareFor(element)
      // A stylesheet that does not declare the share is a stylesheet that never asked for the
      // rule: the pane stays as it was written, pinned.
      if (share === null) return
      const tooTall = exceedsShare(element.getBoundingClientRect().height, viewportHeight, share)
      // Only a pane that grew under the guest's hands is brought back into view: not the first
      // measurement of a page that has just opened, and not a rotation.
      bringIntoView.current = grew && tooTall
      setOversized(tooTall)
    }

    // The first report of an observer is the size the pane started at, not a change.
    let reported = false
    const observer = new ResizeObserver(() => {
      measure(reported)
      reported = true
    })
    observer.observe(element)

    const onResize = () => {
      if (window.innerWidth === width) return
      width = window.innerWidth
      viewportHeight = window.innerHeight
      measure()
    }
    window.addEventListener('resize', onResize)

    measure()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', onResize)
    }
  }, [pane])

  // A pane that leaves the bottom edge of the screen for its place in the flow can land below
  // the fold, taking the send button with it — at the very moment the guest picked the photo
  // that made it too tall. Its bottom is brought back into view, once, as it changes place.
  // Never when it goes back to being pinned, which is already on screen.
  useLayoutEffect(() => {
    const element = pane.current
    if (!oversized || !bringIntoView.current || element === null) return
    bringIntoView.current = false
    if (element.getBoundingClientRect().bottom > window.innerHeight) {
      element.scrollIntoView?.({ block: 'end' })
    }
  }, [oversized, pane])

  return oversized
}
