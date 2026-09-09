import type { ElementType, HTMLAttributes, ReactNode } from 'react'
import styles from './Stack.module.css'

/** A step on the space scale, never a length: `gap="3"` is `var(--space-3)`. */
export type StackGap = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '8' | '10'
export type StackDirection = 'row' | 'column'
export type StackAlign = 'start' | 'center' | 'end' | 'stretch' | 'baseline'
export type StackJustify = 'start' | 'center' | 'end' | 'between'

export interface StackProps extends HTMLAttributes<HTMLElement> {
  /** Layout containers only. Anything focusable or form-related brings its own element. */
  readonly as?: 'div' | 'section' | 'header' | 'footer' | 'nav' | 'ul' | 'ol' | 'li' | 'fieldset'
  readonly direction?: StackDirection
  readonly gap?: StackGap
  readonly align?: StackAlign
  readonly justify?: StackJustify
  readonly wrap?: boolean
  readonly children?: ReactNode
}

/**
 * The layout workhorse.
 *
 * It exists so no feature hand-writes `display: flex` and its own margins: 1.0's
 * markup was `className="d-flex flex-wrap gap-2 mb-3"` utility soup, where the layout
 * intent was unreadable and every screen chose a slightly different rhythm.
 *
 * Class names are read with bracket access throughout the design system: a CSS module
 * is typed as an index signature and `noPropertyAccessFromIndexSignature` is on.
 */
export function Stack({
  as = 'div',
  direction = 'column',
  gap = '4',
  align = 'stretch',
  justify = 'start',
  wrap = false,
  className,
  children,
  ...rest
}: StackProps) {
  const Element: ElementType = as
  const classes = [
    styles['stack'],
    styles[direction],
    styles[`gap${gap}`],
    styles[`align-${align}`],
    styles[`justify-${justify}`],
    wrap ? styles['wrap'] : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <Element {...rest} className={classes}>
      {children}
    </Element>
  )
}
