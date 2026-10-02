import { describe, expect, it } from 'vitest'
import {
  AUDIT_RETENTION_DEFAULT_DAYS,
  AUDIT_RETENTION_MAX_DAYS,
  AUDIT_RETENTION_MIN_DAYS,
  auditRetentionCutoff,
  isValidAuditRetentionDays,
} from './auditRetention'

describe('isValidAuditRetentionDays', () => {
  it('has a floor of 365 days, the least the plan lets an operator keep a row for', () => {
    expect(AUDIT_RETENTION_MIN_DAYS).toBe(365)
    expect(isValidAuditRetentionDays(365)).toBe(true)
    expect(isValidAuditRetentionDays(364)).toBe(false)
  })

  it('defaults to three years, and the default is itself valid', () => {
    expect(AUDIT_RETENTION_DEFAULT_DAYS).toBe(1095)
    expect(isValidAuditRetentionDays(AUDIT_RETENTION_DEFAULT_DAYS)).toBe(true)
  })

  it('stops at ten years, so that now minus the retention is always a real date', () => {
    expect(isValidAuditRetentionDays(AUDIT_RETENTION_MAX_DAYS)).toBe(true)
    expect(isValidAuditRetentionDays(AUDIT_RETENTION_MAX_DAYS + 1)).toBe(false)
  })

  it('refuses a fractional or non-finite number of days', () => {
    expect(isValidAuditRetentionDays(400.5)).toBe(false)
    expect(isValidAuditRetentionDays(Number.NaN)).toBe(false)
    expect(isValidAuditRetentionDays(Number.POSITIVE_INFINITY)).toBe(false)
  })
})

describe('auditRetentionCutoff', () => {
  const NOW = new Date('2027-06-20T21:00:00.000Z')

  it('is the given number of whole days before the clock it was handed', () => {
    expect(auditRetentionCutoff(NOW, 365).toISOString()).toBe('2026-06-20T21:00:00.000Z')
  })

  it('does not move the date it was handed', () => {
    const before = NOW.getTime()

    auditRetentionCutoff(NOW, 365)

    expect(NOW.getTime()).toBe(before)
  })
})
