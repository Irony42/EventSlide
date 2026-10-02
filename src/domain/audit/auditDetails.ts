import { DomainError } from '../shared/errors'
import { err, ok, type Result } from '../shared/result'

/**
 * The payload of an audit entry, and the allow-list that decides what it may hold
 * (roadmap §10.8; paid plan P3-07).
 *
 * **An audit row is read by people who may not read the thing it is about.** The client's
 * own owner reads every operator action taken on their account (G2-16), and an operator
 * reads a client's trail without ever being allowed to see a photograph. So the details of
 * an entry are numbers, switches and instants, and nothing a person typed: never a caption,
 * a guest's name, an e-mail address, a slug, a filename or a token. That is not a
 * convention reviewers are asked to remember. Each action declares the exact shape of its
 * details in `auditAction.ts`, in a vocabulary with **no string kind but an instant**, and
 * {@link validateDetails} refuses a key the declaration does not name and a value that is
 * not the declared kind.
 *
 * **There is deliberately no `id` kind.** The plan's "ids and numbers" is the right
 * ambition and the wrong thing to *enforce* by shape: a slug, a join code and a token are
 * all strings made of letters, digits and dashes, so a kind that admitted "an opaque id"
 * would admit every one of them and promise otherwise. What an entry is *about* travels in
 * its subject and its client id, which the use case takes from the entity it holds. The
 * first action that must name a second entity inside its details adds a kind for it, typed
 * to that entity and with its own test, rather than being handed a string.
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
 * - `integer`: an integer. A counter, a byte count, a number of days. Exactly the domain's
 *   own notion (`Number.isInteger`), because a ceiling the domain accepts must never be one
 *   the audit refuses: an operator who cannot lower a ceiling because writing down the old
 *   value fails has been locked out by the log. It survives JSON exactly.
 * - `boolean`: a switch.
 * - `instant`: an ISO-8601 UTC timestamp with milliseconds, exactly what `toISOString`
 *   writes, so it cannot smuggle prose either.
 * - `nullable` and `object`: composition, so a snapshot can say "this ceiling was unset".
 */
export type DetailKind =
  | { readonly type: 'integer' }
  | { readonly type: 'boolean' }
  | { readonly type: 'instant' }
  | { readonly type: 'nullable'; readonly of: DetailKind }
  | { readonly type: 'object'; readonly fields: DetailFields }

export interface DetailFields {
  readonly [key: string]: DetailKind
}

export const detail = {
  integer: { type: 'integer' } satisfies DetailKind,
  boolean: { type: 'boolean' } satisfies DetailKind,
  instant: { type: 'instant' } satisfies DetailKind,
  nullable: (of: DetailKind): DetailKind => ({ type: 'nullable', of }),
  object: (fields: DetailFields): DetailKind => ({ type: 'object', fields }),
}

type Problem = 'notAnObject' | 'unexpectedKey' | 'missingKey' | 'wrongType'

interface Violation {
  readonly path: string
  readonly problem: Problem
}

/** What checking one value yields: the value as it will be stored, or where it went wrong. */
type Checked =
  | { readonly ok: true; readonly value: AuditDetailValue }
  | { readonly ok: false; readonly violation: Violation }

const pass = (value: AuditDetailValue): Checked => ({ ok: true, value })
const fail = (path: string, problem: Problem): Checked => ({
  ok: false,
  violation: { path, problem },
})

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
const isInstantText = (value: string): boolean => {
  const parsed = new Date(value)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value
}

const joinPath = (parent: string, key: string): string => (parent === '' ? key : `${parent}.${key}`)

const check = (kind: DetailKind, value: unknown, path: string): Checked => {
  switch (kind.type) {
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
        ? pass(value)
        : fail(path, 'wrongType')
    case 'boolean':
      return typeof value === 'boolean' ? pass(value) : fail(path, 'wrongType')
    case 'instant':
      return typeof value === 'string' && isInstantText(value)
        ? pass(value)
        : fail(path, 'wrongType')
    case 'nullable':
      return value === null ? pass(null) : check(kind.of, value, path)
    case 'object':
      return checkObject(kind.fields, value, path)
  }
}

/**
 * Checks an object against its declared fields **and builds the copy as it goes**.
 *
 * Every property is read exactly once, and what is stored is what that one read returned.
 * That is the point of building the copy here instead of validating and then cloning the
 * original: a getter or a `Proxy` that answers `5` to the check and an address to the
 * second read would have been validated as a number and stored as the address. A primitive
 * read once cannot change afterwards, and the copy is frozen.
 */
const checkObject = (fields: DetailFields, value: unknown, path: string): Checked => {
  if (!isPlainObject(value)) return fail(path, 'notAnObject')

  for (const key of Object.keys(value)) {
    if (!hasOwn(fields, key)) return fail(joinPath(path, key), 'unexpectedKey')
  }

  const copy: Record<string, AuditDetailValue> = {}
  for (const [key, kind] of Object.entries(fields)) {
    if (!hasOwn(value, key)) return fail(joinPath(path, key), 'missingKey')
    const nested = check(kind, value[key], joinPath(path, key))
    if (!nested.ok) return nested
    copy[key] = nested.value
  }
  return pass(Object.freeze(copy))
}

/**
 * Checks `details` against an action's declared fields and hands back a frozen **copy**.
 *
 * The copy is what makes the check mean something after it returns: an entry that kept the
 * caller's own object could be edited between validation and the write, and the allow-list
 * would have vouched for a payload that is no longer the one stored.
 */
export const validateDetails = (
  fields: DetailFields,
  details: AuditDetails,
): Result<AuditDetails, DomainError> => {
  const checked = checkObject(fields, details, '')
  if (!checked.ok) {
    return err(
      DomainError.invalid('audit.detailsInvalid', {
        path: checked.violation.path,
        problem: checked.violation.problem,
      }),
    )
  }
  return ok(checked.value as AuditDetails)
}
