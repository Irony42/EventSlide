import { useId, type ReactNode } from 'react'
import styles from './SettingsSection.module.css'

export interface SettingsSectionProps {
  /** The anchor of the section (`#wall`), so a link or a reload can open it. */
  readonly id: string
  readonly title: string
  /** One line saying what the section is set to, read while it is closed. */
  readonly summary: string
  readonly open: boolean
  readonly onToggle: () => void
  readonly children: ReactNode
}

/**
 * One group of the settings page: a heading that opens and closes it, and the line that says what
 * it holds while it is closed.
 *
 * The body stays mounted when closed (`hidden`), so a field keeps what it was doing — a file being
 * chosen, a sound being played — and the page knows every control the server may answer about.
 * The disclosure pattern of the WAI: a button inside the heading, `aria-expanded`, `aria-controls`.
 */
export function SettingsSection({
  id,
  title,
  summary,
  open,
  onToggle,
  children,
}: SettingsSectionProps) {
  const bodyId = useId()
  const titleId = useId()
  const summaryId = useId()
  return (
    <section id={id} className={open ? styles['sectionOpen'] : styles['section']}>
      <h2 className={styles['heading']}>
        <button
          type="button"
          className={styles['toggle']}
          aria-expanded={open}
          aria-controls={bodyId}
          // Named by the title alone, described by the summary: "Invités", then what it holds.
          aria-labelledby={titleId}
          aria-describedby={summaryId}
          onClick={onToggle}
        >
          <span className={styles['text']}>
            <span id={titleId} className={styles['title']}>
              {title}
            </span>
            <span id={summaryId} className={styles['summary']}>
              {summary}
            </span>
          </span>
          <span className={styles['chevron']} aria-hidden="true" />
        </button>
      </h2>
      <div id={bodyId} className={styles['body']} hidden={!open}>
        {children}
      </div>
    </section>
  )
}
