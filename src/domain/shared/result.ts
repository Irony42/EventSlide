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

/** Narrowing helpers, for the places a predicate reads better than a property test. */
export const isOk = <T, E>(result: Result<T, E>): result is Ok<T> => result.ok

export const isErr = <T, E>(result: Result<T, E>): result is Err<E> => !result.ok

/** Transform a success, leaving a failure untouched. */
export const map = <T, U, E>(result: Result<T, E>, transform: (value: T) => U): Result<U, E> =>
  result.ok ? ok(transform(result.value)) : result

/** Chain another fallible step. */
export const flatMap = <T, U, E>(
  result: Result<T, E>,
  next: (value: T) => Result<U, E>,
): Result<U, E> => (result.ok ? next(result.value) : result)

/** Transform a failure, leaving a success untouched. */
export const mapErr = <T, E, F>(result: Result<T, E>, transform: (error: E) => F): Result<T, F> =>
  result.ok ? result : err(transform(result.error))

export const unwrapOr = <T, E>(result: Result<T, E>, fallback: T): T =>
  result.ok ? result.value : fallback

/**
 * All-or-nothing over several results, failing on the first error.
 *
 * Used when building an entity out of value objects: `collect([name, slug, code])`
 * either yields every parsed value or the first reason it could not.
 */
export const collect = <T, E>(results: readonly Result<T, E>[]): Result<readonly T[], E> => {
  const values: T[] = []
  for (const result of results) {
    if (!result.ok) return result
    values.push(result.value)
  }
  return ok(values)
}

/**
 * Every failure rather than only the first.
 *
 * A guest filling in a form should learn about all the invalid fields at once, so the
 * HTTP layer uses this shape when it validates a whole payload.
 */
export const collectAll = <T, E>(
  results: readonly Result<T, E>[],
): Result<readonly T[], readonly E[]> => {
  const values: T[] = []
  const errors: E[] = []
  for (const result of results) {
    if (result.ok) values.push(result.value)
    else errors.push(result.error)
  }
  return errors.length > 0 ? err(errors) : ok(values)
}
