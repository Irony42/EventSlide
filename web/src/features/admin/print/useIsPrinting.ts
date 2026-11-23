import { useEffect, useState } from 'react'
import { flushSync } from 'react-dom'

const printQuery = (): MediaQueryList | null =>
  typeof window.matchMedia === 'function' ? window.matchMedia('print') : null

/**
 * Whether the page is being laid out for paper (spec 30, lot 3): `beforeprint` (the browser's own
 * dialog) and the `print` media query (an emulation, a print preview) both say so, and `afterprint`
 * or the query ending says it is over.
 *
 * `beforeprint` is answered **synchronously** (`flushSync`): the browser lays the page out for paper
 * right after the event, so what appears only while printing must be in the page by then. Used to
 * build the many sheets of a card for each household only when they are to be printed.
 */
export const useIsPrinting = (): boolean => {
  const [printing, setPrinting] = useState(() => printQuery()?.matches ?? false)

  useEffect(() => {
    const query = printQuery()
    const follow = () => setPrinting(query?.matches ?? false)
    const before = () => flushSync(() => setPrinting(true))
    query?.addEventListener('change', follow)
    window.addEventListener('beforeprint', before)
    window.addEventListener('afterprint', follow)
    return () => {
      query?.removeEventListener('change', follow)
      window.removeEventListener('beforeprint', before)
      window.removeEventListener('afterprint', follow)
    }
  }, [])

  return printing
}
