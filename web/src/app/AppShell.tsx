import { useLayoutEffect, type ReactNode } from 'react'
import { cx } from '../design-system/classNames'
import { useLocale } from '../lib/i18n/useTranslations'
import styles from './AppShell.module.css'

/** Which of the three surfaces this page is. It decides the container, nothing else. */
export type Surface = 'guest' | 'host' | 'wall'

export const MAIN_CONTENT_ID = 'main-content'

export interface AppShellProps {
  readonly surface: Surface
  /** A toolbar or a header bar. The wall passes none: there is nobody to click it. */
  readonly header?: ReactNode
  /**
   * The line under the page: the AGPL source offer (`SiteFooter`). The guest and host
   * layouts pass it and **the wall does not**, which is how the projected screen stays a
   * photograph and a QR code: a footer there would be the one thing in the frame that is
   * not the party, and nobody in that room is the person the offer is made to.
   */
  readonly footer?: ReactNode
  readonly children: ReactNode
  readonly className?: string | undefined
}

/**
 * The layout wrapper.
 *
 * It owns three things a page must not reinvent: the skip link, the container width for
 * the surface and `<html lang>`.
 *
 * A control that is comfortable on a laptop is unusable at arm's length on a phone, so
 * the width comes from the surface rather than from the page.
 *
 * `lang` is here and nowhere else because this is the innermost component that every
 * screen renders through, so whatever language is in scope *at this point in the tree*
 * is the language actually on screen — the reader's own under the guest and host
 * layouts, and the **event's** under the wall's, which is a language nobody standing at
 * that screen chose (`lib/i18n/deferredLocale.ts` says how it gets here, and why it
 * arrives a round trip late). Setting it higher up would announce the projector
 * operator's English to a screen reader on a German wall. It is not cosmetic: it is what
 * decides which voice a screen reader pronounces the page with, and `index.html` ships
 * `lang="fr"` so the first paint is right before React has mounted anything.
 */
export function AppShell({ surface, header, footer, children, className }: AppShellProps) {
  const { locale, text } = useLocale()
  const classes = cx(styles['main'], styles[surface], className)

  // A layout effect, not a passive one: it runs inside the commit that puts the words on
  // screen, so no frame ever shows Italian under `lang="fr"`. A passive effect ran a turn
  // later, and `router.test.tsx` measures the difference at the first mutation.
  useLayoutEffect(() => {
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
      {footer}
    </div>
  )
}
