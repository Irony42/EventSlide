import type { ElementType, HTMLAttributes, ReactNode } from 'react'
import styles from './Card.module.css'

export type CardHeadingLevel = 'h1' | 'h2' | 'h3'

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  readonly title?: ReactNode
  readonly subtitle?: ReactNode
  readonly footer?: ReactNode
  /**
   * The level of the title's heading. It is a prop, not a fixed `h2`, because heading
   * order is per page: the moderation console's cards sit under an `h1`, the admin
   * dashboard's sit under an `h2`.
   */
  readonly as?: CardHeadingLevel
  readonly children?: ReactNode
}

/**
 * Grouped content on `--surface-raised`.
 *
 * A Card is never clickable. 1.0's moderation tile was a `<div role="button">` with a
 * nested delete button held together by `stopPropagation`; put a Button or a link
 * inside the card instead.
 */
export function Card({
  title,
  subtitle,
  footer,
  as: Heading = 'h2',
  className,
  children,
  ...rest
}: CardProps) {
  // With a title the card is a titled region worth landmarking; without one it is a
  // plain panel, and an unlabelled <section> would add a level to the outline for
  // nothing.
  const Wrapper: ElementType = title === undefined ? 'div' : 'section'
  const classes = [styles['card'], className].filter(Boolean).join(' ')

  return (
    <Wrapper {...rest} className={classes}>
      {title === undefined ? null : (
        <div className={styles['header']}>
          <Heading className={styles['title']}>{title}</Heading>
          {subtitle === undefined ? null : <p className={styles['subtitle']}>{subtitle}</p>}
        </div>
      )}
      {children === undefined ? null : <div className={styles['body']}>{children}</div>}
      {footer === undefined ? null : <div className={styles['footer']}>{footer}</div>}
    </Wrapper>
  )
}
