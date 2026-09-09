import type { ReactNode } from 'react'
import { StatusIcon, type StatusTone } from './StatusIcon'
import styles from './Badge.module.css'

export type BadgeTone = StatusTone

export interface BadgeProps {
  readonly tone?: BadgeTone
  /**
   * Required: the word is what makes the badge readable. A coloured dot on its own
   * carries no meaning for a colourblind host, or in a screenshot, or aloud.
   */
  readonly children: string
  /** Replaces the tone's default glyph. `null` drops it, for a badge that is a count. */
  readonly icon?: ReactNode
  readonly className?: string
}

export function Badge({ tone = 'neutral', children, icon, className }: BadgeProps) {
  const classes = [styles['badge'], styles[tone], className].filter(Boolean).join(' ')

  return (
    <span className={classes}>
      {icon === undefined ? <StatusIcon tone={tone} /> : icon}
      {children}
    </span>
  )
}
