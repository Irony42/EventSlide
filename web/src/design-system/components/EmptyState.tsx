import type { HTMLAttributes, ReactNode } from 'react'
import styles from './EmptyState.module.css'

export type EmptyStateHeadingLevel = 'h1' | 'h2' | 'h3'

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  readonly title: string
  /** One sentence saying the screen is working and what happens next. */
  readonly description?: string
  readonly icon?: ReactNode
  /** At most one action. Two choices in an empty state is a menu, not a next step. */
  readonly action?: ReactNode
  /** Heading level, so the page it lands in keeps a correct outline. */
  readonly as?: EmptyStateHeadingLevel
}

/**
 * The zero-item state.
 *
 * This is the component 1.0 lacked entirely: the moderation console rendered an empty
 * grid before the first photo arrived, which is indistinguishable from a screen that
 * failed to load — and a host with a projector waiting reloads, then reboots.
 */
export function EmptyState({
  title,
  description,
  icon,
  action,
  as: Heading = 'h2',
  className,
  children,
  ...rest
}: EmptyStateProps) {
  const classes = [styles['empty'], className].filter(Boolean).join(' ')

  return (
    <div {...rest} className={classes}>
      {icon === undefined ? null : (
        <span className={styles['icon']} aria-hidden="true">
          {icon}
        </span>
      )}
      <Heading className={styles['title']}>{title}</Heading>
      {description === undefined ? null : <p className={styles['description']}>{description}</p>}
      {children}
      {action === undefined ? null : <div className={styles['action']}>{action}</div>}
    </div>
  )
}
