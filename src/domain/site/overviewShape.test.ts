import { describe, expect, it } from 'vitest'
import { field, keyNames, pathsOfKind, shapeViolations, type FieldShape } from './overviewShape'

/**
 * The vocabulary, exercised on shapes of its own so that every kind and every refusal is
 * pinned here and `siteOverviewRows.test.ts` only has to prove the real rows are declared
 * right.
 */

const SHAPE = field.object({
  id: field.id,
  note: field.label('a test needs one piece of free text'),
  at: field.instant,
  tally: field.count,
  on: field.flag,
  status: field.oneOf(['live', 'closed']),
  maybe: field.nullable(field.count),
  nested: field.object({ n: field.count }),
  items: field.list(field.object({ ref: field.id })),
})

const valid = (): Record<string, unknown> => ({
  id: 'client-1',
  note: 'Atelier',
  at: new Date('2026-06-20T21:00:00.000Z'),
  tally: 3,
  on: true,
  status: 'live',
  maybe: null,
  nested: { n: 1 },
  items: [{ ref: 'a' }, { ref: 'b' }],
})

const violationsOf = (shape: FieldShape, value: unknown): string[] =>
  shapeViolations(shape, value).map((violation) => `${violation.path}:${violation.problem}`)

describe('shapeViolations', () => {
  it('finds nothing wrong with a value that is exactly the declared shape', () => {
    expect(shapeViolations(SHAPE, valid())).toEqual([])
  })

  it('accepts a nullable field holding a value as well as null', () => {
    expect(shapeViolations(SHAPE, { ...valid(), maybe: 12 })).toEqual([])
  })

  it('accepts an empty list', () => {
    expect(shapeViolations(SHAPE, { ...valid(), items: [] })).toEqual([])
  })

  it('refuses a key the shape does not name, and says where', () => {
    expect(violationsOf(SHAPE, { ...valid(), slug: 'camille-et-sacha' })).toEqual([
      'slug:unexpectedKey',
    ])
  })

  it('refuses an unnamed key inside a nested object and inside a list item', () => {
    expect(violationsOf(SHAPE, { ...valid(), nested: { n: 1, caption: 'x' } })).toEqual([
      'nested.caption:unexpectedKey',
    ])
    expect(violationsOf(SHAPE, { ...valid(), items: [{ ref: 'a', name: 'x' }] })).toEqual([
      'items[].name:unexpectedKey',
    ])
  })

  it('refuses a declared key that is missing', () => {
    const { tally: _tally, ...withoutTally } = valid()

    expect(violationsOf(SHAPE, withoutTally)).toEqual(['tally:missingKey'])
  })

  it('reports an undefined value as the wrong type, not as a missing key', () => {
    expect(violationsOf(SHAPE, { ...valid(), tally: undefined })).toEqual(['tally:wrongType'])
  })

  it.each([
    ['an id that is empty', { id: '' }, 'id'],
    ['an id that is a number', { id: 4 }, 'id'],
    ['a label that is empty', { note: '' }, 'note'],
    ['an instant that is a string', { at: '2026-06-20T21:00:00.000Z' }, 'at'],
    ['an instant that is an invalid date', { at: new Date('nope') }, 'at'],
    ['a count that is negative', { tally: -1 }, 'tally'],
    ['a count that is fractional', { tally: 1.5 }, 'tally'],
    ['a count that is not finite', { tally: Number.POSITIVE_INFINITY }, 'tally'],
    ['a count beyond the safe integers', { tally: 2 ** 53 }, 'tally'],
    ['a count that is a numeric string', { tally: '3' }, 'tally'],
    ['a flag that is a number', { on: 1 }, 'on'],
    ['a status outside the closed set', { status: 'draft' }, 'status'],
    ['a status that is not a string', { status: 7 }, 'status'],
    ['a nullable that is the wrong type underneath', { maybe: 'x' }, 'maybe'],
  ])('refuses %s', (_name, patch, path) => {
    expect(violationsOf(SHAPE, { ...valid(), ...patch })).toEqual([`${path}:wrongType`])
  })

  it('refuses a value that is not an object where an object is declared', () => {
    expect(violationsOf(SHAPE, 'text')).toEqual([':notAnObject'])
    expect(violationsOf(SHAPE, null)).toEqual([':notAnObject'])
    expect(violationsOf(SHAPE, { ...valid(), nested: [] })).toEqual(['nested:notAnObject'])
  })

  it('refuses a class instance as a row, so an entity cannot be handed over whole', () => {
    class Entity {
      readonly n = 1
    }

    expect(violationsOf(SHAPE, { ...valid(), nested: new Entity() })).toEqual([
      'nested:notAnObject',
    ])
  })

  it('accepts an object with no prototype, which is what some drivers return', () => {
    const bare = Object.assign(Object.create(null) as object, { n: 1 })

    expect(shapeViolations(SHAPE, { ...valid(), nested: bare })).toEqual([])
  })

  it('refuses a value that is not a list where a list is declared', () => {
    expect(violationsOf(SHAPE, { ...valid(), items: { 0: { ref: 'a' } } })).toEqual([
      'items:notAList',
    ])
  })

  it('names the item of a list that is wrong', () => {
    expect(violationsOf(SHAPE, { ...valid(), items: [{ ref: 'a' }, { ref: '' }] })).toEqual([
      'items[].ref:wrongType',
    ])
  })

  it('never puts the offending value in what it reports', () => {
    const secret = 'camille-et-sacha'
    const reported = JSON.stringify(
      shapeViolations(SHAPE, { ...valid(), slug: secret, tally: secret }),
    )

    expect(reported).not.toContain(secret)
  })
})

describe('pathsOfKind', () => {
  it('lists the free-text fields wherever they sit', () => {
    const shape = field.object({
      name: field.label('shown'),
      deep: field.nullable(field.object({ title: field.label('also shown') })),
      rows: field.list(field.object({ text: field.label('in a list'), n: field.count })),
      n: field.count,
    })

    expect(pathsOfKind(shape, 'label')).toEqual(['name', 'deep.title', 'rows[].text'])
  })

  it('finds a field that is the whole shape', () => {
    expect(pathsOfKind(field.label('only'), 'label')).toEqual([''])
  })

  it('lists the ids too, which is how a test counts the identifiers a row carries', () => {
    expect(pathsOfKind(SHAPE, 'id')).toEqual(['id', 'items[].ref'])
  })

  it('finds nothing of a kind the shape does not use', () => {
    expect(pathsOfKind(field.object({ n: field.count }), 'label')).toEqual([])
  })
})

describe('keyNames', () => {
  it('lists every key at every depth, through nullable and list wrappers', () => {
    const shape = field.object({
      a: field.count,
      b: field.nullable(field.object({ c: field.flag })),
      d: field.list(field.object({ e: field.id })),
    })

    expect(keyNames(shape)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('has no key for a shape that is not an object', () => {
    expect(keyNames(field.count)).toEqual([])
  })
})
