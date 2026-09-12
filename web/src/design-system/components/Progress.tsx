import type { CSSProperties } from 'react'
import { fr } from '../../lib/i18n/fr'
import styles from './Progress.module.css'

export type ProgressTone = 'accent' | 'success' | 'danger' | 'warning'

export interface ProgressProps {
  readonly value: number
  readonly max?: number
  /** The accessible name. A bare "progressbar" tells a screen reader nothing. */
  readonly label: string
  readonly tone?: ProgressTone
  /** Render the percentage as text next to the bar. */
  readonly showValue?: boolean
  /**
   * Announce the percentage as it changes. Off by default: an upload queue owns one
   * live region for the whole queue, and one region per photo would talk over itself.
   */
  readonly announce?: boolean
  readonly className?: string
}

/**
 * `--progress-value` is one of exactly two custom properties this app sets from
 * JavaScript, because it is genuinely computed. Intersecting `CSSProperties` with the
 * property declares it instead of casting the object.
 */
type TrackStyle = CSSProperties & { readonly '--progress-value': string }

/** A determinate bar: upload progress and event quota. */
export function Progress({
  value,
  max = 100,
  label,
  tone = 'accent',
  showValue = false,
  announce = false,
  className,
}: ProgressProps) {
  // A zero or negative max would divide by zero; a byte quota of 0 is a real server
  // response for an event whose quota was never set.
  const safeMax = max > 0 ? max : 1
  const clamped = Math.min(Math.max(value, 0), safeMax)
  const percent = Math.round((clamped / safeMax) * 100)

  const trackStyle: TrackStyle = { '--progress-value': `${percent}%` }
  const liveProps: { readonly 'aria-live'?: 'polite' } = announce ? { 'aria-live': 'polite' } : {}
  const classes = [styles['progress'], styles[tone], className].filter(Boolean).join(' ')

  return (
    <div className={classes}>
      <div
        className={styles['track']}
        role="progressbar"
        aria-label={label}
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-valuetext={fr.ui.percent(percent)}
      >
        <div className={styles['fill']} style={trackStyle} />
      </div>
      {showValue || announce ? (
        <span className={showValue ? styles['value'] : 'visually-hidden'} {...liveProps}>
          {fr.ui.percent(percent)}
        </span>
      ) : null}
    </div>
  )
}
