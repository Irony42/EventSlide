import { useEffect, useRef } from 'react'
import { useBackHold } from '../../../lib/useBackHold'

/**
 * Asks before the page is left, while `active`, for what exists nowhere else.
 *
 * Two doors, because the app has two kinds of leaving. **Closing the tab, reloading, typing an
 * address**: the browser's own `beforeunload` prompt (its words, not ours: a page may not
 * choose them). **Following a link inside the app**: the router swaps the screen without
 * unloading anything, so no browser event fires, and the one place to catch it is the click
 * itself, in the capture phase, before the router sees it. That asks with `message`.
 *
 * **The browser's Back button** is held too, with the spare history entry `LeaveGuard` uses
 * (`lib/useBackHold`): the app runs on a `BrowserRouter`, which has no blocker and cannot cancel a
 * `popstate`, so the page keeps one spare entry above its own and asks with the same `message`
 * when Back pops it. Confirming goes back past the page; a long press on Back (several entries
 * at once) is not held.
 *
 * **Known double prompt**: a same-origin plain `<a href>` that makes a full page load (the join
 * link, a crash screen's home link) is asked here and then again by the browser's own
 * `beforeunload`, because the two cannot be told apart from a router `Link`. Accepted: the
 * question is the same one twice, only while an address is on screen that is shown nowhere else.
 *
 * Links that cannot lose the page are let through: a new tab, a download, a modified click,
 * another address of the same page, and a different origin (which unloads, so `beforeunload`
 * has it).
 */
export const useLeaveWarning = (active: boolean, message: string): void => {
  const asked = useRef(message)
  useEffect(() => {
    asked.current = message
  })
  const { releaseThen } = useBackHold(active, (leave) => {
    if (window.confirm(asked.current)) leave()
  })

  useEffect(() => {
    if (!active) return

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      // Some browsers still want a value to show the prompt at all.
      event.returnValue = ''
    }

    let replaying = false
    const onClick = (event: MouseEvent) => {
      if (replaying) return
      if (event.defaultPrevented || event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (anchor === null || anchor.hasAttribute('download')) return
      const target = anchor.getAttribute('target')
      if (target !== null && target !== '_self') return
      const destination = new URL((anchor as HTMLAnchorElement).href, window.location.href)
      if (destination.origin !== window.location.origin) return
      if (
        destination.pathname === window.location.pathname &&
        destination.search === window.location.search
      ) {
        return
      }
      // The router's own links read `defaultPrevented` and do not navigate: stopped here, then
      // followed again once the spare history entry is off, so it does not stay behind the page.
      event.preventDefault()
      event.stopPropagation()
      if (!window.confirm(message)) return
      releaseThen(() => {
        replaying = true
        ;(anchor as HTMLAnchorElement).click()
        replaying = false
      })
    }

    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('click', onClick, true)
    }
  }, [active, message, releaseThen])
}
