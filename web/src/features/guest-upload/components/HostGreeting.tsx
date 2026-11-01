import styles from './HostGreeting.module.css'

export interface HostGreetingProps {
  /** The host's own words (spec 03): content, shown exactly as written and never translated. */
  readonly message: string | null | undefined
  /** `compact` on the upload screen, where the composer must stay in reach of the thumb. */
  readonly variant?: 'full' | 'compact'
}

/**
 * What the host says to their guests. Nothing when they said nothing: the screen is then
 * strictly what it was before this existed.
 *
 * Plain text rendered by React (escaped), with the line breaks the host kept
 * (`white-space: pre-line`), clamped to four lines, and no state: nothing to open, nothing
 * remembered, nothing to press on a screen that must stay zero friction.
 */
export function HostGreeting({ message, variant = 'full' }: HostGreetingProps) {
  if (message === null || message === undefined || message.length === 0) return null
  return (
    <p
      className={variant === 'compact' ? styles['compact'] : styles['full']}
      dir="auto"
      data-testid="host-greeting"
    >
      {message}
    </p>
  )
}
