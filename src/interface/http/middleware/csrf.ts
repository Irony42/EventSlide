import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { RequestHandler, Response } from 'express'
import { DomainError } from '../../../domain/shared/errors'
import { sendError } from '../presenters/send'

/**
 * Double-submit CSRF.
 *
 * A random token is issued in a **readable** cookie and must be echoed in a header on
 * every state-changing request. An attacker's page can make the browser send the
 * cookie, but the same-origin policy stops it reading the value, so it cannot set the
 * header.
 *
 * Why `SameSite=Lax` is not enough on its own here: it still permits a cross-site
 * **top-level** POST, and this product is reached by scanning a QR code — following a
 * link from outside the app is the normal case, not the exception, so the assumption
 * `Lax` relies on does not hold as cleanly as it does elsewhere.
 *
 * Why not a synchroniser token tied to the session: guests have no session, and the
 * guest upload endpoint is exactly the one that most needs the protection.
 */

export const CSRF_COOKIE = 'es_csrf'
export const CSRF_HEADER = 'x-csrf-token'

const TOKEN_BYTES = 32
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export interface CsrfOptions {
  readonly secureCookie: boolean
}

/**
 * One place that decides the cookie's attributes.
 *
 * Both the first issue and every rotation go through here, because a rotation that
 * differed in `path` would not replace the cookie — a browser keys a cookie on name,
 * domain and path — it would sit *alongside* the old one, both names would be sent,
 * and the server would compare the header against whichever one `cookie-parser`
 * happened to read first.
 */
const setCsrfCookie = (res: Response, secureCookie: boolean): void => {
  res.cookie(CSRF_COOKIE, randomBytes(TOKEN_BYTES).toString('base64url'), {
    httpOnly: false,
    sameSite: 'lax',
    secure: secureCookie,
    path: '/',
  })
}

/**
 * Issues the cookie when it is missing.
 *
 * Deliberately **not** `HttpOnly`: the client has to read it to echo it. That is the
 * design, not an oversight — the value is not a credential on its own, it is proof that
 * the caller can read this origin's cookies.
 */
export const issueCsrfToken =
  ({ secureCookie }: CsrfOptions): RequestHandler =>
  (req, res, next) => {
    if (req.cookies?.[CSRF_COOKIE] === undefined) {
      setCsrfCookie(res, secureCookie)
    }
    next()
  }

/**
 * Replaces the token, whether or not the caller already holds one.
 *
 * Called in the same gesture as `session.regenerate()` and `session.destroy()`, from
 * `routes/authRoutes.ts`. Before this existed the cookie was write-once: `issueCsrfToken`
 * sets it only when it is absent, so one `es_csrf` covered the anonymous visitor, the
 * guest and the signed-in host alike, and it outlived both the login and the logout it
 * spanned. A token that survives a change of identity is a token whose scope nobody can
 * state.
 *
 * Safe to call from inside a handler: `requireCsrfToken` has already run and passed on
 * *this* request, so rotating now constrains only the next one.
 *
 * ---
 *
 * ### Why the token is rotated but still not signed
 *
 * The obvious next step is the *signed double-submit* pattern — put
 * `value.HMAC(SESSION_SECRET, value)` in the cookie instead of a bare random value — so
 * that something able to write a cookie on this origin (a compromised sibling
 * subdomain, a MITM on a plain-HTTP internal deployment) can no longer forge a pair.
 * It was considered here and deliberately not done. Three reasons, in order of how much
 * they decide it:
 *
 * 1. **A signature over a random value binds nothing.** Ask what the verifier could
 *    compare. It can check that the signature is its own and that the cookie equals the
 *    header, and that is all — nothing in the pair names *this* browser. An attacker who
 *    can write our cookies can also simply ask us for a token: any GET issues one to
 *    anybody. They inject that genuinely-signed value as the cookie and echo it in the
 *    header, and it verifies. Signing a random value converts an unforgeable-by-guessing
 *    token into an unforgeable-by-guessing token, at the cost of ten lines and the
 *    belief that something was fixed.
 *
 * 2. **Binding it to the session would work, and cannot reach the callers that need
 *    it.** `HMAC(secret, req.sessionID)` really is unforgeable without the session id,
 *    which is `HttpOnly` and host-only. But a guest has no session: `saveUninitialized:
 *    false` means `express-session` mints a fresh, never-stored `req.sessionID` on every
 *    anonymous request, so a token bound to it would already be invalid on the request
 *    after the one that issued it. And `POST /api/join` — the request that creates the
 *    guest identity — runs before there is any identity to bind to at all. Binding would
 *    therefore protect hosts, who already hold an `HttpOnly`, `SameSite=Lax`, host-only
 *    session cookie whose id is regenerated on login, and would leave the guest upload
 *    flow, which the review itself calls the one that most needs the protection, exactly
 *    where it is.
 *
 * 3. **The forged pair cannot be delivered in the first place.** `x-csrf-token` is not a
 *    CORS-safelisted request header, so a cross-origin caller has to pass a preflight
 *    before it may send one — and this server mounts no CORS middleware and emits no
 *    `Access-Control-Allow-*` header, so there is nothing for a preflight to succeed
 *    against. A compromised sibling subdomain can write our cookies, but it is still a
 *    *different origin*: it can make the browser send the cookie and it still cannot set
 *    the header. What is left that can set it is script running on this very origin, and
 *    against that the double-submit is moot whatever the token is made of.
 *
 * So this is a considered no rather than an omission, and it has exactly one
 * dependency, which is written here so the next reader finds it before repeating the
 * analysis: **if CORS is ever added to this server, reopen it.** An allowed origin is
 * precisely what turns cookie injection back into a deliverable CSRF, and at that point
 * the session-bound variant of (2) becomes worth its asymmetry.
 *
 * For completeness, the control that *would* close cookie injection for guests and
 * hosts alike is the `__Host-` cookie prefix: a browser refuses to set such a cookie
 * with a `Domain` attribute, so a sibling subdomain cannot write it or shadow it. It is
 * not adopted here because it mandates `Secure`, which would break every plain-HTTP
 * self-hosted install this repo still supports, and because it renames a cookie that
 * `docs/SECURITY.md`, `web/src/lib/http.ts` and the e2e fixtures all name literally.
 */
export const rotateCsrfToken = (res: Response, { secureCookie }: CsrfOptions): void => {
  setCsrfCookie(res, secureCookie)
}

const matches = (a: string, b: string): boolean => {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  // `timingSafeEqual` throws on a length mismatch, so the lengths are compared first.
  // Length is not secret here — the token is a fixed size — so this leaks nothing.
  if (left.length !== right.length) return false
  return timingSafeEqual(new Uint8Array(left), new Uint8Array(right))
}

export const requireCsrfToken: RequestHandler = (req, res, next) => {
  if (SAFE_METHODS.has(req.method)) {
    next()
    return
  }

  const cookie = req.cookies?.[CSRF_COOKIE]
  const header = req.get(CSRF_HEADER)

  if (typeof cookie !== 'string' || cookie.length === 0 || header === undefined) {
    sendError(res, DomainError.forbidden('request.csrfMissing'))
    return
  }
  if (!matches(cookie, header)) {
    sendError(res, DomainError.forbidden('request.csrfMismatch'))
    return
  }
  next()
}
