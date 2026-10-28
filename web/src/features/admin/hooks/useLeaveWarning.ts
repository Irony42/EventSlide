import { useEffect } from 'react'

/**
 * Asks before the page is left, while `active`, for what exists nowhere else.
 *
 * Two doors, because the app has two kinds of leaving. **Closing the tab, reloading, typing an
 * address**: the browser's own `beforeunload` prompt (its words, not ours: a page may not
 * choose them). **Following a link inside the app**: the router swaps the screen without
 * unloading anything, so no browser event fires, and the one place to catch it is the click
 * itself, in the capture phase, before the router sees it. That asks with `message`.
 *
 * What it does **not** catch is the browser's Back button: the app runs on a `BrowserRouter`,
 * which has no blocker (`useBlocker` needs a data router), and a `popstate` cannot be
 * cancelled. It is the limit of "keep it simple", and the page says in words, beside the link,
 * that it will not be shown again.
 *
 * Links that cannot lose the page are let through: a new tab, a download, a modified click,
 * another address of the same page, and a different origin (which unloads, so `beforeunload`
 * has it).
 */
export const useLeaveWarning = (active: boolean, message: string): void => {
  useEffect(() => {
    if (!active) return

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      // Some browsers still want a value to show the prompt at all.
      event.returnValue = ''
    }

    const onClick = (event: MouseEvent) => {
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
      if (!window.confirm(message)) {
        event.preventDefault()
        event.stopPropagation()
      }
    }

    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('click', onClick, true)
    }
  }, [active, message])
}
