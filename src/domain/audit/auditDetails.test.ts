import { describe, expect, it } from 'vitest'
import { detail, validateDetails, type AuditDetails } from './auditDetails'

/**
 * The allow-list, exercised on shapes of its own rather than on a real action, so that
 * every kind and every refusal is pinned here and `auditAction.test.ts` only has to prove
 * the real actions are declared right.
 */

const FIELDS = {
  count: detail.integer,
  enabled: detail.boolean,
  when: detail.instant,
  maybe: detail.nullable(detail.integer),
  nested: detail.object({ n: detail.integer }),
}

const valid = (): AuditDetails => ({
  count: 3,
  enabled: true,
  when: '2026-06-20T21:00:00.000Z',
  maybe: null,
  nested: { n: 1 },
})

const refusalOf = (details: unknown): { path: unknown; problem: unknown } | null => {
  const result = validateDetails(FIELDS, details as AuditDetails)
  if (result.ok) return null
  expect(result.error.code).toBe('audit.detailsInvalid')
  return { path: result.error.details['path'], problem: result.error.details['problem'] }
}

describe('validateDetails', () => {
  it('accepts details that are exactly the declared shape', () => {
    expect(validateDetails(FIELDS, valid()).ok).toBe(true)
  })

  it('accepts a nullable key holding a value as well as null', () => {
    expect(validateDetails(FIELDS, { ...valid(), maybe: 12 }).ok).toBe(true)
  })

  it('accepts an integer as large as the domain’s own ceilings may be, so a ceiling can always be lowered', () => {
    expect(validateDetails(FIELDS, { ...valid(), count: 2 ** 60 }).ok).toBe(true)
  })

  it('hands back a copy, so editing the original afterwards cannot change what was vouched for', () => {
    const original = valid()

    const result = validateDetails(FIELDS, original)
    ;(original['nested'] as { n: number }).n = 99

    expect(result.ok && result.value).toEqual(valid())
  })

  it('hands back a frozen copy, nested objects included', () => {
    const result = validateDetails(FIELDS, valid())

    expect(result.ok && Object.isFrozen(result.value)).toBe(true)
    expect(result.ok && Object.isFrozen(result.value['nested'])).toBe(true)
  })

  it('stores what it checked: a getter that answers differently the second time cannot pass as a number and be stored as an address', () => {
    let reads = 0
    const shifty = {
      ...valid(),
      get count(): unknown {
        reads += 1
        return reads === 1 ? 5 : 'mariage-dupont@example.com'
      },
    }

    const result = validateDetails(FIELDS, shifty as unknown as AuditDetails)

    expect(result.ok && result.value['count']).toBe(5)
    expect(reads).toBe(1)
  })

  it('stores what it checked inside a nested object too', () => {
    let reads = 0
    const nested = {
      get n(): unknown {
        reads += 1
        return reads === 1 ? 5 : 'Camille Dupont'
      },
    }

    const result = validateDetails(FIELDS, { ...valid(), nested } as unknown as AuditDetails)

    expect(result.ok && result.value['nested']).toEqual({ n: 5 })
  })

  // --------------------------------------------------- the content-free rule --

  it('refuses a key the action did not declare, whatever it is called', () => {
    expect(refusalOf({ ...valid(), caption: 'Une belle photo' })).toEqual({
      path: 'caption',
      problem: 'unexpectedKey',
    })
  })

  it('refuses an undeclared key even when it is nested inside a declared object', () => {
    expect(refusalOf({ ...valid(), nested: { n: 1, guestName: 'Camille' } })).toEqual({
      path: 'nested.guestName',
      problem: 'unexpectedKey',
    })
  })

  it('refuses text where a number is declared', () => {
    expect(refusalOf({ ...valid(), count: 'three' })).toEqual({
      path: 'count',
      problem: 'wrongType',
    })
  })

  it('refuses text where a switch is declared', () => {
    expect(refusalOf({ ...valid(), enabled: 'yes' })).toEqual({
      path: 'enabled',
      problem: 'wrongType',
    })
  })

  it('refuses a fractional or non-finite number, which is not a count of anything', () => {
    expect(refusalOf({ ...valid(), count: 1.5 })).toMatchObject({ path: 'count' })
    expect(refusalOf({ ...valid(), count: Number.NaN })).toMatchObject({ path: 'count' })
    expect(refusalOf({ ...valid(), count: Number.POSITIVE_INFINITY })).toMatchObject({
      path: 'count',
    })
  })

  it('refuses a numeric string where a number is declared', () => {
    expect(refusalOf({ ...valid(), count: '3' })).toMatchObject({ path: 'count' })
  })

  it('refuses prose where an instant is declared', () => {
    expect(refusalOf({ ...valid(), when: 'last Saturday evening' })).toEqual({
      path: 'when',
      problem: 'wrongType',
    })
  })

  it('refuses an instant that is not the canonical UTC text, such as one with an offset', () => {
    expect(refusalOf({ ...valid(), when: '2026-06-20T23:00:00.000+02:00' })).toMatchObject({
      path: 'when',
    })
  })

  it('refuses a date that parses only because JavaScript rolls it over', () => {
    expect(refusalOf({ ...valid(), when: '2026-02-30T00:00:00.000Z' })).toMatchObject({
      path: 'when',
    })
  })

  it('refuses a Date object where the text of an instant is declared', () => {
    expect(refusalOf({ ...valid(), when: new Date(0) })).toMatchObject({ path: 'when' })
  })

  it('refuses a nullable key holding the wrong kind, not only one holding null', () => {
    expect(refusalOf({ ...valid(), maybe: 'text' })).toEqual({
      path: 'maybe',
      problem: 'wrongType',
    })
  })

  it('refuses a missing key, so every entry of an action has the same shape', () => {
    const withoutCount: Record<string, unknown> = { ...valid() }
    delete withoutCount['count']

    expect(refusalOf(withoutCount)).toEqual({ path: 'count', problem: 'missingKey' })
  })

  it('refuses an array or a scalar where an object is declared', () => {
    expect(refusalOf({ ...valid(), nested: [1] })).toEqual({
      path: 'nested',
      problem: 'notAnObject',
    })
    expect(refusalOf({ ...valid(), nested: 4 })).toEqual({ path: 'nested', problem: 'notAnObject' })
    expect(refusalOf({ ...valid(), nested: null })).toEqual({
      path: 'nested',
      problem: 'notAnObject',
    })
  })

  it('refuses a class instance where a plain object is declared', () => {
    expect(refusalOf({ ...valid(), nested: new Map() })).toMatchObject({ path: 'nested' })
  })

  it('refuses the whole payload when it is not an object at all', () => {
    expect(refusalOf(null)).toEqual({ path: '', problem: 'notAnObject' })
  })

  it('refuses an own __proto__ key, which a JSON body can carry and a plain `in` check would pass', () => {
    const smuggled = JSON.parse('{"__proto__": {"x": 1}}') as unknown

    expect(refusalOf(smuggled)).toEqual({ path: '__proto__', problem: 'unexpectedKey' })
  })

  it('never puts the offending value in the error, only where it was', () => {
    const result = validateDetails(FIELDS, { ...valid(), count: 'camille@example.com' })

    expect(!result.ok && JSON.stringify(result.error.details)).not.toContain('camille')
  })

  it('has no kind for an id, because a slug and a token are strings of the same alphabet', () => {
    expect(Object.keys(detail).sort()).toEqual([
      'boolean',
      'instant',
      'integer',
      'nullable',
      'object',
    ])
  })
})
