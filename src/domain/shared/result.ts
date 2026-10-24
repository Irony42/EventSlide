/**
 * Explicit success-or-failure, instead of exceptions for expected outcomes.
 *
 * Every domain constructor and every entity transition returns a `Result`. That is
 * what makes error paths visible in the type system and therefore tested: a caller
 * cannot reach `.value` without narrowing first, so "what if the caption is too long"
 * stops being a branch nobody wrote.
 *
 * Exceptions remain for genuine bugs (a broken invariant, an impossible state). They
 * are not used for "the guest typed something invalid".
 */

export interface Ok<T> {
  readonly ok: true
  readonly value: T
}

export interface Err<E> {
  readonly ok: false
  readonly error: E
}

export type Result<T, E> = Ok<T> | Err<E>

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value })

export const err = <E>(error: E): Err<E> => ({ ok: false, error })

/** Chain another fallible step. */
export const flatMap = <T, U, E>(
  result: Result<T, E>,
  next: (value: T) => Result<U, E>,
): Result<U, E> => (result.ok ? next(result.value) : result)

export const unwrapOr = <T, E>(result: Result<T, E>, fallback: T): T =>
  result.ok ? result.value : fallback
