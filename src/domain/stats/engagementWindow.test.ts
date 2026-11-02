import { describe, expect, it } from 'vitest'
import { engagementSince } from './engagementWindow'

describe('engagementSince', () => {
  it('is the earliest day measured', () => {
    expect(engagementSince(['2026-11-16', '2026-11-14', '2026-11-15'])).toBe('2026-11-14')
  })

  it('is null when nothing was measured', () => {
    expect(engagementSince([])).toBeNull()
  })
})
