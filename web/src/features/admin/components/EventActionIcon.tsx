import { cx } from '../../../design-system/classNames'
import styles from './EventActionIcon.module.css'

export type EventActionGlyph =
  | 'wall'
  | 'moderate'
  | 'settings'
  | 'album'
  | 'stats'
  | 'guests'
  | 'moderators'
  | 'guestbook'
  | 'challenge'
  | 'missions'
  | 'bestOf'
  | 'book'
  | 'share'
  | 'print'
  | 'copy'
  | 'expand'

export interface EventActionIconProps {
  readonly glyph: EventActionGlyph
  readonly className?: string | undefined
}

/**
 * The outline glyph on each of the event page's tiles and access controls.
 *
 * Drawn here, once, as paths on a 16 unit grid: there is no icon font or sprite to fetch
 * (the CSP forbids a remote one and a venue's Wi-Fi would drop it), and no library to add
 * for a handful of shapes. They are strokes rather than fills, so the weight is the one number
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
  // Two sliders
  settings:
    'M2.5 5h2.65M8.25 5h5.25M2.5 11h5.15M10.75 11h2.75M8.25 5a1.55 1.55 0 1 1-3.1 0 1.55 1.55 0 0 1 3.1 0zM10.75 11a1.55 1.55 0 1 1-3.1 0 1.55 1.55 0 0 1 3.1 0z',
  // Three bars on a baseline
  stats: 'M2.5 13.5h11M4.5 13.5V8.5M8 13.5V3.5M11.5 13.5v-3.5',
  // An arrow into a tray
  album: 'M8 2v7.5M5 6.8l3 3 3-3M2.8 11v1.7a.8.8 0 0 0 .8.8h8.8a.8.8 0 0 0 .8-.8V11',
  // Two heads and shoulders
  guests:
    'M6 7.2a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8zM1.8 13.5c.4-2.4 2.1-3.8 4.2-3.8s3.8 1.4 4.2 3.8M10.6 2.6a2.3 2.3 0 0 1 0 4.4M12 9.9c1.3.5 2 1.7 2.2 3.6',
  // A person and a plus: somebody else who may decide
  moderators:
    'M6.5 7.2a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8zM2 13.5c.4-2.4 2.2-3.8 4.5-3.8 1 0 1.9.2 2.6.7M12 9.5v4M10 11.5h4',
  // A speech bubble
  guestbook: 'M2.5 3.5h11v7.5H6l-3.5 2.5z',
  // A stopwatch
  challenge: 'M8 14.2a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM8 6.6v2.8l1.8 1.2M6.3 1.8h3.4',
  // A target
  missions:
    'M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8 8.4a.4.4 0 1 0 0-.8.4.4 0 0 0 0 .8z',
  // A star
  bestOf: 'M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z',
  // A bound book
  book: 'M3 2.5h8.5a1 1 0 0 1 1 1v10H4.2a1.2 1.2 0 0 1-1.2-1.2zM3 12.3a1.2 1.2 0 0 1 1.2-1.2h8.3',
  // Two links of a chain
  share:
    'M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2-2a2.6 2.6 0 0 0-3.7-3.7l-.7.7M9.2 6.8a2.6 2.6 0 0 0-3.7 0l-2 2a2.6 2.6 0 0 0 3.7 3.7l.7-.7',
  // A printer with its sheet
  print: 'M4.5 6V2.5h7V6M4.5 11.5h-2V6h11v5.5h-2M4.5 9.5h7v4h-7z',
  // Two sheets, one over the other
  copy: 'M5.5 5.5h8v8h-8zM10.5 5.5v-3h-8v8h3',
  // Four corners pulled outward
  expand: 'M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10',
}

export function EventActionIcon({ glyph, className }: EventActionIconProps) {
  const classes = cx(styles['icon'], className)

  return (
    <svg className={classes} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d={SHAPES[glyph]} />
    </svg>
  )
}
