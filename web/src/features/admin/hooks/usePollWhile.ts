import { useEffect } from 'react'

/**
 * Call `tick` every `intervalMs` while `active`, and only while the host can see the page.
 *
 * Three panels of the console read a background job again (the album book, the best-of
 * montage, the statistics). A tab left in the background during a job would otherwise keep a
 * request going for as long as the job lasts, on a laptop at a venue. The beat is skipped
 * while the page is hidden and the next visible one reads again; `useRevalidateWhenVisible`
 * is the half that reads at once on return.
 */
export const usePollWhile = (active: boolean, intervalMs: number, tick: () => void): void => {
  useEffect(() => {
    if (!active) return undefined
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') tick()
    }, intervalMs)
    return () => window.clearInterval(timer)
  }, [active, intervalMs, tick])
}
