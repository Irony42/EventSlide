import type { ReactNode } from 'react'
import styles from './WallTopCentre.module.css'

export interface WallTopCentreProps {
  /**
   * What holds the top-centre place now: the challenge banner, else the announcement's countdown,
   * else the souvenir counter. At most one, chosen by the page; `null` when none is there.
   */
  readonly occupant: ReactNode
  /** The discreet announcement's pill, stacked under the occupant; `null` when none is there. */
  readonly pill: ReactNode
}

/**
 * The wall's top-centre column (spec 21, rule 19): the occupant of the place, then the pill under it.
 *
 * It is **chrome**, like the counter and the banners it holds, not content of a layout: no layout
 * reserves room for the pill. It spends the same place the occupants always did (inside the overscan
 * inset), and stacks instead of overlaying, so the pill never covers the banner or the counter.
 *
 * Renders nothing when both are empty: a wall without any of them is exactly the wall it was.
 */
export function WallTopCentre({ occupant, pill }: WallTopCentreProps) {
  if (occupant === null && pill === null) return null
  return (
    <div className={styles['column']} data-wall-top-centre="">
      {occupant}
      {pill}
    </div>
  )
}
