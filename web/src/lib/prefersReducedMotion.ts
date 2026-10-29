/**
 * Whether the reader asked for no motion, read once, at the moment something is about to move.
 *
 * For a script that has to choose between a smooth scroll and a jump, or between a flash and
 * none, on a tap. A component that renders differently as the preference changes reads it as
 * state instead (`usePrefersReducedMotion`, in the wall's hooks, which a feature may not import).
 * A browser without `matchMedia` is one that asked for nothing.
 */
export const prefersReducedMotion = (): boolean =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches
