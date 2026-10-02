import { DomainError } from '../shared/errors'
import { err, ok, type Result } from '../shared/result'

/**
 * The payload of an audit entry, and the allow-list that decides what it may hold
 * (roadmap §10.8; paid plan P3-07).
 *
 * **An audit row is read by people who may not read the thing it is about.** The client's
 * own owner reads every operator action taken on their account (G2-16), and an operator
 * reads a client's trail without ever being allowed to see a photograph. So the details of
 * an entry are numbers, booleans, instants and random ids, and nothing a person typed:
 * never a caption, a guest's name, an e-mail address, a slug, a filename or a token. That
 * is not a convention reviewers are asked to remember. Each action declares the exact
 * shape of its details in `auditAction.ts`, in a vocabulary with **no free-text kind at
 * all**, and {@link validateDetails} refuses a key the declaration does not name and a
 * value that is not the declared kind.
 *
 * Why shapes rather than a deny-list of words like `caption` and `email`: a deny-list
 * refuses the leak somebody thought of, and the one that happens is the one somebody did
 * not (`note`, `label`, `comment`). A closed vocabulary refuses by default.
 *
 * Nothing here reports the offending **value**, only its path: the value is exactly the
 * thing this module exists to keep out of a log line and an error response.
 */

export type AuditDetailValue = string | number | boolean | null | AuditDetails

export interface AuditDetails {
  readonly [key: string]: AuditDetailValue
}

/**
 * The only things a detail may be.
 *
 * - `integer`: a safe integer. A counter, a byte count, a number of days.
 * - `boolean`: a switch.
 * - `instant`: an ISO-8601 UTC timestamp with milliseconds, exactly what `toISOString`
 *   writes, so it cannot smuggle prose either.
 * - `id`: an opaque identifier — letters, digits, `_` and `-`, 1 to 64 characters. The
 *   shape alone would let a slug through, which is why a key is only ever declared `id`
 *   when the value really is one the system generated.
 * - `nullable` and `object`: composition, so a snapshot can say "this ceiling was unset".
 */
export type DetailKind =
  | { readonly type: 'integer' }
  | { readonly type: 'boolean' }
  | { readonly type: 'instant' }
  | { readonly type: 'id' }
  | { readonly type: 'nullable'; readonly of: DetailKind }
  | { readonly type: 'object'; readonly fields: DetailFields }

export interface DetailFields {
  readonly [key: string]: DetailKind
}

export const detail = {
  integer: { type: 'integer' } satisfies DetailKind,
  boolean: { type: 'boolean' } satisfies DetailKind,
  instant: { type: 'instant' } satisfies DetailKind,
  id: { type: 'id' } satisfies DetailKind,
  nullable: (of: DetailKind): DetailKind => ({ type: 'nullable', of }),
  object: (fields: DetailFields): DetailKind => ({ type: 'object', fields }),
}

/** An opaque id's shape: also what a `subject_id` must look like. */
export const AUDIT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

type Problem = 'notAnObject' | 'unexpectedKey' | 'missingKey' | 'wrongType'

interface Violation {
  readonly path: string
  readonly problem: Problem
}

const hasOwn = (object: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(object, key)

/** Plain JSON objects only: no arrays, no class instances, no `Date`. */
const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * A string is an instant only if it is exactly what `toISOString` would write for the
 * moment it names. That also refuses `2026-02-30T00:00:00.000Z`, which `Date.parse`
 * quietly rolls over to March.
 */
const isInstantText = (value: unknown): boolean => {
  if (typeof value !== 'string') return false
  const parsed = new Date(value)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value
}

const joinPath = (parent: string, key: string): string => (parent === '' ? key : `${parent}.${key}`)

const violationOf = (kind: DetailKind, value: unknown, path: string): Violation | null => {
  switch (kind.type) {
    case 'integer':
      return Number.isSafeInteger(value) ? null : { path, problem: 'wrongType' }
    case 'boolean':
      return typeof value === 'boolean' ? null : { path, problem: 'wrongType' }
    case 'instant':
      return isInstantText(value) ? null : { path, problem: 'wrongType' }
    case 'id':
      return typeof value === 'string' && AUDIT_ID_PATTERN.test(value)
        ? null
        : { path, problem: 'wrongType' }
    case 'nullable':
      return value === null ? null : violationOf(kind.of, value, path)
    case 'object':
      return objectViolation(kind.fields, value, path)
  }
}

const objectViolation = (fields: DetailFields, value: unknown, path: string): Violation | null => {
  if (!isPlainObject(value)) return { path, problem: 'notAnObject' }

  for (const key of Object.keys(value)) {
    if (!hasOwn(fields, key)) return { path: joinPath(path, key), problem: 'unexpectedKey' }
  }
  for (const [key, kind] of Object.entries(fields)) {
    if (!hasOwn(value, key)) return { path: joinPath(path, key), problem: 'missingKey' }
    const nested = violationOf(kind, value[key], joinPath(path, key))
    if (nested !== null) return nested
  }
  return null
}

/**
 * Checks `details` against an action's declared fields and hands back a **copy**.
 *
 * The copy is what makes the check mean something after it returns: an entry that kept the
 * caller's own object could be edited between validation and the write, and the allow-list
 * would have vouched for a payload that is no longer the one stored. Everything that passes
 * is plain JSON, so the round trip is exact.
 */
export const validateDetails = (
  fields: DetailFields,
  details: AuditDetails,
): Result<AuditDetails, DomainError> => {
  const violation = objectViolation(fields, details, '')
  if (violation !== null) {
    return err(
      DomainError.invalid('audit.detailsInvalid', {
        path: violation.path,
        problem: violation.problem,
      }),
    )
  }
  return ok(JSON.parse(JSON.stringify(details)) as AuditDetails)
}
