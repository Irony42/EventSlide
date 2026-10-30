import { useEffect, useState } from 'react'
import { supportsBackgroundSync } from '../../../lib/offline/serviceWorker'

/**
 * Whether this phone can send the waiting photos with the page closed.
 *
 * View-state for one sentence. `false` until the browser has answered, and for good where it
 * answers no (an iPhone): a guest told "you can close this page" on a phone that cannot honour
 * it closes Safari, goes home, and the evening's photos never reach the wall. The cautious
 * wording is therefore the default, and the permissive one has to be earned by a yes.
 */
export const useBackgroundSync = (): boolean => {
  const [supported, setSupported] = useState(false)

  useEffect(() => {
    let current = true
    void supportsBackgroundSync().then((answer) => {
      if (current) setSupported(answer)
    })
    return () => {
      current = false
    }
  }, [])

  return supported
}
