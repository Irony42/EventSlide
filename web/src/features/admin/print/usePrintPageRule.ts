import { useEffect } from 'react'
import PRINT_PAGE_CSS from './printPage.css?url'

/**
 * Applies `@page { margin: 0 }` for the lifetime of the print page only.
 *
 * An `@page` rule is global and cannot be scoped by a selector, so a bundled stylesheet that
 * carries it is linked on mount and removed on unmount. A `<link>` to the app's own asset is what
 * the CSP allows (`style-src 'self'`, no inline style element).
 */
export const usePrintPageRule = (): void => {
  useEffect(() => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = PRINT_PAGE_CSS
    link.dataset['printPage'] = ''
    document.head.append(link)
    return () => link.remove()
  }, [])
}
