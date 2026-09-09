import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { RequestHandler } from 'express'
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
      res.cookie(CSRF_COOKIE, randomBytes(TOKEN_BYTES).toString('base64url'), {
        httpOnly: false,
        sameSite: 'lax',
        secure: secureCookie,
        path: '/',
      })
    }
    next()
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
