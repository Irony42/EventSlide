import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ConfirmDialog } from '../design-system/components/ConfirmDialog'

export interface LeaveGuardProps {
  /** Something is on screen that exists nowhere else and has not been taken yet. */
  readonly when: boolean
  readonly title: string
  /** What is lost by leaving, concretely. */
  readonly description: string
  /** The safe choice, focused first: keep the page. */
  readonly stayLabel: string
  readonly leaveLabel: string
}

/** The address a click on this anchor would open inside the app, or `null` when it is not ours. */
const inAppTarget = (event: MouseEvent): string | null => {
  // A click that does something other than "go there in this tab" is not a way off the page.
  if (event.defaultPrevented || event.button !== 0) return null
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null
  const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
  if (!(anchor instanceof HTMLAnchorElement)) return null
  if (anchor.target !== '' && anchor.target !== '_self') return null
  if (anchor.hasAttribute('download')) return null
  const url = new URL(anchor.href, window.location.href)
  // Another origin is a real page load, which the browser's own prompt (`beforeunload`) asks about.
  if (url.origin !== window.location.origin) return null
  const here = `${window.location.pathname}${window.location.search}`
  const target = `${url.pathname}${url.search}`
  // The page you are on is not a way off it.
  return target === here ? null : `${target}${url.hash}`
}

/**
 * Asks before the person leaves a page that holds something they cannot get again.
 *
 * Surface: **the host and the operator**, on a page that shows a secret once: the recovery codes
 * of the second factor (H8), the invitation link of a client created on a box with no mail (H10).
 * Both are held in the page's own state and nowhere else (not stored, not in the address), so a
 * click on the breadcrumb, a menu entry or the footer used to lose them without a word.
 *
 * Three ways off the page, and what this does with each:
 *
 * - **A link inside the app** (menu, breadcrumb, footer): stopped in the capture phase, before the
 *   router sees it, and put to the person in a dialog whose safe choice is to stay. Leaving
 *   navigates to the address that was clicked.
 * - **Closing the tab, reloading, a link to another site**: the browser's own prompt
 *   (`beforeunload`). Its wording is the browser's and cannot be changed.
 * - **Back and Forward, and the sign-out button**: **not stopped.** `BrowserRouter` has no way to
 *   block a history move (`useBlocker` needs a data router), and a sign-out is the person's own,
 *   explicit act. This is a known limit, not a promise.
 */
export function LeaveGuard({ when, title, description, stayLabel, leaveLabel }: LeaveGuardProps) {
  const navigate = useNavigate()
  const [pending, setPending] = useState<string | null>(null)

  useEffect(() => {
    if (!when) return

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      // Some engines only prompt when the legacy property is set.
      event.returnValue = ''
    }
    const onClick = (event: MouseEvent) => {
      const target = inAppTarget(event)
      if (target === null) return
      event.preventDefault()
      event.stopPropagation()
      setPending(target)
    }

    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('click', onClick, true)
    }
  }, [when])

  return (
    <ConfirmDialog
      open={when && pending !== null}
      title={title}
      description={description}
      cancelLabel={stayLabel}
      confirmLabel={leaveLabel}
      onCancel={() => setPending(null)}
      onConfirm={() => {
        const target = pending
        setPending(null)
        if (target !== null) navigate(target)
      }}
    />
  )
}
