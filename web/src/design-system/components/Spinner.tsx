import styles from './Spinner.module.css'

export interface SpinnerProps {
  readonly size?: 'sm' | 'md' | 'lg'
  /**
   * An accessible label. Omit it when the spinner sits inside something that already
   * announces the wait — a button with `aria-busy`, or a region with `aria-live`.
   * Two announcements of the same wait is worse than one.
   */
  readonly label?: string
}

export function Spinner({ size = 'md', label }: SpinnerProps) {
  return (
    <span
      className={`${styles['spinner']} ${styles[size]}`}
      role={label ? 'status' : undefined}
      aria-hidden={label ? undefined : true}
    >
      {label ? <span className="visually-hidden">{label}</span> : null}
    </span>
  )
}
