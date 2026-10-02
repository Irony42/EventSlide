import { describe, expect, it } from 'vitest'
import { AUDIT_SUBJECT_TYPES, isAuditSubjectType } from './auditSubjectType'

describe('isAuditSubjectType', () => {
  it.each(AUDIT_SUBJECT_TYPES)(
    'accepts %s, one of the seven the audit_log CHECK admits',
    (type) => {
      expect(isAuditSubjectType(type)).toBe(true)
    },
  )

  it('includes access_request from day one, because widening a CHECK means rebuilding the table', () => {
    expect(AUDIT_SUBJECT_TYPES).toContain('access_request')
  })

  it('includes photo, which the moderation log of roadmap 5.4 shares this storage for', () => {
    expect(AUDIT_SUBJECT_TYPES).toContain('photo')
  })

  it('refuses a word the log has no subject for', () => {
    expect(isAuditSubjectType('guest')).toBe(false)
  })

  it('refuses a non-string, which is what a stored row or a JSON body can hand over', () => {
    expect(isAuditSubjectType(7)).toBe(false)
  })
})
