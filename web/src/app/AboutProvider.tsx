import { useEffect, useState, type ReactNode } from 'react'
import type { About } from '../lib/api/dto'
import { AboutContext } from './aboutContext'
import { BUILD_ABOUT, laidOver } from './aboutAnswer'
import { useApi } from './useApi'

/**
 * Asks `GET /api/about` once and hands the answer to everything that shows it: the router
 * (is there a client space?), the footer, the sign-in page, the event page's links, the
 * privacy notice, `/about` itself. Each used to ask for itself, up to eight times in a load;
 * `Cache-Control: max-age=300` saved the bytes but never de-duplicated two requests in flight.
 *
 * **Never blocks and never fails loudly.** Until the server has answered, and for good if it
 * never does (an installed app opened offline, a proxy that drops the request), the value is
 * the build's own answer, complete and ready to render: "could not reach the server" is not a
 * thing a guest looking at a footer can do anything about.
 *
 * Mounted once, at the composition root (`main.tsx`), above the router: every surface reads
 * it, the projected wall included, because the router itself does.
 */
export function AboutProvider({ children }: { readonly children: ReactNode }) {
  const api = useApi()
  const [about, setAbout] = useState<About>(BUILD_ABOUT)

  useEffect(() => {
    const controller = new AbortController()

    api.about(controller.signal).then(
      (answer: unknown) => {
        if (controller.signal.aborted) return
        setAbout(laidOver(answer))
      },
      () => undefined,
    )

    return () => controller.abort()
  }, [api])

  return <AboutContext.Provider value={about}>{children}</AboutContext.Provider>
}
