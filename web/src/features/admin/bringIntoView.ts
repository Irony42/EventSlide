import { prefersReducedMotion } from '../../lib/prefersReducedMotion'

/**
 * Takes the host to a card's heading: focus first, so a screen reader reads on from there,
 * then the scroll, which is smooth unless they asked for no motion.
 *
 * For the controls that point at a card further down the page ("Create the album link", the
 * toast's "Print the new QR"). A plain `#anchor` would scroll and leave focus on the button
 * that has scrolled away. `scrollIntoView` is optional-called: jsdom has none, and a browser
 * without it still got the focus.
 */
export const bringIntoView = (heading: HTMLElement | null): void => {
  if (heading === null) return
  heading.focus({ preventScroll: true })
  heading.scrollIntoView?.({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' })
}
