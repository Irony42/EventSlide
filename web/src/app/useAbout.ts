import { useEffect, useState } from 'react'
import { BUILD_SOURCE_URL, BUILD_VERSION } from '../lib/about/buildInfo'
import type { About } from '../lib/api/dto'
import { useApi } from './useApi'

/**
 * What this bundle knows without asking: the version it was built at and the upstream tag of
 * its source, injected by the build (`lib/about/buildInfo.ts`).
 *
 * It is what the footer shows from its first paint, and what it keeps showing if the server
 * never answers — an installed app opened offline, a proxy that drops the request. The
 * source link is therefore never absent and never waiting, which is the property that makes
 * putting it on every guest screen cheap.
 */
const BUILD_ABOUT: About = {
  name: 'EventSlide',
  version: BUILD_VERSION,
  license: 'AGPL-3.0-only',
  sourceUrl: BUILD_SOURCE_URL,
  links: {},
  // Off until the server says otherwise: the strict reading, and the one that offers no
  // operator surface to a box that never asked for one.
  features: { siteAdmin: false },
}

/**
 * An https address, or `null`.
 *
 * The server refuses anything else at boot (`SOURCE_CODE_URL` in `env.ts`), so this is the
 * same rule applied a second time at the point the string becomes an `href`: a response
 * rewritten by a proxy, or a server older than that check, must not be able to put a
 * `javascript:` URI behind a link every visitor is invited to press.
 */
const httpsOnly = (value: string): string | null => {
  try {
    return new URL(value).protocol === 'https:' ? value : null
  } catch {
    return null
  }
}

/**
 * What `GET /api/about` says, once it has said it — and the build's own answer until then.
 *
 * **Never blocks and never fails loudly.** Nothing waits on this: the caller always has a
 * complete {@link About} to render, and a request that fails leaves the build-time one in
 * place without a word, because "could not reach the server" is not a thing a guest looking
 * at a footer can do anything about. The server answers with `Cache-Control: public,
 * max-age=300`, so the footer and `/about` asking separately cost one request, not two.
 */
export const useAbout = (): About => {
  const api = useApi()
  const [about, setAbout] = useState<About>(BUILD_ABOUT)

  useEffect(() => {
    const controller = new AbortController()

    api.about(controller.signal).then(
      (answer) => {
        if (controller.signal.aborted) return
        // The server's address when it is usable, the build's when it is not — never the
        // unusable one, and never nothing.
        setAbout({ ...answer, sourceUrl: httpsOnly(answer.sourceUrl) ?? BUILD_ABOUT.sourceUrl })
      },
      () => undefined,
    )

    return () => controller.abort()
  }, [api])

  return about
}
