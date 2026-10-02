import { describe, expect, it } from 'vitest'
import { evaluateDiskSpace } from './diskSpaceGuard'

describe('evaluateDiskSpace', () => {
  it('is sufficient when every path clears the floor', () => {
    const status = evaluateDiskSpace([5_000, 5_000], 5_000)

    expect(status).toEqual({ sufficient: true, freeBytes: 5_000 })
  })

  it('refuses one byte under the floor on the tighter of two paths', () => {
    const status = evaluateDiskSpace([5_000, 4_999], 5_000)

    expect(status).toEqual({ sufficient: false, freeBytes: 4_999 })
  })

  it('reports the tightest margin across every path, not the first or the last', () => {
    const status = evaluateDiskSpace([9_000, 1_000, 9_000], 500)

    expect(status.freeBytes).toBe(1_000)
  })

  it('treats a single unreadable path as insufficient, never as room to assume', () => {
    const status = evaluateDiskSpace([9_000, null], 500)

    expect(status).toEqual({ sufficient: false, freeBytes: null })
  })

  it('reports no single margin when any path is unreadable, even if another path is also low', () => {
    // The point: this never silently reports the one number it does have as the margin.
    const status = evaluateDiskSpace([100, null], 500)

    expect(status.freeBytes).toBeNull()
  })
})
