import type { Response } from 'express'
import type { DomainError, DomainErrorKind } from '../../../domain/shared/errors'
import type { Result } from '../../../domain/shared/result'

/**
 * The single place a domain failure becomes a status code.
 *
 * One table, exhaustive by construction: adding a `DomainErrorKind` without a status
 * fails to compile. 1.0 chose a status at each of forty-odd call sites, which is why
 * the same class of failure answered 400 in one route, 500 in another, and a redirect
 * in a third.
 */
const STATUS_BY_KIND: Readonly<Record<DomainErrorKind, number>> = {
  invalid: 400,
  unauthenticated: 401,
  forbidden: 403,
  notFound: 404,
  conflict: 409,
  quotaExceeded: 413,
  rateLimited: 429,
  unexpected: 500,
}

export const statusForKind = (kind: DomainErrorKind): number => STATUS_BY_KIND[kind]

export interface ErrorBody {
  readonly error: {
    readonly code: string
    readonly message: string
    readonly details: Readonly<Record<string, string | number | boolean>>
  }
}

/**
 * The wire shape of every failure.
 *
 * `message` is for a developer reading a log or a network tab; the client renders
 * French chosen from `code`. It never carries a stack trace, a SQL fragment, a
 * filesystem path or personal data — the error handler logs those instead, against the
 * request id.
 */
export const errorBody = (error: DomainError): ErrorBody => ({
  error: {
    code: error.code,
    message: error.message,
    details: error.details,
  },
})

export const sendError = (res: Response, error: DomainError): void => {
  res.status(statusForKind(error.kind)).json(errorBody(error))
}

export const sendNoContent = (res: Response): void => {
  res.status(204).end()
}

export const sendJson = <T>(res: Response, body: T, status = 200): void => {
  res.status(status).json(body)
}

/**
 * Unwraps a use case's `Result` into a response.
 *
 * Every controller ends in this, so the success shape is the only thing a route
 * decides and the failure shape cannot vary between routes.
 */
export const sendResult = <T>(
  res: Response,
  result: Result<T, DomainError>,
  onSuccess: (res: Response, value: T) => void,
): void => {
  if (!result.ok) {
    sendError(res, result.error)
    return
  }
  onSuccess(res, result.value)
}

/** For a use case whose success carries nothing worth returning. */
export const sendResultNoContent = (res: Response, result: Result<unknown, DomainError>): void => {
  sendResult(res, result, (response) => sendNoContent(response))
}
