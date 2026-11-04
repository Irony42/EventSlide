import { cx } from '../classNames'
import styles from './Icon.module.css'

/**
 * The glyphs of the product's one icon set, as a closed union: a new glyph is a new line here,
 * reviewed with the rest, never an import from a font or a sprite.
 */
export type IconName =
  | 'settings'
  | 'pause'
  | 'play'
  | 'fullscreen'
  | 'close'
  | 'layout'
  | 'palette'
  | 'qr'
  | 'eye'
  | 'flag'
  | 'speaker'
  | 'monitor'
  | 'globe'
  | 'check'
  | 'chevron'

export type IconSize = 'sm' | 'md'

/**
 * Strokes on a 24-unit grid, drawn by hand and kept as constants of this module: no remote
 * file (the CSP forbids one and a venue's Wi-Fi would drop it), no icon font, no dynamic import.
 */
/** A rounded square, as one path: the set draws strokes only, so every glyph is a `<path>`. */
const square = (x: number, y: number, size: number, r: number): string =>
  `M${x + r} ${y}h${size - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${size - 2 * r}a${r} ${r} 0 0 1 -${r} ${r}h-${size - 2 * r}a${r} ${r} 0 0 1 -${r} -${r}v-${size - 2 * r}a${r} ${r} 0 0 1 ${r} -${r}z`

const PATHS: Readonly<Record<IconName, string>> = {
  // Three sliders: the line, then the knob on it.
  settings:
    'M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1M15 5a2 2 0 1 0 0 4a2 2 0 1 0 0-4zM9 10a2 2 0 1 0 0 4a2 2 0 1 0 0-4zM17 15a2 2 0 1 0 0 4a2 2 0 1 0 0-4z',
  pause: 'M8 5h2.5v14H8zM13.5 5H16v14h-2.5z',
  play: 'M8 5.5v13l11-6.5z',
  // The four corners, as a screen that is about to fill.
  fullscreen: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  close: 'M6 6l12 12M18 6L6 18',
  layout: [
    square(4, 4, 7, 1.5),
    square(13, 4, 7, 1.5),
    square(4, 13, 7, 1.5),
    square(13, 13, 7, 1.5),
  ].join(''),
  palette:
    'M12 3a9 9 0 1 0 0 18c1.6 0 2.2-1.1 1.6-2.2-.6-1.2.2-2.6 1.6-2.6H17a4 4 0 0 0 4-4c0-5.2-4-9.2-9-9.2zM7.5 11h.01M10 7h.01M15 7.5h.01',
  qr:
    [square(4, 4, 6, 1), square(14, 4, 6, 1), square(4, 14, 6, 1)].join('') +
    'M14 14h2.5v2.5H14zM19 14v1M14 19.5h3M19.5 18.5v1.5',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 9.2a2.8 2.8 0 1 0 0 5.6a2.8 2.8 0 1 0 0-5.6z',
  flag: 'M5 21V4M5 4.5h11.5L14 9l2.5 4.5H5',
  speaker: 'M4 9.5h3.5L13 5v14l-5.5-4.5H4zM16.5 9a4.2 4.2 0 0 1 0 6M19 6.5a8 8 0 0 1 0 11',
  monitor: 'M5 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM8 20h8M12 16v4',
  globe:
    'M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 1 0 0-17zM3.5 12h17M12 3.5c2.5 2.5 3.5 5.3 3.5 8.5s-1 6-3.5 8.5c-2.5-2.5-3.5-5.3-3.5-8.5s1-6 3.5-8.5z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  chevron: 'M6 9.5l6 6 6-6',
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
