import type { CSSProperties, ReactNode } from 'react'
import styles from './PreviewBox.module.css'

export interface PreviewBoxProps {
  /** The shape of the thing drawn, width then height; `null` for one that fills the room (a message). */
  readonly ratio: readonly [number, number] | null
  readonly label: string
  readonly children: ReactNode
}

/**
 * The room a preview is drawn in: the whole height the page gives it, and the largest box of the
 * preview's own shape that fits in it. The box is reserved before anything is drawn, so the layout
 * does not move when a preview redraws, and it never grows past the screen.
 */
export function PreviewBox({ ratio, label, children }: PreviewBoxProps) {
  const shape =
    ratio === null
      ? undefined
      : ({ '--ratio-w': String(ratio[0]), '--ratio-h': String(ratio[1]) } as CSSProperties)
  return (
    <section className={styles['stage']} aria-label={label}>
      <div className={styles['fit']} data-fill={ratio === null} style={shape}>
        {children}
      </div>
    </section>
  )
}
