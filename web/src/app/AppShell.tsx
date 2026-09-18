import { useEffect, type ReactNode } from 'react'
import { glassSurfaceProps, type GlassBackdrop } from '../design-system/glass'
import { useLocale } from '../lib/i18n/useTranslations'
import { useInteractionBudget } from './useInteractionBudget'
import styles from './AppShell.module.css'

/** Which of the three surfaces this page is. It decides the container, nothing else. */
export type Surface = 'guest' | 'host' | 'wall'

export const MAIN_CONTENT_ID = 'main-content'

export interface AppShellProps {
  readonly surface: Surface
  /**
   * What the address under this shell can paint beneath a glass pane — roadmap 11.2.
   *
   * Omitted means `photo`, the floor that survives an unknown photograph. A default that
   * has to be argued for is the strict one: a screen nobody classified is a screen nobody
   * looked at, and the translucent tier is the claim that has to be earned. `router.tsx`
   * supplies it from `glassBackdrop.ts`, which is checked against the real import graph.
   */
  readonly backdrop?: GlassBackdrop
  /** A toolbar or a header bar. The wall passes none: there is nobody to click it. */
  readonly header?: ReactNode
  readonly children: ReactNode
  readonly className?: string
}

/**
 * The layout wrapper.
 *
 * It owns four things a page must not reinvent: the skip link, the container width for
 * the surface, `<html lang>`, and which tier of the glass material the surface may
 * afford (roadmap 11.3 — `design-system/glass.ts` holds the rule).
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
export function AppShell({ surface, backdrop, header, children, className }: AppShellProps) {
  const { locale, text } = useLocale()
  const classes = [styles['main'], styles[surface], className].filter(Boolean).join(' ')

  /**
   * What this machine has turned out to be able to afford — roadmap 11.3.
   *
   * The third input to the material, beside "which surface is this" and "what can be painted
   * underneath it". The first two are answered before anything renders; this one can only be
   * answered by the phone in somebody's hand, and on a venue's Wi-Fi mid-encode the answer is
   * sometimes no. The rule is `design-system/budget.ts` and the measurement is the browser's
   * own event timing; what arrives here is a rung, and `glassSurfaceProps` composes it with
   * the other two.
   */
  const budget = useInteractionBudget(surface)

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  return (
    /* The glass tier goes on the shell rather than on `<main>`, because the skip link is
       outside `<main>` and a header may be too: everything the surface renders has to
       inherit the same material. A surface on the default tier spreads nothing, so the DOM
       is unchanged wherever a photograph can appear — which includes the wall's baselines,
       and the two panes that wear the material today. */
    <div className={styles['shell']} {...glassSurfaceProps(surface, backdrop, budget)}>
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
