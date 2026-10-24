import { z } from 'zod'
import { isTermsVersion, TERMS_VERSION_MAX_LENGTH } from '../../domain/legal/termsOfUse'
import { OPERATOR_NAME_MAX_LENGTH } from '../../domain/privacy/privacyNotice'
import { blankAsAbsent, refuse } from './schemaPrimitives'

/**
 * The fields of the schema that are an address or a name shown to people: the public origin,
 * the links the operator publishes (source, support, report, donation, budget, legal), the
 * operator's identity, and the source reference.
 */

/**
 * The public origin. `z.string().url()` alone accepts any parseable URL, including
 * `javascript:alert(1)` and `data:text/html,…`: the value is concatenated into the
 * `joinUrl` on **two** responses, and this is the only place the scheme is narrowed.
 * `EventDto.joinUrl` is the admin console's link and QR, so a non-navigable scheme would
 * put a script URI behind the host's join button; `WallResponseDto.joinUrl` is the QR
 * **projected in front of the room**, which is the higher-stakes one — it is the code a
 * guest's phone actually scans, and §9 trap 1 is the record of what a wrong join link
 * costs. A phone has to be able to open it, which leaves exactly two schemes; production
 * narrows that further to https, or http on localhost behind a TLS proxy.
 */
export const publicUrl = z
  .string()
  // Not `z.url()`: zod 4's trims what it is given and then **replaces the value with the
  // trimmed, tab-and-newline-stripped text**, so the scheme check below would be judging a
  // string the operator never typed (` https://x` would pass where zod 3 refused it).
  // Whether the URL parser accepts the text exactly as written is the question this has
  // always asked, and `URL.canParse` is that question.
  .refine((value) => URL.canParse(value), { error: 'PUBLIC_URL must be a URL' })
  .refine((value) => /^https?:\/\//i.test(value), {
    error: 'PUBLIC_URL must be an http or https origin',
  })
  // The trailing twin of the leading-whitespace case the scheme check above refuses: the URL
  // parser strips whitespace and control characters from both ends, so `canParse` says yes to
  // `'https://photos.example.com '` and nothing in front of it is anchored at the back. An
  // invisible format character (a zero-width space) at the end would survive the parser and
  // end up in every join link, percent-encoded. A tab or a line break anywhere is refused too:
  // the parser deletes it from the middle of the text, and the address that boots would be one
  // nobody typed.
  .refine((value) => !/[\t\n\r]|[\s\p{Cc}\p{Cf}]$/u.test(value), {
    error:
      'PUBLIC_URL must not contain a tab or a line break, nor end with whitespace, a control character or an invisible one: check the end of the line',
  })
  // Never a user name or a password, and never the value in the message: it may be the
  // password, and the boot prints the refusal where the output is kept. `http://user:pw@localhost`
  // is the shape production's localhost exemption lets through.
  .refine(
    (value) => {
      if (!URL.canParse(value)) return true
      const url = new URL(value)
      return url.username === '' && url.password === ''
    },
    {
      error:
        'PUBLIC_URL must not contain a user name or a password: the address is printed in every join link, QR code and mail',
    },
  )
  // Never a query string or a fragment. Every link is made by appending a path to this value
  // (`${publicUrl}/join/CODE`), so `https://photos.example.com/?ref=x` would give
  // `https://photos.example.com/?ref=x/join/CODE`: a QR code that opens the wrong page, with no
  // error anywhere. The test reads the text as typed, because a bare `?` or `#` is a real
  // mistake and leaves `url.search` and `url.hash` empty. A `?` or `#` percent-encoded in the
  // path (`%3F`, `%23`) is a character of a path segment, is not typed as either, and stays
  // accepted. Never the value in the message, as above: it may be where a token was pasted.
  .refine((value) => !/[?#]/.test(value), {
    error:
      'PUBLIC_URL must not contain a query string or a fragment (a ? or a #): every link is made by appending a path to it, so the join link and its QR code would end up inside the query or the fragment. Write a ? or a # that belongs in the path as %3F or %23',
  })

/**
 * `PUBLIC_URL` as the rest of the application sees it: the parsed URL's own spelling
 * (lower-case scheme and host, no default port, an internationalised host in the form a
 * phone resolves), the path as that parser writes it (case kept, but percent-encoded and with
 * its dot segments resolved, which is what a browser would do with the typed text anyway),
 * and no trailing slash, because `${publicUrl}/join/CODE` would otherwise read
 * `//join/CODE` in a QR code.
 *
 * `joinUrl`, `galleryUrl`, the mail links and the wall response all concatenate this onto a
 * path, so what `loadConfig` returns is what a guest's phone is sent to. Only for a value
 * {@link publicUrl} has accepted, which `new URL` therefore parses and which carries no query
 * string and no fragment: the trailing-slash trim would otherwise cut the wrong end.
 */
export const canonicalPublicUrl = (accepted: string): string =>
  new URL(accepted).href.replace(/\/+$/, '')

/**
 * Whether `value` is a plain `http:` address on a host other than `localhost`, which is the
 * one thing production refuses about {@link publicUrl}: guests submit photos over that
 * origin, and a `Secure` session cookie is never sent over http.
 *
 * It reads the **parsed** URL, never the text as typed. A scheme is case-insensitive and the
 * check that admits the value says so (`/^https?:\/\//i`), so a test on the typed prefix let
 * `HTTP://photos.example.com` through the very rule meant to catch it. The host is read the
 * same way, because the prefix `http://localhost` also matched `http://localhost.example.com`
 * and `http://localhost@example.com`, whose host is somewhere else entirely.
 *
 * A value that does not parse is not this rule's to report: `publicUrl` refuses it, and zod
 * hands the object-level refinement the text as typed even then. One that parses and that
 * `publicUrl` refuses anyway (` http://x`, `http:x`) may be named by both; the boot is refused
 * either way.
 */
export const isPlainHttpBeyondLocalhost = (value: string): boolean => {
  if (!URL.canParse(value)) return false
  const url = new URL(value)
  return url.protocol === 'http:' && url.hostname !== 'localhost'
}

/**
 * Where the AGPL section 13 source link points when the box says nothing: the upstream
 * repository, at the tag of the running version (roadmap G1-04 / P1-05, P1-06).
 *
 * The tag is the claim. `/tree/v${version}` is the source of exactly the build that is
 * running, which is what section 13 owes a user of a network service — so the default is
 * right for the published image, unmodified, and wrong for anything else. A deployment
 * built from a commit that no tag names must set `SOURCE_CODE_URL` to that commit, or
 * build with `SOURCE_REF` (the Dockerfile's build argument); docs/API.md says so.
 */
export const UPSTREAM_REPOSITORY = 'https://github.com/Irony42/EventSlide'

/**
 * An https URL a browser may be sent to, in its canonical form, or `null`.
 *
 * https and nothing else, with no exception for localhost: the value is rendered as a link
 * on every guest and host screen and printed by a public endpoint, so `javascript:`,
 * `data:` and plain `http:` are refused alike. `PUBLIC_URL` above has to admit http for a
 * venue box on a LAN; this link has no such excuse. Credentials in the URL are refused
 * too, because they would be shown to every visitor.
 *
 * The raw text is checked for whitespace and control characters **before** it is parsed,
 * because the WHATWG parser silently deletes tabs and newlines from the middle of a URL:
 * an address with a newline in it would otherwise be accepted as something the operator
 * never typed. The canonical `href` is what is returned, never the input.
 */
const parseHttpsUrl = (value: string): string | null => {
  if (/[\s\p{Cc}]/u.test(value)) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return null
  return url.href
}

/**
 * An optional https link an operator publishes, validated once for every variable that
 * carries one: `SOURCE_CODE_URL`, `DONATION_URL` and `BUDGET_URL`. Blank is absent, for the
 * reason on {@link blankAsAbsent}, and what is returned is the canonical form
 * ({@link parseHttpsUrl}), never the text as typed.
 *
 * One factory rather than three copies, so the three cannot drift apart: the rule that
 * refuses `http:` for the source link is the rule that refuses it for a donation page, and
 * a test that loosens one loosens all three and fails for all three.
 */
const optionalHttpsLink = (variable: string, shownTo: string) =>
  z.preprocess(
    blankAsAbsent,
    z
      .string()
      .trim()
      .transform((value, ctx) => {
        const parsed = parseHttpsUrl(value)
        if (parsed === null) {
          return refuse(
            ctx,
            `${variable} must be an https URL with no credentials in it: a javascript:, data: or http: address is refused, because this link is shown to ${shownTo}`,
          )
        }
        return parsed
      })
      .optional(),
  )

/**
 * `SOURCE_CODE_URL`: the complete source of this build, as the operator publishes it. It
 * wins over `SOURCE_REF` and over the default.
 */
export const sourceCodeUrl = optionalHttpsLink('SOURCE_CODE_URL', 'every visitor')

/**
 * `DONATION_URL`: where a visitor can support the project (roadmap G4-02). **Empty by
 * default**, so a self-hoster's screens never mention money; set, it is offered in the host
 * footer, on `/about` and once, closably, to a host whose event has just closed. It is
 * never shown to a guest or on the projected wall. A donation buys nothing, and no
 * setting adds a counterpart.
 */
export const donationUrl = optionalHttpsLink('DONATION_URL', 'hosts and on the public /about page')

/**
 * `BUDGET_URL`: the public ledger the donations are accounted in, when the operator keeps
 * one (roadmap G4-02). Empty by default, for the same reason as {@link donationUrl}.
 */
export const budgetUrl = optionalHttpsLink('BUDGET_URL', 'hosts and on the public /about page')

/**
 * The origin a path is parsed against, to canonicalise it (dot segments, percent-encoding).
 * Nothing is ever sent there: the `.invalid` top-level domain is reserved and resolves
 * nowhere.
 */
const SAME_ORIGIN_PROBE = 'https://same-origin.invalid'

/** Long enough for any real address, short enough that a pasted blob is not one. */
const LINK_MAX_LENGTH = 2_048

/**
 * A path on this site in its canonical form, or `null`: one leading `/`, then anything the
 * URL parser keeps on the same origin.
 *
 * **Three ways a "path" leaves the site, each refused.** `//host/x` is protocol-relative.
 * `/\host/x` is read by every browser as `//host/x`, because for an http(s) address a
 * backslash is a slash. And `/.//host/x` is the subtle one: the parser removes the dot
 * segment and leaves a path that *starts* with `//`, so the canonical text would be
 * protocol-relative even though the input was not. The first two are refused on the text as
 * typed, the third on the canonical result.
 *
 * Whitespace and control characters are refused before parsing, for the reason
 * {@link parseHttpsUrl} gives.
 */
const parseSameOriginPath = (value: string): string | null => {
  if (/[\s\p{Cc}]/u.test(value)) return null
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null
  let url: URL
  try {
    url = new URL(value, SAME_ORIGIN_PROBE)
  } catch {
    return null
  }
  const path = `${url.pathname}${url.search}${url.hash}`
  return path.startsWith('//') ? null : path
}

/**
 * An optional link the operator owes a visitor (roadmap G2-17 / P3-18): their terms, privacy
 * policy, legal notice, help page or report page. **An https address, or a path on this
 * site**, and nothing else. A path is allowed because the hosted instance serves its legal
 * pages itself, from the same origin and ahead of this application (`/legal/signaler`), and
 * an absolute address would have to repeat the instance's own domain in its own
 * configuration.
 *
 * Blank is absent, for the reason on {@link blankAsAbsent}. What is returned is the
 * canonical form, never the text as typed.
 */
const optionalSiteLink = (variable: string, shownTo: string) =>
  z.preprocess(
    blankAsAbsent,
    z
      .string()
      .trim()
      .transform((value, ctx) => {
        const parsed =
          value.length > LINK_MAX_LENGTH
            ? null
            : value.startsWith('/')
              ? parseSameOriginPath(value)
              : parseHttpsUrl(value)
        if (parsed === null) {
          return refuse(
            ctx,
            `${variable} must be an https URL with no credentials in it, or a path on this site starting with a single / (as in /legal/terms), of at most ${LINK_MAX_LENGTH} characters: a javascript:, data: or http: address, or one that leaves the site, is refused, because this link is shown to ${shownTo}`,
          )
        }
        return parsed
      })
      .optional(),
  )

/**
 * `OPERATOR_NAME`: who runs this box, as they wish to be named (roadmap G2-17 / P3-18).
 * **Empty by default**: a self-hoster has no one to name, and the guest notice then says
 * nothing about a host beyond the organiser.
 *
 * Plain text, shown on `/about` and in the guest's privacy notice, and part of the notice's
 * revision. No control character, line break or bidirectional override: the first two would
 * break a sentence apart, and the last can make a name read as another. At least one letter
 * or digit, so a name of zero-width characters (which `trim()` leaves alone) cannot print a
 * blank "Hébergé par" line. React escapes the rest.
 */
export const operatorName = z.preprocess(
  blankAsAbsent,
  z
    .string()
    .trim()
    .min(1, 'OPERATOR_NAME must not be blank')
    .max(
      OPERATOR_NAME_MAX_LENGTH,
      `OPERATOR_NAME must be at most ${OPERATOR_NAME_MAX_LENGTH} characters`,
    )
    .refine((value) => !/[\p{Cc}\p{Zl}\p{Zp}\p{Bidi_Control}]/u.test(value), {
      error:
        'OPERATOR_NAME must not contain a control character, a line break or a bidirectional override',
    })
    .refine((value) => /[\p{L}\p{N}]/u.test(value), {
      error:
        'OPERATOR_NAME must contain at least one letter or digit: a name made only of invisible characters or punctuation would print as a blank line and still ask every guest to read the notice again',
    })
    .optional(),
)

/**
 * `OPERATOR_CONTACT_EMAIL`: where a visitor can reach the operator (roadmap G2-17). Required
 * to sit beside `OPERATOR_NAME`: an address with no one behind it is not an identity.
 *
 * One plain address, which is what zod's `z.email()` accepts and nothing wider: no display
 * name, no list, and no `?` or `&`, so the `mailto:` link built from it cannot carry a
 * header the operator did not mean to publish.
 */
export const operatorContactEmail = z.preprocess(
  blankAsAbsent,
  z
    .string()
    .trim()
    .max(254)
    // `.pipe(z.email())` rather than the string's own `.email()`, which zod 4 keeps only as a
    // deprecated alias: the trim runs first either way, and the pattern is the same one.
    .pipe(z.email('OPERATOR_CONTACT_EMAIL must be one e-mail address, such as contact@example.org'))
    .optional(),
)

/** Terms of use. See {@link optionalSiteLink}. */
export const legalTermsUrl = optionalSiteLink('LEGAL_TERMS_URL', 'every visitor')

/** Privacy policy; also linked from the guest's privacy notice. */
export const legalPrivacyUrl = optionalSiteLink('LEGAL_PRIVACY_URL', 'every visitor')

/** Legal notice (the editor's and the host's identity, under the LCEN). */
export const legalNoticeUrl = optionalSiteLink('LEGAL_NOTICE_URL', 'every visitor')

/**
 * `LEGAL_TERMS_VERSION`: the short name of the terms of use that `LEGAL_TERMS_URL` points at,
 * as they stand today (`2027-01`), which an invitation's acceptance records (G2-20).
 *
 * **Absent by default, and a box that sets neither this nor a terms URL asks nobody for
 * anything**: that is every self-hosted box. Set together with `LEGAL_TERMS_URL`, accepting an
 * invitation also means agreeing to the terms (a tick, and an audit entry carrying this
 * string); see the refinement in `schema.ts` for what a version alone does. Changing the text means
 * changing this string, which is how "which version did they accept?" has an answer.
 *
 * Narrow, because it is written into an audit row (`isTermsVersion`): at most
 * {@link TERMS_VERSION_MAX_LENGTH} characters of letters, digits, `.`, `_` and `-`. The value is
 * not echoed in a refusal: an environment variable is where a secret ends up when a line is
 * pasted into the wrong place.
 */
export const legalTermsVersion = z.preprocess(
  blankAsAbsent,
  z
    .string()
    .trim()
    .refine(isTermsVersion, {
      error: `LEGAL_TERMS_VERSION must be at most ${TERMS_VERSION_MAX_LENGTH} characters of letters, digits, '.', '_' or '-', starting with a letter or a digit, as in 2027-01`,
    })
    .optional(),
)

/** Where a host gets help. Shown to hosts and on `/about`. */
export const supportUrl = optionalSiteLink('SUPPORT_URL', 'hosts and on the public /about page')

/** Where to report a piece of content (DSA art. 16). Shown to guests. */
export const reportUrl = optionalSiteLink('REPORT_URL', 'every guest')

/**
 * `SOURCE_REF`: the tag or commit the image was built from, injected by the Dockerfile's
 * `SOURCE_REF` build argument. It replaces `/tree/v${version}` in the default link.
 *
 * A git ref in a URL path, so narrow: segments of letters, digits, dots, underscores and
 * hyphens joined by `/`, with no `..`. A tag (`v2.1.0`), a release branch (`release/2.1`)
 * and a 40-character commit all fit; a query string, a fragment, a space or a traversal
 * do not.
 */
export const sourceRef = z.preprocess(
  blankAsAbsent,
  z
    .string()
    .trim()
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/,
      'SOURCE_REF must be a git tag, branch or commit: letters, digits, dots, underscores and hyphens, joined by /',
    )
    .refine((value) => !value.includes('..'), { error: 'SOURCE_REF must not contain ..' })
    .optional(),
)
