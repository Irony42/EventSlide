import styles from './CloseIcon.module.css'

export interface CloseIconProps {
  readonly className?: string
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
  const classes = [styles['icon'], className].filter(Boolean).join(' ')

  return (
    <svg className={classes} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M4.2 3.1 8 6.9l3.8-3.8 1.1 1.1L9.1 8l3.8 3.8-1.1 1.1L8 9.1l-3.8 3.8-1.1-1.1L6.9 8 3.1 4.2z"
        fill="currentColor"
      />
    </svg>
  )
}
