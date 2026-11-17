import { describe, expect, it } from 'vitest'
import {
  EXPORT_WINDOW_MS,
  ZIP_BYTES_PER_ENTRY,
  checkExportBytes,
  checkExportDailyLimit,
  checkExportRoom,
  checkExportTotal,
  estimateExportBytes,
  exportRetryAfterSeconds,
  exportWindowStart,
} from './exportCaps'

const GB = 1024 * 1024 * 1024

describe('estimateExportBytes', () => {
  it('is the stored bytes plus the overhead of each entry', () => {
    expect(estimateExportBytes(1000, 3)).toBe(1000 + 3 * ZIP_BYTES_PER_ENTRY)
  })
})

describe('checkExportRoom (spec 22, section 9)', () => {
  it('allows an archive that leaves exactly the minimum free', () => {
    expect(checkExportRoom(2 * GB + 500, 1 * GB + 500, GB).ok).toBe(true)
  })

  it('refuses one byte short with export.noRoom', () => {
    const result = checkExportRoom(2 * GB + 499, 1 * GB + 500, GB)

    expect(!result.ok && result.error.code).toBe('export.noRoom')
    expect(!result.ok && result.error.kind).toBe('conflict')
  })

  it('refuses an unreadable disk, never assuming there is room', () => {
    const result = checkExportRoom(null, 0, 0)

    expect(!result.ok && result.error.code).toBe('export.noRoom')
  })
})

describe('checkExportBytes', () => {
  it('is inclusive: exactly the ceiling is allowed, one more is export.tooLarge (413)', () => {
    expect(checkExportBytes(100, 100).ok).toBe(true)
    const over = checkExportBytes(101, 100)
    expect(!over.ok && over.error.code).toBe('export.tooLarge')
    expect(!over.ok && over.error.kind).toBe('quotaExceeded')
    expect(!over.ok && over.error.details).toEqual({ maxBytes: 100 })
  })
})

describe('checkExportTotal', () => {
  it('is inclusive of the box-wide ceiling and refuses one byte past it', () => {
    expect(checkExportTotal(60, 40, 100).ok).toBe(true)
    const over = checkExportTotal(60, 41, 100)
    expect(!over.ok && over.error.code).toBe('export.noRoom')
  })
})

describe('the daily ceiling', () => {
  const NOW = new Date('2026-12-01T10:00:00Z')

  it('starts the window one day back', () => {
    expect(exportWindowStart(NOW)).toEqual(new Date(NOW.getTime() - EXPORT_WINDOW_MS))
  })

  it('allows the third request and refuses the fourth, with how long to wait', () => {
    expect(checkExportDailyLimit(2, 3, 60).ok).toBe(true)
    const fourth = checkExportDailyLimit(3, 3, 60)
    expect(!fourth.ok && fourth.error.code).toBe('export.dailyLimitReached')
    expect(!fourth.ok && fourth.error.kind).toBe('rateLimited')
    expect(!fourth.ok && fourth.error.details).toEqual({ max: 3, retryAfterSeconds: 60 })
  })

  it('tells a refused host to wait until the oldest request leaves the window, at least a second', () => {
    const oldest = new Date(NOW.getTime() - EXPORT_WINDOW_MS + 90_500)

    expect(exportRetryAfterSeconds(oldest, NOW)).toBe(91)
    expect(exportRetryAfterSeconds(new Date(NOW.getTime() - EXPORT_WINDOW_MS - 5000), NOW)).toBe(1)
  })
})
