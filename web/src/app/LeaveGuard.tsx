import { useEffect, useId, useRef, useState } from 'react'
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

/** The anchor a click would follow inside this tab and this app, or `null` when it is not ours. */
const inAppAnchor = (event: MouseEvent): HTMLAnchorElement | null => {
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
  return target === here ? null : anchor
}

/**
 * The mark on the history entry this guard adds on top of the page's own.
 *
 * `BrowserRouter` has no way to block a history move (`useBlocker` needs a data router) and a
 * `popstate` cannot be cancelled: it fires after the browser has moved. So the guard keeps one
 * spare entry of the same address above the page's. Back pops that spare entry, which lands on the
 * page's own entry (same address, so the router re-renders the same screen and nothing unmounts),
 * and the guard puts the spare entry back and asks. Leaving goes back past both.
 */
const SPARE_ENTRY = 'eventslideLeaveGuard'

/** Whether the entry the browser is on is a spare one, and, given `owner`, that guard's own. */
const onSpareEntry = (owner?: string): boolean => {
  const state: unknown = window.history.state
  if (typeof state !== 'object' || state === null || !(SPARE_ENTRY in state)) return false
  return owner === undefined || (state as Record<string, unknown>)[SPARE_ENTRY] === owner
}

/** Puts the spare entry on top, with the router's bookkeeping (`idx`) moved on by one. */
const addSpareEntry = (owner: string): void => {
  if (onSpareEntry()) return
  const current: unknown = window.history.state
  const known: Record<string, unknown> =
    typeof current === 'object' && current !== null ? { ...current } : {}
  const idx = known['idx']
  window.history.pushState(
    { ...known, ...(typeof idx === 'number' ? { idx: idx + 1 } : {}), [SPARE_ENTRY]: owner },
    '',
  )
}

/**
 * Asks before the person leaves a page that holds something they cannot get again.
 *
 * Surface: **the host and the operator**, on a page that shows a secret once: the recovery codes
 * of the second factor (H8), the invitation link of a client created on a box with no mail (H10).
 * Both are held in the page's own state and nowhere else (not stored, not in the address), so a
 * click on the breadcrumb, a menu entry or the footer used to lose them without a word.
 *
 * Four ways off the page, and what this does with each:
 *
 * - **A link inside the app** (menu, breadcrumb, footer): stopped in the capture phase, before the
 *   router sees it, and put to the person in a dialog whose safe choice is to stay. Leaving
 *   **clicks that same link again**, so the router handles it exactly as it would have: with the
 *   `state` (`from`) and the `replace` the link was written with, which a bare `navigate(path)`
 *   would have dropped.
 * - **Closing the tab, reloading, a link to another site**: the browser's own prompt
 *   (`beforeunload`). Its wording is the browser's and cannot be changed.
 * - **The browser's Back button** (and a phone's swipe-back): held with a spare history entry (see
 *   `SPARE_ENTRY`), and put to the person in the same dialog. Leaving goes back past the page. A
 *   jump of several entries at once (a long press on Back) is **not** held.
 * - **The sign-out button**: **not stopped.** It is the person's own, explicit act.
 */
export function LeaveGuard({ when, title, description, stayLabel, leaveLabel }: LeaveGuardProps) {
  const [asking, setAsking] = useState(false)
  // The link the person pressed, kept to be pressed again if they choose to leave; and whether
  // the next click is that second one, which must not be stopped again.
  const pressed = useRef<HTMLAnchorElement | null>(null)
  const replaying = useRef(false)
  // The guard's own history moves (taking the spare entry off, going back past the page), which
  // its `popstate` listener must not take for the person's.
  const moving = useRef(false)
  const armed = useRef(false)
  const give = useRef<number | null>(null)
  // Which spare entry is this guard's own, so a late clean-up never takes another guard's off.
  const owner = useId()

  useEffect(() => {
    if (!when) return
    armed.current = true
    const page = `${window.location.pathname}${window.location.search}`
    addSpareEntry(owner)

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      // Some engines only prompt when the legacy property is set.
      event.returnValue = ''
    }
    const onClick = (event: MouseEvent) => {
      if (replaying.current) {
        replaying.current = false
        return
      }
      const anchor = inAppAnchor(event)
      if (anchor === null) return
      event.preventDefault()
      event.stopPropagation()
      pressed.current = anchor
      setAsking(true)
    }

    const onPopState = () => {
      if (moving.current || onSpareEntry()) return
      // Another address: a jump of several entries, already past the page.
      if (`${window.location.pathname}${window.location.search}` !== page) return
      addSpareEntry(owner)
      pressed.current = null
      setAsking(true)
    }

    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('click', onClick, true)
    window.addEventListener('popstate', onPopState)
    return () => {
      armed.current = false
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('click', onClick, true)
      window.removeEventListener('popstate', onPopState)
      // Nothing left to lose: take the spare entry off, or Back would need a second press to
      // leave. Deferred, so a remount that arms the guard again (StrictMode) keeps it.
      window.setTimeout(() => {
        if (!armed.current && onSpareEntry(owner)) {
          moving.current = true
          window.history.back()
          window.setTimeout(() => {
            moving.current = false
          }, 100)
        }
      }, 0)
    }
  }, [when, owner])

  useEffect(
    () => () => {
      if (give.current !== null) window.clearTimeout(give.current)
    },
    [],
  )

  return (
    <ConfirmDialog
      open={when && asking}
      title={title}
      description={description}
      cancelLabel={stayLabel}
      confirmLabel={leaveLabel}
      onCancel={() => setAsking(false)}
      onConfirm={() => {
        const anchor = pressed.current
        pressed.current = null
        setAsking(false)
        if (anchor === null) {
          // Back: past the spare entry and the page's own. If there is nothing behind the page the
          // browser stays put, and the guard takes its place again.
          moving.current = true
          window.history.go(-2)
          give.current = window.setTimeout(() => {
            moving.current = false
            addSpareEntry(owner)
          }, 300)
          return
        }
        const follow = () => {
          moving.current = false
          replaying.current = true
          anchor.click()
          // A link that was taken out of the page meanwhile never reaches the listener.
          replaying.current = false
        }
        if (!onSpareEntry()) {
          follow()
          return
        }
        // The spare entry would stay behind the page the link opens: take it off first.
        moving.current = true
        window.addEventListener('popstate', follow, { once: true })
        window.history.back()
      }}
    />
  )
}
