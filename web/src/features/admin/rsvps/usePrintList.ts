import { useCallback, useEffect, useState } from 'react'

/** The attribute the print stylesheet looks for on `<body>`: everything else is left off the paper. */
const PRINTING = 'data-printing-rsvps'

/**
 * "Imprimer la liste" (spec 30, lot 2): the sheet is **drawn only while it is printed**, as a direct
 * child of `<body>` (so the print stylesheet can leave the rest of the app off the paper), and
 * removed once the browser says the dialog is closed. Nothing is drawn, fetched or kept on screen
 * otherwise: the page holds no second copy of the names and the diets.
 */
export const usePrintList = (): { readonly printing: boolean; readonly print: () => void } => {
  const [printing, setPrinting] = useState(false)

  useEffect(() => {
    if (!printing) return undefined
    document.body.setAttribute(PRINTING, '')
    const done = () => setPrinting(false)
    window.addEventListener('afterprint', done)
    // One frame for the sheet to be in the page, then the browser's own dialog.
    const frame = window.requestAnimationFrame(() => {
      if (typeof window.print === 'function') window.print()
      else done()
    })
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('afterprint', done)
      document.body.removeAttribute(PRINTING)
    }
  }, [printing])

  return { printing, print: useCallback(() => setPrinting(true), []) }
}
