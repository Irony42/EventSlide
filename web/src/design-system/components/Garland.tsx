import { useEffect, useRef } from 'react'
import { breeze } from '../breeze'
import { cx } from '../classNames'
import styles from './Garland.module.css'

type Colour = 'sun' | 'coral' | 'sky' | 'pink' | 'mint'

/** One photo per colour, left to right: the brand kit's own order. */
const COLOURS: readonly Colour[] = [
  'pink',
  'sun',
  'coral',
  'sky',
  'mint',
  'sun',
  'coral',
  'pink',
  'sky',
]

type Point = readonly [number, number]

const round = (value: number): number => Math.round(value * 100) / 100
const bezier = (p0: Point, p1: Point, p2: Point, u: number): Point => [
  (1 - u) ** 2 * p0[0] + 2 * (1 - u) * u * p1[0] + u * u * p2[0],
  (1 - u) ** 2 * p0[1] + 2 * (1 - u) * u * p1[1] + u * u * p2[1],
]
/** The string's angle at `u`, in degrees: a photo hangs along it, a little less steeply. */
const slope = (p0: Point, p1: Point, p2: Point, u: number): number => {
  const dx = 2 * (1 - u) * (p1[0] - p0[0]) + 2 * u * (p2[0] - p1[0])
  const dy = 2 * (1 - u) * (p1[1] - p0[1]) + 2 * u * (p2[1] - p1[1])
  return (Math.atan2(dy, dx) * 180) / Math.PI
}

const START: Point = [-12, 4]
const SAG: Point = [500, 74]
const END: Point = [1012, 4]

const PHOTOS = COLOURS.map((colour, index) => {
  const u = (index + 0.5) / COLOURS.length
  const [x, y] = bezier(START, SAG, END, u)
  const big = index === Math.floor(COLOURS.length / 2)
  const width = big ? 40 : 34
  const height = big ? 47 : 40
  return {
    colour,
    x: round(x),
    y: round(y),
    width,
    height,
    angle: round(slope(START, SAG, END, u) * 0.6),
    radius: round(width * 0.12),
    // The invisible circle the pointer is measured against, centred on the peg.
    reach: round(Math.hypot(width / 2, height) + 2),
  }
})

export interface GarlandProps {
  readonly className?: string | undefined
}

/**
 * The brand's garland, large: a string that tightens, photos that drop one after the other and
 * then sway, and that a moving pointer pushes (the « breeze »). Decorative: it says nothing the
 * page does not, so it is hidden from assistive technology.
 *
 * Surface: the sign-in page, and only there (decided with Pierre, November 2026): the screens that
 * are the product's own wear the quiet logo, and the one screen a host meets first gets the
 * welcome.
 *
 * Motion: the fall and the sway are CSS inside `prefers-reduced-motion: no-preference`, so under
 * the preference the garland is simply there, still; the breeze reads the preference itself and
 * does nothing under it. No inline style in the markup (the CSP is `style-src 'self'`); the
 * breeze moves each photo through the CSSOM.
 */
export function Garland({ className }: GarlandProps) {
  const svg = useRef<SVGSVGElement>(null)

  // The pointer is read over the frame around the garland, not over the drawing alone, so a hand
  // crossing the page above the photos still sets them swinging.
  useEffect(() => {
    const element = svg.current
    return element === null ? undefined : breeze(element, element.parentElement)
  }, [])

  return (
    <svg
      ref={svg}
      className={cx(styles['garland'], className)}
      viewBox="0 0 1000 108"
      aria-hidden="true"
      focusable="false"
    >
      <path
        className={styles['string']}
        d={`M${START[0]} ${START[1]}Q${SAG[0]} ${SAG[1]} ${END[0]} ${END[1]}`}
        pathLength="1"
        fill="none"
        strokeWidth="4"
        strokeLinecap="round"
      />
      {PHOTOS.map((photo) => (
        <g key={photo.x} className={styles['drop']}>
          <g className={styles['sway']}>
            <g className={styles['hang']} data-breeze-photo="">
              <circle cx={photo.x} cy={photo.y} r={photo.reach} fill="none" />
              <g transform={`rotate(${photo.angle} ${photo.x} ${photo.y})`}>
                <rect
                  className={styles[photo.colour]}
                  x={round(photo.x - photo.width / 2)}
                  y={round(photo.y - 1)}
                  width={photo.width}
                  height={photo.height}
                  rx={photo.radius}
                />
                <rect
                  className={styles['peg']}
                  x={round(photo.x - 4)}
                  y={round(photo.y - 8.5)}
                  width="8"
                  height="17"
                  rx="2.6"
                />
              </g>
            </g>
          </g>
        </g>
      ))}
    </svg>
  )
}
