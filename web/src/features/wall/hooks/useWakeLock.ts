import { useEffect, useState } from 'react'

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

    return () => {
      live = false
      document.removeEventListener('visibilitychange', onVisibility)
      const kept = sentinel
      sentinel = null
      if (kept !== null) void kept.release().catch(() => undefined)
    }
  }, [])

  return held
}
