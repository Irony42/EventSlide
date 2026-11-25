import { useEffect, useRef, type ReactNode } from 'react'
import { Button } from '../../../design-system/components/Button'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import styles from './SidePanel.module.css'

export interface SidePanelProps {
  /** Names the panel for the entry that opens it (`aria-controls`) and for the page's focus. */
  readonly id: string
  readonly title: string
  readonly onClose: () => void
  /** The panel was opened by the host (not by a reload on its address): the focus goes to its title. */
  readonly focusOnMount?: boolean
  readonly children: ReactNode
  /** The save indicator, and the primary action when there is one: it stays in reach while the body scrolls. */
  readonly footer?: ReactNode
}

/**
 * A panel that **replaces the left column** (never the preview): a header with its title and
 * « Fermer », a body that scrolls on its own and a footer that stays. Escape closes it, unless a
 * dialog or a popup is the one that is listening. The focus goes to the title when it
 * opens; whoever closes it gives the focus back to the entry that opened it.
 */
export function SidePanel({
  id,
  title,
  onClose,
  focusOnMount = false,
  children,
  footer,
}: SidePanelProps) {
  const t = useTranslations()
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (focusOnMount) heading.current?.focus()
  }, [focusOnMount])

  // Escape closes the panel wherever the focus is on the page (a reload on its address leaves it on
  // the body), unless a dialog or an open popup is the one that is listening.
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('dialog, [role="dialog"], [aria-expanded="true"]') != null) return
      if (document.querySelector('dialog[open]') !== null) return
      close.current()
    }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [])

  return (
    <section id={id} className={styles['panel']} aria-labelledby={`${id}-title`}>
      <div className={styles['header']}>
        <h2 ref={heading} id={`${id}-title`} tabIndex={-1} className={styles['title']}>
          {title}
        </h2>
        <Button variant="ghost" onClick={onClose}>
          {t.app.close}
        </Button>
      </div>
      <div className={styles['body']}>{children}</div>
      {footer === undefined ? null : (
        <div className={styles['footer']} data-panel-footer>
          {footer}
        </div>
      )}
    </section>
  )
}
