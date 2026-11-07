import { getConfig } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

/**
 * The harness in `setup.ts` is what keeps one test's state out of the next. The first
 * test of each pair writes, the second (which runs after it, in file order) must find
 * nothing: that is the only way to observe an `afterEach` from a test.
 */
describe('the shared test setup', () => {
  describe('between two tests of one file', () => {
    it('lets a test write to both storages', () => {
      localStorage.setItem('eventslide.test.local', '1')
      sessionStorage.setItem('eventslide.test.session', '1')
      expect(localStorage.getItem('eventslide.test.local')).toBe('1')
      expect(sessionStorage.getItem('eventslide.test.session')).toBe('1')
    })

    it('starts the next test with both storages empty', () => {
      expect([localStorage.length, sessionStorage.length]).toEqual([0, 0])
    })
  })

  it('gives findBy and waitFor room for a cold lazy chunk', () => {
    expect(getConfig().asyncUtilTimeout).toBe(5_000)
  })
})
