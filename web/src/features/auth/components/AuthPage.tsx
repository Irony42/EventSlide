import { useLayoutEffect, useRef, type ReactNode } from 'react'
import styles from './AuthPage.module.css'

export interface AuthPageProps {
  readonly title: string
  readonly intro?: string
  /**
   * Move the keyboard to the heading when the page mounts.
   *
   * For a screen that appears **in answer to something**: the invitation once the link has
   * been read, a dead link, "check your inbox" where the form was a moment ago. Without it
   * the keyboard stays on whatever was removed (or nowhere), and a screen reader says
   * nothing about the page that replaced it. Not for a form that is simply the page the
   * person navigated to — there the browser's own start is right and a stolen focus would
   * be a surprise.
   */
  readonly focusTitle?: boolean
  readonly children?: ReactNode
}

/**
 * The frame every sign-in-side screen shares: a heading, a sentence, and what follows.
 *
 * `AuthForm` is this plus a form; the screens with no form (a dead link, the confirmation
 * that a mail is on its way) are this plus a link. One frame so they cannot drift apart in
 * width, spacing or focus behaviour.
 */
export function AuthPage({ title, intro, focusTitle = false, children }: AuthPageProps) {
  const heading = useRef<HTMLHeadingElement>(null)

  // A layout effect, so the keyboard is on the heading in the commit that shows the screen. A
  // passive one runs a tick later: for that tick the form is on screen and usable with the
  // focus on nothing, and a box the person focused in that tick is taken away from them when
  // the effect lands. Anything that reads the focus right after the screen appears (a test, a
  // screen reader) is racing it.
  useLayoutEffect(() => {
    if (focusTitle) heading.current?.focus()
  }, [focusTitle])

  return (
    <div className={styles['page']}>
      {/* -1: reachable by script, never a Tab stop. */}
      <h1 ref={heading} className={styles['title']} tabIndex={focusTitle ? -1 : undefined}>
        {title}
      </h1>
      {intro === undefined ? null : <p className={styles['intro']}>{intro}</p>}
      {children}
    </div>
  )
}

/** The row a screen's links and buttons sit in. */
export function AuthActions({ children }: { readonly children: ReactNode }) {
  return <div className={styles['actions']}>{children}</div>
}
