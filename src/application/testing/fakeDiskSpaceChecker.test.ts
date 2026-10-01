import { describe, expect, it } from 'vitest'
import { FakeDiskSpaceChecker } from './fakeDiskSpaceChecker'

describe('FakeDiskSpaceChecker', () => {
  it('answers generously for a path nobody configured', async () => {
    const checker = new FakeDiskSpaceChecker()

    expect(await checker.freeBytes('/data')).toBe(10_000_000_000)
  })

  it('answers a configured value for the exact path it was set on', async () => {
    const checker = new FakeDiskSpaceChecker().set('/data', 123)

    expect(await checker.freeBytes('/data')).toBe(123)
    expect(await checker.freeBytes('/media')).toBe(10_000_000_000)
  })

  it('answers null when a path is set unreadable', async () => {
    const checker = new FakeDiskSpaceChecker().set('/data', null)

    expect(await checker.freeBytes('/data')).toBeNull()
  })
})
