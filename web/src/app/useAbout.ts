import { useEffect, useState } from 'react'
import { BUILD_SOURCE_URL, BUILD_VERSION } from '../lib/about/buildInfo'
import type { About, AboutLinks } from '../lib/api/dto'
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
 * An https address in its canonical form, or `null`.
 *
 * The server refuses anything else at boot (`SOURCE_CODE_URL` in `env.ts`), so this is the
 * same rule applied a second time at the point the string becomes an `href`: a response
 * rewritten by a proxy, or a server older than that check, must not be able to put a
 * `javascript:` URI behind a link every visitor is invited to press.
 *
 * The **parsed** form is what is returned, never the input. `https:x.example` parses as
 * `https://x.example/` but, left as written, is a relative reference to a browser and
 * resolves against whatever address the page is on.
 */
const httpsOnly = (value: string): string | null => {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

/**
 * The operator's links worth trusting: a known key whose value is an https address, in its
 * parsed form, and nothing else.
 *
 * Applied to the response and not to the build, because the build knows none: a donation
 * address is the operator's, read by the server at boot. Anything unrecognised is dropped
 * rather than rendered — a response rewritten by a proxy must not be able to put a
 * `javascript:` URI, or an address the operator never configured, behind a link.
 */
const trustedLinks = (links: unknown): AboutLinks => {
  if (typeof links !== 'object' || links === null) return {}
  const donate: unknown = Reflect.get(links, 'donate')
  const budget: unknown = Reflect.get(links, 'budget')
  const donateUrl = typeof donate === 'string' ? httpsOnly(donate) : null
  const budgetUrl = typeof budget === 'string' ? httpsOnly(budget) : null
  return {
    ...(donateUrl === null ? {} : { donate: donateUrl }),
    ...(budgetUrl === null ? {} : { budget: budgetUrl }),
  }
}

/**
 * The part of a response worth trusting, laid over the build's own answer.
 *
 * A footer must survive whatever the network hands it: a `200 null` from a proxy's error
 * page, a `{}` from a server of another version. So each field is taken only if it is the
 * right kind of thing, and what is not stays what the build knew — never a blank
 * `version` on `/about` and never an exception thrown from inside a promise callback.
 */
const laidOver = (answer: unknown): About => {
  if (typeof answer !== 'object' || answer === null) return BUILD_ABOUT

  const version: unknown = Reflect.get(answer, 'version')
  const sourceUrl: unknown = Reflect.get(answer, 'sourceUrl')
  const features: unknown = Reflect.get(answer, 'features')
  const links: unknown = Reflect.get(answer, 'links')
  const siteAdmin: unknown =
    typeof features === 'object' && features !== null ? Reflect.get(features, 'siteAdmin') : null

  return {
    ...BUILD_ABOUT,
    ...(typeof version === 'string' && version !== '' ? { version } : {}),
    ...(typeof sourceUrl === 'string'
      ? { sourceUrl: httpsOnly(sourceUrl) ?? BUILD_ABOUT.sourceUrl }
      : {}),
    links: trustedLinks(links),
    features: { siteAdmin: siteAdmin === true },
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
      (answer: unknown) => {
        if (controller.signal.aborted) return
        setAbout(laidOver(answer))
      },
      () => undefined,
    )

    return () => controller.abort()
  }, [api])

  return about
}
