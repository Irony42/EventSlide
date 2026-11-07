import { describe, expect, it } from 'vitest'
import { hasOwn, isPlainObject } from './plainObject'

describe('hasOwn', () => {
  it('is true for a key the object holds itself', () => {
    expect(hasOwn({ a: undefined }, 'a')).toBe(true)
  })

  it('is false for a key only the prototype chain has', () => {
    expect(hasOwn({}, 'toString')).toBe(false)
    expect(hasOwn({}, 'a')).toBe(false)
  })
})

describe('isPlainObject', () => {
  it('accepts object literals and objects with no prototype', () => {
    expect(isPlainObject({})).toBe(true)
    expect(isPlainObject({ a: 1 })).toBe(true)
    expect(isPlainObject(Object.create(null))).toBe(true)
  })

  it('refuses arrays, class instances, dates and every non-object', () => {
    class Entity {}
    expect(isPlainObject([])).toBe(false)
    expect(isPlainObject(new Entity())).toBe(false)
    expect(isPlainObject(new Date())).toBe(false)
    expect(isPlainObject(null)).toBe(false)
    expect(isPlainObject('text')).toBe(false)
    expect(isPlainObject(undefined)).toBe(false)
  })
})
