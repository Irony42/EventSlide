import { describe, expect, it } from 'vitest'
import {
  EXPORT_FAILURE_CODES,
  EXPORT_STALE_REASONS,
  EXPORT_STATUSES,
  canTransitionExport,
  exportHasFile,
  isExportActive,
  isExportFailureCode,
  isExportStaleReason,
  isExportStatus,
} from './albumExportStatus'

describe('the archive status machine', () => {
  it('allows exactly the moves of the diagram', () => {
    const allowed: Record<string, string[]> = {
      queued: ['running'],
      running: ['queued', 'sealed', 'failed', 'stale'],
      sealed: ['stale', 'queued'],
      failed: ['queued'],
      stale: ['queued'],
    }
    for (const from of EXPORT_STATUSES) {
      for (const to of EXPORT_STATUSES) {
        expect(canTransitionExport(from, to), `${from} -> ${to}`).toBe(
          allowed[from]?.includes(to) ?? false,
        )
      }
    }
  })

  it('says only queued and running are active, and only sealed has a file', () => {
    expect(EXPORT_STATUSES.filter(isExportActive)).toEqual(['queued', 'running'])
    expect(EXPORT_STATUSES.filter(exportHasFile)).toEqual(['sealed'])
  })

  it('recognises its own closed lists and nothing else', () => {
    expect(EXPORT_STATUSES.every(isExportStatus)).toBe(true)
    expect(EXPORT_FAILURE_CODES.every(isExportFailureCode)).toBe(true)
    expect(EXPORT_STALE_REASONS.every(isExportStaleReason)).toBe(true)
    for (const check of [isExportStatus, isExportFailureCode, isExportStaleReason]) {
      expect(check('nope')).toBe(false)
      expect(check(3)).toBe(false)
      expect(check(null)).toBe(false)
    }
  })
})
