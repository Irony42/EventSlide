import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cx } from '../classNames'
import styles from './IconButton.module.css'

export type IconButtonVariant = 'ghost' | 'solid' | 'danger'
export type IconButtonSize = 'md' | 'lg'

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-label' | 'children'
> {
  /**
   * Required by the type, not by review. An icon-only button without one is a silent
   * "button" to a screen reader, and 1.0 shipped four of them on the moderation tile.
   */
  readonly 'aria-label': string
  readonly icon: ReactNode
  readonly variant?: IconButtonVariant
  readonly size?: IconButtonSize
}

/** An icon-only affordance: close, delete, next. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    'aria-label': ariaLabel,
    icon,
    variant = 'ghost',
    size = 'md',
    className,
    type = 'button',
    ...rest
  },
  ref,
) {
  const classes = cx(styles['iconButton'], styles[variant], styles[size], className)

  return (
    <button {...rest} ref={ref} type={type} className={classes} aria-label={ariaLabel}>
      <span className={styles['glyph']} aria-hidden="true">
        {icon}
      </span>
    </button>
  )
})
