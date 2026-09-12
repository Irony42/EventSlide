import { describe, expect, it } from 'vitest'
import {
  fromIsoText,
  fromNullableIsoText,
  fromSqliteBoolean,
  toIsoText,
  toSqliteBoolean,
} from './rowMapping'

describe('rowMapping', () => {
  it('writes a timestamp as ISO-8601 UTC text, so the column sorts lexicographically', () => {
    const written = toIsoText(new Date(Date.UTC(2026, 5, 20, 21, 0, 0, 123)))

    expect(written).toBe('2026-06-20T21:00:00.123Z')
  })

  it('round-trips an instant to the millisecond', () => {
    const instant = new Date('2026-06-20T21:00:00.123Z')

    expect(fromIsoText(toIsoText(instant)).getTime()).toBe(instant.getTime())
  })

  it('refuses a timestamp column that cannot be read as a date', () => {
    expect(() => fromIsoText('samedi soir')).toThrow()
  })

  it('reads a null timestamp column as null rather than as the epoch', () => {
    expect(fromNullableIsoText(null)).toBeNull()
  })

  it('reads a present nullable timestamp as its instant', () => {
    expect(fromNullableIsoText('2026-06-20T21:00:00.000Z')).toEqual(
      new Date('2026-06-20T21:00:00.000Z'),
    )
  })

  it.each([
    { value: true, stored: 1 },
    { value: false, stored: 0 },
  ])('stores $value as $stored', ({ value, stored }) => {
    expect(toSqliteBoolean(value)).toBe(stored)
  })

  it.each([
    { stored: 1, expected: true },
    { stored: 0, expected: false },
    // A hand-edited row must not read as false just because it is not exactly 1.
    { stored: 2, expected: true },
  ])('reads a stored $stored as $expected', ({ stored, expected }) => {
    expect(fromSqliteBoolean(stored)).toBe(expected)
  })
})
