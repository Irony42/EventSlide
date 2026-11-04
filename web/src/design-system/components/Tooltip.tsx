import { useId, type ReactNode } from 'react'
import styles from './Tooltip.module.css'

export interface TooltipProps {
  /** What the tip says: the control's name, then its key. */
  readonly text: string
  /** Receives the id to give the control as `aria-describedby`. */
  readonly children: (describedBy: string) => ReactNode
}

/**
 * The name of an icon-only control, with its key, shown on hover **and** on keyboard focus.
 *
 * Pure CSS (`:hover`, `:focus-within`) and with no transition, so it asks nothing of the
 * motion budget. It describes the control rather than naming it: the accessible name stays the
 * control's own `aria-label`, which is why the tip is not read as a second name.
 */
export function Tooltip({ text, children }: TooltipProps) {
  const id = useId()

  return (
    <span className={styles['wrap']}>
      {children(id)}
      <span id={id} role="tooltip" className={styles['tip']}>
        {text}
      </span>
    </span>
  )
}
