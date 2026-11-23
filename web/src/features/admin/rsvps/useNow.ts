import { useEffect, useState } from 'react'

/**
 * The time, read again every `stepMs` and whenever the tab comes back into view: a page left open
 * for an hour must judge "the deadline has passed" by the hour it is, not the one it was opened in.
 */
export const useNow = (stepMs: number): number => {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const tick = () => setNow(Date.now())
    const visible = () => {
      if (document.visibilityState === 'visible') tick()
    }
    const timer = window.setInterval(tick, stepMs)
    document.addEventListener('visibilitychange', visible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [stepMs])
  return now
}
