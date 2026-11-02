import { cx } from '../../../design-system/classNames'
import styles from './EventActionIcon.module.css'

export type EventActionGlyph = 'wall' | 'moderate' | 'phone' | 'settings' | 'album' | 'stats'

export interface EventActionIconProps {
  readonly glyph: EventActionGlyph
  readonly className?: string | undefined
}

/**
 * The outline glyph on each of the event page's navigation tiles.
 *
 * Drawn here, once, as paths on a 16 unit grid: there is no icon font or sprite to fetch
 * (the CSP forbids a remote one and a venue's Wi-Fi would drop it), and no library to add
 * for five shapes. They are strokes rather than fills, so the weight is the one number
 * `--icon-stroke` and a tile does not need five hand-balanced silhouettes.
 *
 * Always `aria-hidden`: the label beside it is the link's accessible name, which is why
 * the glyph carries no title. It sizes from the text it sits in (`1em`), so the tile that
 * wants a bigger one sets a bigger `font-size` and nothing else.
 */
const SHAPES: Record<EventActionGlyph, string> = {
  // A screen on its stand
  wall: 'M3.5 2.5h9a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1zM8 11v2.5M5.5 13.5h5',
  // A shield with a tick: the thing that decides what reaches the screen
  moderate: 'M8 1.8 13 3.6v4.1c0 3-2 5.1-5 6.5-3-1.4-5-3.5-5-6.5V3.6zM5.6 7.9 7.3 9.6l3.2-3.4',
  // A handset, upright
  phone:
    'M5.5 1.5h5a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1zM7.2 12.2h1.6',
  // Two sliders
  settings:
    'M2.5 5h2.65M8.25 5h5.25M2.5 11h5.15M10.75 11h2.75M8.25 5a1.55 1.55 0 1 1-3.1 0 1.55 1.55 0 0 1 3.1 0zM10.75 11a1.55 1.55 0 1 1-3.1 0 1.55 1.55 0 0 1 3.1 0z',
  // Three bars on a baseline
  stats: 'M2.5 13.5h11M4.5 13.5V8.5M8 13.5V3.5M11.5 13.5v-3.5',
  // An arrow into a tray
  album: 'M8 2v7.5M5 6.8l3 3 3-3M2.8 11v1.7a.8.8 0 0 0 .8.8h8.8a.8.8 0 0 0 .8-.8V11',
}

export function EventActionIcon({ glyph, className }: EventActionIconProps) {
  const classes = cx(styles['icon'], className)

  return (
    <svg className={classes} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d={SHAPES[glyph]} />
    </svg>
  )
}
