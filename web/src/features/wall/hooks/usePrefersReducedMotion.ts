import { useSyncExternalStore } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

const subscribe = (onChange: () => void): (() => void) => {
  const list = window.matchMedia(QUERY)
  list.addEventListener('change', onChange)
  return () => list.removeEventListener('change', onChange)
}

const getSnapshot = (): boolean => window.matchMedia(QUERY).matches

/** No media queries during a server render; motion is assumed allowed until asked. */
const getServerSnapshot = (): boolean => false

/**
 * Whether the viewer asked for no motion.
 *
 * `base.css` already collapses every CSS animation under the media query, which is the
 * right answer for the crossfade — slides cut instead of dissolving. It is the wrong
 * answer for Ken Burns and for the reaction floaters: a `scale(1.08)` keyframe with a
 * 0.01 ms duration and `animation-fill-mode: both` does not stop, it *snaps* to the
 * zoomed frame and stays there. So the wall reads the preference in JavaScript and
 * declines to declare the animation at all.
 *
 * `useSyncExternalStore` rather than an effect: the value lives outside React, and
 * this is the one API allowed to read it during render.
 */
export const usePrefersReducedMotion = (): boolean =>
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
