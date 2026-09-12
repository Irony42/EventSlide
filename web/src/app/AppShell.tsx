import type { ReactNode } from 'react'
import { fr } from '../lib/i18n/fr'
import styles from './AppShell.module.css'

/** Which of the three surfaces this page is. It decides the container, nothing else. */
export type Surface = 'guest' | 'host' | 'wall'

export const MAIN_CONTENT_ID = 'main-content'

export interface AppShellProps {
  readonly surface: Surface
  /** A toolbar or a header bar. The wall passes none: there is nobody to click it. */
  readonly header?: ReactNode
  readonly children: ReactNode
  readonly className?: string
}

/**
 * The layout wrapper.
 *
 * It owns two things a page must not reinvent: the skip link, and the container width
 * for the surface. A control that is comfortable on a laptop is unusable at arm's
 * length on a phone, so the width comes from the surface rather than from the page.
 */
export function AppShell({ surface, header, children, className }: AppShellProps) {
  const classes = [styles['main'], styles[surface], className].filter(Boolean).join(' ')

  return (
    <div className={styles['shell']}>
      <a className={styles['skipLink']} href={`#${MAIN_CONTENT_ID}`}>
        {fr.shell.skipToContent}
      </a>
      {header}
      <main id={MAIN_CONTENT_ID} className={classes}>
        {children}
      </main>
    </div>
  )
}
