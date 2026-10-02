import { useEffect, useState } from 'react'
import { BUILD_SOURCE_URL, BUILD_VERSION } from '../lib/about/buildInfo'
import type { About, AboutLinks, AboutOperator } from '../lib/api/dto'
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
 * The server refuses anything else at boot (`SOURCE_CODE_URL`, `DONATION_URL` and
 * `BUDGET_URL` in `env.ts`: https only, **no credentials**), so this is the same rule applied
 * a second time at the point the string becomes an `href`: a response rewritten by a proxy,
 * or a server older than that check, must not be able to put a `javascript:` URI, or a
 * `user:password@` address, behind a link every visitor is invited to press.
 *
 * The **parsed** form is what is returned, never the input. `https:x.example` parses as
 * `https://x.example/` but, left as written, is a relative reference to a browser and
 * resolves against whatever address the page is on.
 */
const httpsOnly = (value: string): string | null => {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.username === '' && url.password === '' ? url.href : null
  } catch {
    return null
  }
}

/** The base a path is parsed against to canonicalise it. Nothing is ever fetched from here. */
const SAME_ORIGIN_PROBE = 'https://same-origin.invalid'

/**
 * An https address, or a path on this site, in its canonical form, or `null` (roadmap
 * G2-17): the rule `env.ts` applies to `LEGAL_*_URL`, `SUPPORT_URL` and `REPORT_URL`, applied
 * again where the string becomes an `href`.
 *
 * A path is accepted because the hosted instance serves its legal pages from its own origin.
 * It is a path only if it starts with one `/`, holds no backslash or whitespace, and — the
 * subtle case — does not *canonicalise* to `//host`: `/.//host` parses to a pathname that
 * starts with two slashes, which a browser reads as another site.
 */
const siteLinkOnly = (value: string): string | null => {
  if (!value.startsWith('/')) return httpsOnly(value)
  if (/[\s\p{Cc}]/u.test(value) || value.startsWith('//') || value.includes('\\')) return null
  try {
    const url = new URL(value, SAME_ORIGIN_PROBE)
    const path = `${url.pathname}${url.search}${url.hash}`
    return path.startsWith('//') ? null : path
  } catch {
    return null
  }
}

/** The value under `key`, run through `accept`, or `null` when it is absent or not text. */
const trustedLink = (
  links: object,
  key: string,
  accept: (value: string) => string | null,
): string | null => {
  const value: unknown = Reflect.get(links, key)
  return typeof value === 'string' ? accept(value) : null
}

/**
 * The operator's links worth trusting: a known key whose value is an acceptable address, in
 * its parsed form, and nothing else. The donation and budget pages are https only; the five
 * the operator owes a visitor (terms, privacy, legal notice, help, report) may also be paths
 * on this site.
 *
 * Applied to the response and not to the build, because the build knows none: these
 * addresses are the operator's, read by the server at boot. Anything unrecognised is dropped
 * rather than rendered. What this guards is the *kind* of address, not whose it is: a client
 * cannot tell the operator's https page from another one, and the transport is the same one
 * that carries `sourceUrl`.
 */
const trustedLinks = (links: unknown): AboutLinks => {
  if (typeof links !== 'object' || links === null) return {}
  const donate = trustedLink(links, 'donate', httpsOnly)
  const budget = trustedLink(links, 'budget', httpsOnly)
  const terms = trustedLink(links, 'terms', siteLinkOnly)
  const privacy = trustedLink(links, 'privacy', siteLinkOnly)
  const legalNotice = trustedLink(links, 'legalNotice', siteLinkOnly)
  const support = trustedLink(links, 'support', siteLinkOnly)
  const report = trustedLink(links, 'report', siteLinkOnly)
  return {
    ...(terms === null ? {} : { terms }),
    ...(privacy === null ? {} : { privacy }),
    ...(legalNotice === null ? {} : { legalNotice }),
    ...(support === null ? {} : { support }),
    ...(report === null ? {} : { report }),
    ...(donate === null ? {} : { donate }),
    ...(budget === null ? {} : { budget }),
  }
}

/**
 * One plain address, the kind `mailto:` can carry without a header riding along: no
 * whitespace, no `?`, no `&`, no second `@`. Narrower than the server's check on purpose; an
 * address this refuses is simply not offered as a link.
 */
const PLAIN_ADDRESS = /^[A-Za-z0-9._'+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/

/** The longest name worth printing; the server's own cap is lower. */
const OPERATOR_NAME_CEILING = 200

/**
 * The operator, when the response names one: a non-blank name of sensible length with no
 * control character, and a contact address only if it is one plain address. Text only — it
 * is rendered as text, and the address is the one thing built into a link.
 */
const trustedOperator = (operator: unknown): AboutOperator | undefined => {
  if (typeof operator !== 'object' || operator === null) return undefined
  const name: unknown = Reflect.get(operator, 'name')
  if (typeof name !== 'string' || name.trim() === '' || name.length > OPERATOR_NAME_CEILING) {
    return undefined
  }
  if (/\p{Cc}/u.test(name)) return undefined
  const contactEmail: unknown = Reflect.get(operator, 'contactEmail')
  return {
    name,
    ...(typeof contactEmail === 'string' && PLAIN_ADDRESS.test(contactEmail)
      ? { contactEmail }
      : {}),
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
  const operator = trustedOperator(Reflect.get(answer, 'operator'))
  const siteAdmin: unknown =
    typeof features === 'object' && features !== null ? Reflect.get(features, 'siteAdmin') : null

  return {
    ...BUILD_ABOUT,
    ...(typeof version === 'string' && version !== '' ? { version } : {}),
    ...(typeof sourceUrl === 'string'
      ? { sourceUrl: httpsOnly(sourceUrl) ?? BUILD_ABOUT.sourceUrl }
      : {}),
    ...(operator === undefined ? {} : { operator }),
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
