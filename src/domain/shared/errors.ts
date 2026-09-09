/**
 * The single failure vocabulary of the domain.
 *
 * A `DomainError` carries a **kind**, which the HTTP layer maps to a status code, and
 * a **code**, which is a stable machine string the client maps to French copy. Neither
 * carries a user-facing message: 1.0 hardcoded French strings inside route handlers,
 * so the wording could not change without editing the server and could not be
 * translated at all.
 *
 * Codes are namespaced by aggregate (`photo.notFound`, `event.quotaExceeded`) and are
 * part of the API contract. Renaming one is a breaking change; add a new code instead.
 */

export type DomainErrorKind =
  /** The input could not be parsed into a valid value. → 400 */
  | 'invalid'
  /** No principal at all. → 401 */
  | 'unauthenticated'
  /** A principal, but not one allowed to do this. → 403 */
  | 'forbidden'
  /** Absent, or present but out of the caller's scope — the two are indistinguishable
   *  on purpose, so a 404 cannot be used to enumerate another event's photos. → 404 */
  | 'notFound'
  /** The action collides with existing state (duplicate slug, illegal transition). → 409 */
  | 'conflict'
  /** A limit deliberately stopped the action (event byte quota, file too large). → 413 */
  | 'quotaExceeded'
  /** Too many attempts. → 429 */
  | 'rateLimited'
  /** A bug or an unavailable dependency. → 500 */
  | 'unexpected'

/** Structured context for the client. Never contains paths, SQL, or personal data. */
export type DomainErrorDetails = Readonly<Record<string, string | number | boolean>>

export class DomainError extends Error {
  readonly kind: DomainErrorKind
  readonly code: string
  readonly details: DomainErrorDetails

  private constructor(kind: DomainErrorKind, code: string, details: DomainErrorDetails) {
    // `message` is for logs and stack traces only. User-facing text is chosen from
    // `code` in web/src/lib/i18n/.
    super(`${kind}: ${code}`)
    this.name = 'DomainError'
    this.kind = kind
    this.code = code
    this.details = details
  }

  static invalid(code: string, details: DomainErrorDetails = {}): DomainError {
    return new DomainError('invalid', code, details)
  }

  static unauthenticated(code: string, details: DomainErrorDetails = {}): DomainError {
    return new DomainError('unauthenticated', code, details)
  }

  static forbidden(code: string, details: DomainErrorDetails = {}): DomainError {
    return new DomainError('forbidden', code, details)
  }

  static notFound(code: string, details: DomainErrorDetails = {}): DomainError {
    return new DomainError('notFound', code, details)
  }

  static conflict(code: string, details: DomainErrorDetails = {}): DomainError {
    return new DomainError('conflict', code, details)
  }

  static quotaExceeded(code: string, details: DomainErrorDetails = {}): DomainError {
    return new DomainError('quotaExceeded', code, details)
  }

  static rateLimited(code: string, details: DomainErrorDetails = {}): DomainError {
    return new DomainError('rateLimited', code, details)
  }

  static unexpected(code: string, details: DomainErrorDetails = {}): DomainError {
    return new DomainError('unexpected', code, details)
  }

  static is(value: unknown): value is DomainError {
    return value instanceof DomainError
  }
}
