import styles from './StatusIcon.module.css'

export type StatusTone = 'neutral' | 'success' | 'danger' | 'warning' | 'accent'

export interface StatusIconProps {
  readonly tone: StatusTone
  readonly className?: string
}

/**
 * The glyph half of a status.
 *
 * Colour is never the only signal (DESIGN-SYSTEM.md section 8): a red-green
 * colourblind host under stage lighting must still be able to tell a published photo
 * from a refused one. Every component that carries a tone pairs it with this shape and
 * with a word, and the paths live here once rather than being pasted into Badge, Toast
 * and Field separately.
 *
 * Always `aria-hidden`: the word next to it is the accessible content.
 */
const PATHS: Record<StatusTone, string> = {
  // Check
  success: 'M6.4 11.7 3.1 8.4l1.2-1.2 2.1 2.1 5.3-5.3 1.2 1.2z',
  // Cross
  danger:
    'M4.2 3.1 8 6.9l3.8-3.8 1.1 1.1L9.1 8l3.8 3.8-1.1 1.1L8 9.1l-3.8 3.8-1.1-1.1L6.9 8 3.1 4.2z',
  // Bang
  warning: 'M7.2 2.8h1.6l-.25 6.4H7.45zM8 11a1.1 1.1 0 1 1 0 2.2A1.1 1.1 0 0 1 8 11z',
  // Dot on a stem: an "i" without depending on a font
  accent: 'M7.2 6.6h1.6V13.2H7.2zM8 2.8a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2z',
  // Hollow circle: present, but claiming nothing
  neutral: 'M8 3a5 5 0 1 0 0 10A5 5 0 0 0 8 3zm0 1.6A3.4 3.4 0 1 1 8 11.4 3.4 3.4 0 0 1 8 4.6z',
}

export function StatusIcon({ tone, className }: StatusIconProps) {
  const classes = [styles['icon'], className].filter(Boolean).join(' ')

  return (
    <svg className={classes} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d={PATHS[tone]} fill="currentColor" />
    </svg>
  )
}
