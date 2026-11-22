import { useSyncExternalStore } from 'react'

/**
 * Whether a media query matches now, and again when it changes. A browser without `matchMedia`
 * (jsdom, some in-app browsers) matches nothing, which is the laptop layout.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      if (typeof window.matchMedia !== 'function') return () => undefined
      const list = window.matchMedia(query)
      list.addEventListener('change', notify)
      return () => list.removeEventListener('change', notify)
    },
    () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
    () => false,
  )
}
