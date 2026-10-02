/**
 * The closed vocabulary a content-free read model is allowed to speak (docs/ROADMAP.md
 * §10.4 and §10.6; paid plan P3-12, D-06).
 *
 * **The operator sees shapes and sizes, never what a client's guests made or typed.** A
 * photograph, a caption, a guest's name, an event's name, the slug that leads to its public
 * wall, the code that joins it: none of those may reach the operator's console, however
 * innocently a column was added to a query. That is not a convention a reviewer is asked to
 * remember; it is a *shape* the read model is declared in, and a value that does not fit the
 * shape is a defect a test names.
 *
 * Why a closed vocabulary and not a deny-list of words like `caption` and `slug`: a
 * deny-list refuses the leak somebody thought of, and the one that happens is the one
 * somebody did not (`note`, `label`, `title`). Here a field is one of a handful of kinds,
 * and the only kind that can carry something a person typed is `label`. Each `label` is
 * declared with the reason the operator needs it, the set of them is pinned by name in
 * `siteOverviewRows.test.ts`, and adding one is therefore a visible decision in a diff
 * instead of a column that rides along.
 *
 * The same idea as the audit log's `DetailKind` (`audit/auditDetails.ts`), with two
 * differences: the values here are the ones an adapter hands back (`Date`s, not ISO text),
 * and this checks a value without copying it, because an adapter's rows are built by code
 * this repository owns and not parsed from a caller.
 *
 * Nothing here reports the offending **value**, only its path: the value is exactly the
 * thing this module exists to keep out of a log line and an error message.
 */

/**
 * - `id`: the opaque identifier of a record the operator manages — a client, an event, an
 *   account. A non-empty string. It is *not* an invitation to carry any other string: a
 *   slug and a join code are made of the same characters, which is why the sweep in
 *   `siteOverviewContract.ts` plants both and looks for them.
 * - `instant`: a valid `Date`.
 * - `count`: a safe, non-negative integer. A tally, a byte count, a number of days.
 * - `flag`: a boolean.
 * - `oneOf`: one member of a closed set, a status or a role.
 * - `label`: **free text a person typed.** The one kind that can leak.
 * - `nullable`, `object`, `list`: composition.
 */
export type FieldShape =
  | { readonly kind: 'id' }
  | { readonly kind: 'instant' }
  | { readonly kind: 'count' }
  | { readonly kind: 'flag' }
  | { readonly kind: 'oneOf'; readonly values: readonly string[] }
  | { readonly kind: 'label'; readonly reason: string }
  | { readonly kind: 'nullable'; readonly of: FieldShape }
  | { readonly kind: 'object'; readonly fields: Readonly<Record<string, FieldShape>> }
  | { readonly kind: 'list'; readonly of: FieldShape }

export type FieldKind = FieldShape['kind']

export const field = {
  id: { kind: 'id' } satisfies FieldShape,
  instant: { kind: 'instant' } satisfies FieldShape,
  count: { kind: 'count' } satisfies FieldShape,
  flag: { kind: 'flag' } satisfies FieldShape,
  oneOf: (values: readonly string[]): FieldShape => ({ kind: 'oneOf', values }),
  /** `reason` is documentation that cannot be left out: why the operator needs this text. */
  label: (reason: string): FieldShape => ({ kind: 'label', reason }),
  nullable: (of: FieldShape): FieldShape => ({ kind: 'nullable', of }),
  object: (fields: Readonly<Record<string, FieldShape>>): FieldShape => ({
    kind: 'object',
    fields,
  }),
  list: (of: FieldShape): FieldShape => ({ kind: 'list', of }),
}

export type ShapeProblem = 'notAnObject' | 'notAList' | 'unexpectedKey' | 'missingKey' | 'wrongType'

export interface ShapeViolation {
  readonly path: string
  readonly problem: ShapeProblem
}

const hasOwn = (object: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(object, key)

/** Plain objects only: no class instance, so an entity cannot be handed over as a row. */
const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const joinPath = (parent: string, key: string): string => (parent === '' ? key : `${parent}.${key}`)

/** Everything wrong with `value` against `shape`; empty when it fits. */
export const shapeViolations = (
  shape: FieldShape,
  value: unknown,
  path = '',
): readonly ShapeViolation[] => {
  const wrong = (problem: ShapeProblem): readonly ShapeViolation[] => [{ path, problem }]

  switch (shape.kind) {
    case 'id':
    case 'label':
      return typeof value === 'string' && value.length > 0 ? [] : wrong('wrongType')
    case 'instant':
      return value instanceof Date && !Number.isNaN(value.getTime()) ? [] : wrong('wrongType')
    case 'count':
      return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
        ? []
        : wrong('wrongType')
    case 'flag':
      return typeof value === 'boolean' ? [] : wrong('wrongType')
    case 'oneOf':
      return typeof value === 'string' && shape.values.includes(value) ? [] : wrong('wrongType')
    case 'nullable':
      return value === null ? [] : shapeViolations(shape.of, value, path)
    case 'list':
      return Array.isArray(value)
        ? value.flatMap((item: unknown) => shapeViolations(shape.of, item, `${path}[]`))
        : wrong('notAList')
    case 'object': {
      if (!isPlainObject(value)) return wrong('notAnObject')
      const unexpected = Object.keys(value)
        .filter((key) => !hasOwn(shape.fields, key))
        .map((key): ShapeViolation => ({ path: joinPath(path, key), problem: 'unexpectedKey' }))
      const declared = Object.entries(shape.fields).flatMap(([key, nested]) =>
        hasOwn(value, key)
          ? shapeViolations(nested, value[key], joinPath(path, key))
          : [{ path: joinPath(path, key), problem: 'missingKey' } satisfies ShapeViolation],
      )
      return [...unexpected, ...declared]
    }
  }
}

/**
 * Where in a shape a field of the given kind sits, as dotted paths (`[]` for a list item).
 *
 * What lets a test state "these are the only free-text fields the operator can ever be
 * shown" as a list of names, instead of as a promise.
 */
export const pathsOfKind = (shape: FieldShape, kind: FieldKind, path = ''): readonly string[] => {
  const here = shape.kind === kind ? [path] : []
  switch (shape.kind) {
    case 'nullable':
      return [...here, ...pathsOfKind(shape.of, kind, path)]
    case 'list':
      return [...here, ...pathsOfKind(shape.of, kind, `${path}[]`)]
    case 'object':
      return [
        ...here,
        ...Object.entries(shape.fields).flatMap(([key, nested]) =>
          pathsOfKind(nested, kind, joinPath(path, key)),
        ),
      ]
    default:
      return here
  }
}

/** Every key name used anywhere in a shape, for a test that reads the names themselves. */
export const keyNames = (shape: FieldShape): readonly string[] => {
  switch (shape.kind) {
    case 'nullable':
    case 'list':
      return keyNames(shape.of)
    case 'object':
      return Object.entries(shape.fields).flatMap(([key, nested]) => [key, ...keyNames(nested)])
    default:
      return []
  }
}
