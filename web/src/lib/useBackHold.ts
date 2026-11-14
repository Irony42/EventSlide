import { useCallback, useEffect, useId, useRef } from 'react'

/**
 * Holding the browser's Back button on a page that shows something the person cannot get again.
 *
 * Shared by `app/LeaveGuard` (a dialog) and `features/admin/hooks/useLeaveWarning` (the browser's
 * own `confirm`): both ask, in their own way, and both need the same history bookkeeping, which is
 * what lives here.
 *
 * `BrowserRouter` has no way to block a history move (`useBlocker` needs a data router) and a
 * `popstate` cannot be cancelled: it fires after the browser has moved. So the hold keeps one
 * spare entry of the same address above the page's. Back pops that spare entry, which lands on the
 * page's own entry (same address, so the router re-renders the same screen and nothing unmounts),
 * and the hold puts the spare entry back and calls `onBack`. Leaving goes back past both
 * ({@link BackHold.leaveBack}). A jump of several entries at once (a long press on Back) is not held.
 */

/** The mark on the history entry the hold adds on top of the page's own. */
const SPARE_ENTRY = 'eventslideLeaveGuard'

/** Whether the entry the browser is on is a spare one. */
const onSpareEntry = (): boolean => {
  const state: unknown = window.history.state
  if (typeof state !== 'object' || state === null || !(SPARE_ENTRY in state)) return false
  return true
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
 * The holds armed now. Two can live on one page (the share link and a moderator's invitation on
 * the event page): they share the one spare entry, the first to see Back puts it back (so the
 * other finds it there and the host is asked once), and it comes off when the last one lets go.
 */
const armedHolds: string[] = []

export interface BackHold {
  /** The person chose to leave after pressing Back: past the spare entry and the page's own. */
  readonly leaveBack: () => void
  /**
   * The person chose to leave by a link: takes the spare entry off first, so it does not stay
   * behind the page the link opens, then runs `follow`.
   */
  readonly releaseThen: (follow: () => void) => void
}

/**
 * While `when`, holds Back and calls `onBack` each time the person presses it (the spare entry is
 * already back in place; the page has not moved). `onBack` is handed `leaveBack`, to call if the
 * person chooses to leave.
 */
export function useBackHold(when: boolean, onBack: (leave: () => void) => void): BackHold {
  // The hold's own history moves (taking the spare entry off, going back past the page), which its
  // `popstate` listener must not take for the person's.
  const moving = useRef(false)
  const give = useRef<number | null>(null)
  // This hold's name in `armedHolds`.
  const owner = useId()
  const asked = useRef(onBack)
  useEffect(() => {
    asked.current = onBack
  })

  const leaveBack = useCallback(() => {
    // If there is nothing behind the page the browser stays put, and the hold takes its place again.
    moving.current = true
    window.history.go(-2)
    give.current = window.setTimeout(() => {
      moving.current = false
      addSpareEntry(owner)
    }, 300)
  }, [owner])

  useEffect(() => {
    if (!when) return
    armedHolds.push(owner)
    const page = `${window.location.pathname}${window.location.search}`
    addSpareEntry(owner)

    const onPopState = () => {
      if (moving.current || onSpareEntry()) return
      // Another address: a jump of several entries, already past the page.
      if (`${window.location.pathname}${window.location.search}` !== page) return
      addSpareEntry(owner)
      asked.current(leaveBack)
    }

    window.addEventListener('popstate', onPopState)
    return () => {
      armedHolds.splice(armedHolds.indexOf(owner), 1)
      window.removeEventListener('popstate', onPopState)
      // Nothing left to lose: take the spare entry off, or Back would need a second press to
      // leave. Deferred, so a remount that arms the hold again (StrictMode) keeps it.
      window.setTimeout(() => {
        if (armedHolds.length === 0 && onSpareEntry()) {
          moving.current = true
          window.history.back()
          window.setTimeout(() => {
            moving.current = false
          }, 100)
        }
      }, 0)
    }
  }, [when, owner, leaveBack])

  useEffect(
    () => () => {
      if (give.current !== null) window.clearTimeout(give.current)
    },
    [],
  )

  const releaseThen = useCallback((follow: () => void) => {
    const go = () => {
      moving.current = false
      follow()
    }
    if (!onSpareEntry()) {
      go()
      return
    }
    moving.current = true
    window.addEventListener('popstate', go, { once: true })
    window.history.back()
  }, [])

  return { leaveBack, releaseThen }
}
