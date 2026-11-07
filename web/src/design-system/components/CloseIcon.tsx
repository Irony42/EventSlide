import { cx } from '../classNames'
import styles from './CloseIcon.module.css'
import { CROSS_PATH } from './iconPaths'

export interface CloseIconProps {
  readonly className?: string | undefined
}

/**
 * The dismiss glyph, for `IconButton`'s `icon` slot.
 *
 * It lives here rather than in each caller for the same reason `StatusIcon` does: the
 * path is drawn once, and there is no icon font or sprite to fetch — the CSP forbids a
 * remote one and a venue's Wi-Fi would drop it anyway.
 *
 * Always `aria-hidden`: the button's `aria-label` is the accessible name.
 */
export function CloseIcon({ className }: CloseIconProps) {
  const classes = cx(styles['icon'], className)

  return (
    <svg className={classes} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d={CROSS_PATH} fill="currentColor" />
    </svg>
  )
}
