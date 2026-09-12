import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Spinner } from './Spinner'
import styles from './Button.module.css'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant
  readonly size?: ButtonSize
  /** Full width. The guest surface is a single column, so its primary action always is. */
  readonly block?: boolean
  readonly loading?: boolean
  readonly icon?: ReactNode
}

/**
 * The one button.
 *
 * `type="button"` by default: an unspecified button inside a form submits it, which is
 * how a "remove this photo" control ends up sending the whole queue.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    block = false,
    loading = false,
    icon,
    disabled,
    className,
    children,
    type = 'button',
    ...rest
  },
  ref,
) {
  const classes = [
    styles['button'],
    styles[variant],
    styles[size],
    block ? styles['block'] : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      className={classes}
      // aria-busy keeps the accessible name and the focus. Swapping the label for a
      // spinner would announce nothing and drop the button out of the tab order at
      // exactly the moment the user is waiting on it.
      aria-busy={loading || undefined}
      disabled={disabled === true || loading}
    >
      {loading ? <Spinner size="sm" /> : icon}
      {children}
    </button>
  )
})
