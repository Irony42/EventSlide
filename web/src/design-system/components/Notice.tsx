import type { ReactNode } from 'react'
import { StatusIcon, type StatusTone } from './StatusIcon'
import { cx } from '../classNames'
import styles from './Notice.module.css'

export type NoticeTone = StatusTone

/**
 * `boxed`: a block of its own, framed in the tone's colour, the ink left alone. A
 * failure, a caution or a disclosure that stands apart from what is around it.
 *
 * `inline`: no frame, and the sentence itself takes the tone's colour. For a line that is
 * attached to something else — the message under a field, under a progress bar.
 */
export type NoticeVariant = 'boxed' | 'inline'

export interface NoticeProps {
  readonly tone: NoticeTone
  /**
   * What a screen reader does when the notice appears.
   *
   * `alert` interrupts, so it is for a failure the person must hear now. `status` is
   * announced politely, in turn. Left out, the notice says nothing by itself: static text
   * that is read in place, or text inside a live region the page already owns.
   *
   * A role announces the moment its node is inserted, so mount the notice only while
   * there is something to say rather than keeping an empty one in the page.
   */
  readonly role?: 'alert' | 'status'
  /**
   * Required, with no default: the two look different enough that a call site must say
   * which it is, and a notice copied from one screen into another cannot quietly change
   * its look by leaving the choice out.
   */
  readonly variant: NoticeVariant
  /** For a control's `aria-describedby`. */
  readonly id?: string | undefined
  readonly className?: string | undefined
  /** The sentence: the accessible content, already in the reader's language. */
  readonly children: ReactNode
}

/**
 * A status glyph and the sentence that says what it means.
 *
 * Colour is never the only signal (DESIGN-SYSTEM.md section 8): the tone picks a shape
 * from `StatusIcon` as well as a colour, so a red-green colourblind host under stage
 * lighting can still tell a caution from a refusal. The glyph is `aria-hidden` and the
 * sentence is what is announced.
 *
 * The glyph sits in a span of its own rather than carrying a class: the span holds the
 * tone's colour and keeps the glyph from shrinking in the row, and the optical nudge
 * lines it up with the first line of a sentence that wraps.
 */
export function Notice({ tone, role, variant, id, className, children }: NoticeProps) {
  const classes = cx(styles['notice'], styles[variant], styles[tone], className)

  return (
    <p className={classes} role={role} id={id}>
      <span className={styles['glyph']}>
        <StatusIcon tone={tone} />
      </span>
      {/* One flex item for the whole sentence, so a link or an emphasis inside it does not
          split the row into columns. */}
      <span>{children}</span>
    </p>
  )
}
