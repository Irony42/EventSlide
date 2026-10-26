import { describe, expect, it } from 'vitest'
import { compareIds } from './ordering'

describe('compareIds', () => {
  it('orders ids by code unit, as the database orders text, and not by locale', () => {
    // A locale-aware comparison puts 'a' before 'B'; SQLite's BINARY collation puts 'B'
    // (0x42) before 'a' (0x61).
    expect(compareIds('B', 'a')).toBeLessThan(0)
    expect(compareIds('a', 'B')).toBeGreaterThan(0)
    expect('a'.localeCompare('B')).toBeLessThan(0)
  })

  it('puts a prefix before the longer id, as a byte comparison does', () => {
    expect(compareIds('job-1', 'job-10')).toBeLessThan(0)
  })

  it('reads 10 before 9, since an id is text and not a number', () => {
    expect(compareIds('job-10', 'job-9')).toBeLessThan(0)
  })

  it('answers zero for the same id, so a sort falls through to its next key', () => {
    expect(compareIds('job-1', 'job-1')).toBe(0)
  })

  it('sorts a list the way the database would', () => {
    expect(['b', 'a', 'B', 'A', 'a1'].sort(compareIds)).toEqual(['A', 'B', 'a', 'a1', 'b'])
  })
})
