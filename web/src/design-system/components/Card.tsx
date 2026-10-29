import type { ElementType, HTMLAttributes, ReactNode, RefObject } from 'react'
import { cx } from '../classNames'
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
  /**
   * Makes the title something a script can send focus to, and hands it the element.
   *
   * For a card a control elsewhere on the page points at ("see my uploads"): a screen reader
   * guest is then taken to the heading and reads on from there, instead of being left on a
   * button that has scrolled away. The heading is `tabIndex={-1}`: focusable by a script, never
   * a stop of its own in the tab order.
   */
  readonly titleRef?: RefObject<HTMLHeadingElement | null> | undefined
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
  titleRef,
  className,
  children,
  ...rest
}: CardProps) {
  // With a title the card is a titled region worth landmarking; without one it is a
  // plain panel, and an unlabelled <section> would add a level to the outline for
  // nothing.
  const Wrapper: ElementType = title === undefined ? 'div' : 'section'
  const classes = cx(styles['card'], className)

  return (
    <Wrapper {...rest} className={classes}>
      {title === undefined ? null : (
        <div className={styles['header']}>
          <Heading
            ref={titleRef}
            tabIndex={titleRef === undefined ? undefined : -1}
            className={styles['title']}
          >
            {title}
          </Heading>
          {subtitle === undefined ? null : <p className={styles['subtitle']}>{subtitle}</p>}
        </div>
      )}
      {children === undefined ? null : <div className={styles['body']}>{children}</div>}
      {footer === undefined ? null : <div className={styles['footer']}>{footer}</div>}
    </Wrapper>
  )
}
