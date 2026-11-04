import { cx } from '../classNames'
import styles from './Icon.module.css'

/**
 * The glyphs of the product's one icon set, as a closed union: a new glyph is a new line here,
 * reviewed with the rest, never an import from a font or a sprite.
 */
export type IconName = 'settings' | 'pause' | 'play' | 'fullscreen' | 'close'

export type IconSize = 'sm' | 'md'

/**
 * Strokes on a 24-unit grid, drawn by hand and kept as constants of this module: no remote
 * file (the CSP forbids one and a venue's Wi-Fi would drop it), no icon font, no dynamic import.
 */
const PATHS: Readonly<Record<IconName, string>> = {
  // Three sliders: the line, then the knob on it.
  settings:
    'M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1M15 5a2 2 0 1 0 0 4a2 2 0 1 0 0-4zM9 10a2 2 0 1 0 0 4a2 2 0 1 0 0-4zM17 15a2 2 0 1 0 0 4a2 2 0 1 0 0-4z',
  pause: 'M8 5h2.5v14H8zM13.5 5H16v14h-2.5z',
  play: 'M8 5.5v13l11-6.5z',
  // The four corners, as a screen that is about to fill.
  fullscreen: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  close: 'M6 6l12 12M18 6L6 18',
}

export interface IconProps {
  readonly name: IconName
  readonly size?: IconSize
  readonly className?: string | undefined
}

/**
 * One glyph, inline, in `currentColor`.
 *
 * Always `aria-hidden`: the button or the text beside it is the accessible name, and a glyph
 * that spoke would be read twice.
 */
export function Icon({ name, size = 'md', className }: IconProps) {
  return (
    <svg
      className={cx(styles['icon'], styles[size], className)}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
