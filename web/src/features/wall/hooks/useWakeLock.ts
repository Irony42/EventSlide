import { useEffect, useState } from 'react'

/**
 * How often a visible wall that holds no lock asks for one again. A minute: the refusals that
 * mend themselves (a battery saver switched off, a transient error) are worth a minute's wait,
 * and a browser that never says yes is asked once a minute, not in a loop.
 */
export const WAKE_LOCK_RETRY_MS = 60_000

/**
 * Keeps the machine that drives the projector awake, for as long as the wall is open.
 *
 * The wall often runs on the host's laptop, on battery, and the operating system turns that
 * screen off after ten or fifteen idle minutes: the projector then says "no signal" in the
 * middle of the meal and nobody is standing next to it. The Screen Wake Lock API is the
 * browser's answer, and it has three ways to say no that this hook treats alike:
 *
 * - **No API** (an older browser, or a page served over plain `http` on a venue LAN, where
 *   `navigator.wakeLock` does not exist). Nothing is held.
 * - **A refusal** (battery saver, a policy, a tab that is not visible when it asks). Nothing is held.
 * - **A release the browser makes on its own**, which it does every time the tab is hidden.
 *   That is why the lock is asked for again when the tab becomes visible, and why a
 *   `release` event puts the answer back to "not held" until it is.
 *
 * Hiding the tab is not the only way to lose the lock: the operating system revokes it when
 * the battery runs low, and a request can fail for a moment and succeed a minute later. None
 * of those fire `visibilitychange`, so a wall that only asked on visibility would stay
 * unheld for the rest of the night. While the tab is visible and nothing is held, the lock is
 * therefore asked for again on a slow timer (`WAKE_LOCK_RETRY_MS`): slow so that a browser
 * that always refuses is asked once a minute, not in a loop.
 *
 * Returns whether the screen is being held awake **right now**. The page uses the answer
 * for one thing: the shortcuts panel tells the host to switch the computer's own sleep off
 * when this is `false`, which is the only fix left to them.
 */
export const useWakeLock = (): boolean => {
  const [held, setHeld] = useState(false)

  useEffect(() => {
    if (!('wakeLock' in navigator)) return

    let live = true
    let asking = false
    let sentinel: WakeLockSentinel | null = null

    const acquire = async (): Promise<void> => {
      // One request at a time, and none from a tab nobody can see: the browser would refuse it.
      if (!live || asking || sentinel !== null || document.visibilityState !== 'visible') return
      asking = true
      try {
        const granted = await navigator.wakeLock.request('screen')
        if (!live) {
          // The page went away while the browser was deciding.
          await granted.release().catch(() => undefined)
          return
        }
        sentinel = granted
        setHeld(true)
        granted.addEventListener('release', () => {
          if (sentinel !== granted) return
          sentinel = null
          if (live) setHeld(false)
        })
      } catch {
        if (live) setHeld(false)
      } finally {
        asking = false
      }
    }

    const onVisibility = (): void => {
      void acquire()
    }

    document.addEventListener('visibilitychange', onVisibility)
    void acquire()
    // `acquire` does nothing while a lock is held, a request is pending or the tab is hidden,
    // so this only ever acts on a wall that is visible and unheld.
    const retry = window.setInterval(() => void acquire(), WAKE_LOCK_RETRY_MS)

    return () => {
      live = false
      window.clearInterval(retry)
      document.removeEventListener('visibilitychange', onVisibility)
      const kept = sentinel
      sentinel = null
      if (kept !== null) void kept.release().catch(() => undefined)
    }
  }, [])

  return held
}
