import { useLayoutEffect, useState, type RefObject } from 'react'

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

  // A layout effect: the first answer lands in the commit that mounted the pane, so a pane that
  // is too tall is never painted pinned for one frame and then dropped into the flow.
  useLayoutEffect(() => {
    const element = pane.current
    if (element === null) return

    const measure = () => {
      const share = shareFor(element)
      // A stylesheet that does not declare the share is a stylesheet that never asked for the
      // rule: the pane stays as it was written, pinned.
      if (share === null) return
      setOversized(exceedsShare(element.getBoundingClientRect().height, window.innerHeight, share))
    }

    // What follows the pane growing, which is what a guest picking photos does.
    const observer = new ResizeObserver(measure)
    observer.observe(element)

    // Not every `resize`. A phone fires one each time its address bar slides away or its
    // keyboard opens, which changes the height and nothing else — and re-deciding then would
    // drop the pane out of the screen under the thumb that is typing a caption. A change of
    // width is a rotation or a change of text size, and that is when the answer can change.
    let width = window.innerWidth
    const onResize = () => {
      if (window.innerWidth === width) return
      width = window.innerWidth
      measure()
    }
    window.addEventListener('resize', onResize)

    measure()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', onResize)
    }
  }, [pane])

  return oversized
}
