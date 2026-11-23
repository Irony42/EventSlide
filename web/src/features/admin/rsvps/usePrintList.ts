import { useCallback, useEffect, useRef, useState } from 'react'

/** The attribute the print stylesheet looks for on `<body>`: everything else is left off the paper. */
const PRINTING = 'data-printing-rsvps'

/** After `print()` returned, how long the sheet may stay without any signal that the dialog closed. */
export const PRINT_FALLBACK_MS = 120_000
/** After the window gets its focus back, the grace before the sheet goes (a signal may still come). */
export const PRINT_FOCUS_GRACE_MS = 500

/**
 * "Imprimer la liste" (spec 30, lot 2): the sheet is **drawn only while it is printed**, as a direct
 * child of `<body>` (so the print stylesheet can leave the rest of the app off the paper), and
 * removed once the dialog is closed. Nothing is drawn, fetched or kept on screen otherwise: the
 * page holds no second copy of the names and the diets.
 *
 * **The sheet can never be left behind.** Browsers do not all say when the dialog closed, so four
 * signals end a job: `afterprint`, the `print` media query turning off, the window getting its focus
 * back, and a last timeout once `print()` has returned. Each press starts a **new** job (a button
 * never goes dead): it prints again, whatever became of the one before.
 */
export const usePrintList = (): { readonly printing: boolean; readonly print: () => void } => {
  const [job, setJob] = useState<{ readonly id: number } | null>(null)
  const counter = useRef(0)

  useEffect(() => {
    if (job === null) return undefined
    document.body.setAttribute(PRINTING, '')
    let ended = false
    const timers: number[] = []
    const done = () => {
      if (ended) return
      ended = true
      setJob(null)
    }
    const media = typeof window.matchMedia === 'function' ? window.matchMedia('print') : null
    const onMedia = (event: MediaQueryListEvent) => {
      if (!event.matches) done()
    }
    const onFocus = () => {
      timers.push(window.setTimeout(done, PRINT_FOCUS_GRACE_MS))
    }
    window.addEventListener('afterprint', done)
    media?.addEventListener('change', onMedia)

    // One frame for the sheet to be in the page, then the browser's own dialog.
    const frame = window.requestAnimationFrame(() => {
      if (typeof window.print !== 'function') {
        done()
        return
      }
      window.print()
      // It returned: the dialog is closed where it blocks, or about to say so where it does not.
      window.addEventListener('focus', onFocus)
      timers.push(window.setTimeout(done, PRINT_FALLBACK_MS))
    })

    return () => {
      window.cancelAnimationFrame(frame)
      for (const timer of timers) window.clearTimeout(timer)
      window.removeEventListener('afterprint', done)
      window.removeEventListener('focus', onFocus)
      media?.removeEventListener('change', onMedia)
      document.body.removeAttribute(PRINTING)
    }
  }, [job])

  const print = useCallback(() => {
    counter.current += 1
    setJob({ id: counter.current })
  }, [])

  return { printing: job !== null, print }
}
