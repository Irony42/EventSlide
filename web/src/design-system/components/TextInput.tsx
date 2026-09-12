import { forwardRef, type InputHTMLAttributes } from 'react'
import styles from './TextInput.module.css'

export type TextInputVariant = 'text' | 'code'

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** `code` is the six-character join code: larger, spaced, centred, uppercased. */
  readonly variant?: TextInputVariant
}

/**
 * Single-line text.
 *
 * The invalid state is read from `aria-invalid`, which `Field` sets, rather than from
 * a second `invalid` prop — two sources for one fact drift, and it was the styled-but-
 * not-announced input that made 1.0's login form unusable with a screen reader.
 */
export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { variant = 'text', className, type = 'text', ...rest },
  ref,
) {
  const classes = [styles['input'], variant === 'code' ? styles['code'] : '', className]
    .filter(Boolean)
    .join(' ')

  return <input {...rest} ref={ref} type={type} className={classes} />
})
