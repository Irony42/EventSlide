import { forwardRef, type TextareaHTMLAttributes } from 'react'
import { cx } from '../classNames'
import styles from './Textarea.module.css'

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /**
   * Grow with the value instead of scrolling inside a fixed box. On by default: a
   * guest writing a caption on a phone cannot see a two-line box scroll.
   */
  readonly grow?: boolean
}

/** Multi-line text. The photo caption is the only one in the product today. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { grow = true, className, rows = 2, ...rest },
  ref,
) {
  const classes = cx(styles['textarea'], grow && styles['grow'], className)

  return <textarea {...rest} ref={ref} rows={rows} className={classes} />
})
