import { describe, expect, it } from 'vitest'
import { statsDayOf } from './statsDay'

describe('statsDayOf', () => {
  it('is the UTC day, whatever the reader’s zone', () => {
    expect(statsDayOf(new Date('2026-06-20T23:59:59.999Z'))).toBe('2026-06-20')
  })

  it('turns over at UTC midnight', () => {
    expect(statsDayOf(new Date('2026-06-21T00:00:00.000Z'))).toBe('2026-06-21')
  })
})
