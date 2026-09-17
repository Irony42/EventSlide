import { useEffect, type ReactNode } from 'react'
import { useLocale } from '../lib/i18n/useTranslations'
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
 * It owns three things a page must not reinvent: the skip link, the container width for
 * the surface, and `<html lang>`.
 *
 * A control that is comfortable on a laptop is unusable at arm's length on a phone, so
 * the width comes from the surface rather than from the page.
 *
 * `lang` is here and nowhere else because this is the innermost component that every
 * screen renders through, so whatever language is in scope *at this point in the tree*
 * is the language actually on screen — French under the host and wall layouts, the
 * guest's own under theirs. Setting it higher up would announce the guest's German to a
 * screen reader on a French admin console. It is not cosmetic: it is what decides which
 * voice a screen reader pronounces the page with, and `index.html` ships `lang="fr"` so
 * the first paint is right before React has mounted anything.
 */
export function AppShell({ surface, header, children, className }: AppShellProps) {
  const { locale, text } = useLocale()
  const classes = [styles['main'], styles[surface], className].filter(Boolean).join(' ')

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  return (
    <div className={styles['shell']}>
      <a className={styles['skipLink']} href={`#${MAIN_CONTENT_ID}`}>
        {text.shell.skipToContent}
      </a>
      {header}
      <main id={MAIN_CONTENT_ID} className={classes}>
        {children}
      </main>
    </div>
  )
}
