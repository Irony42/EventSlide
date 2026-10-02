import { describe, expect, it } from 'vitest'
import { asUserId } from '../shared/ids'
import {
  AUDIT_ACTOR_KINDS,
  AUDIT_LABEL_MAX_LENGTH,
  isAuditActorKind,
  parseAuditActor,
  type AuditActorInput,
} from './auditActor'

const USER = asUserId('user-1')

const codeOf = (input: AuditActorInput): string | null => {
  const result = parseAuditActor(input)
  return result.ok ? null : result.error.code
}

describe('isAuditActorKind', () => {
  it.each(AUDIT_ACTOR_KINDS)('accepts %s, one of the four the actor_kind CHECK admits', (kind) => {
    expect(isAuditActorKind(kind)).toBe(true)
  })

  it('refuses a word the log has no actor for, and a non-string', () => {
    expect(isAuditActorKind('guest')).toBe(false)
    expect(isAuditActorKind(null)).toBe(false)
  })
})

describe('parseAuditActor', () => {
  it('reads an operator with the account that acted', () => {
    const result = parseAuditActor({ kind: 'operator', userId: USER })

    expect(result.ok && result.value).toEqual({ kind: 'operator', userId: USER, label: null })
  })

  it('reads a member the same way, so a client acting on its own account is attributed', () => {
    const result = parseAuditActor({ kind: 'member', userId: USER })

    expect(result.ok && result.value.kind).toBe('member')
  })

  it('reads the process itself as a system actor with no account', () => {
    const result = parseAuditActor({ kind: 'system', label: 'retention-sweeper' })

    expect(result.ok && result.value).toEqual({
      kind: 'system',
      userId: null,
      label: 'retention-sweeper',
    })
  })

  it('reads an integration with its label and no account', () => {
    const result = parseAuditActor({ kind: 'integration', label: 'cloud:stripe-webhook' })

    expect(result.ok && result.value.label).toBe('cloud:stripe-webhook')
  })

  it('refuses an operator with nobody behind it, because "an operator did this" must name one', () => {
    expect(codeOf({ kind: 'operator' })).toBe('audit.actorUserRequired')
    expect(codeOf({ kind: 'member', userId: null })).toBe('audit.actorUserRequired')
  })

  it('refuses a system or integration actor that names an account', () => {
    expect(codeOf({ kind: 'system', userId: USER })).toBe('audit.actorUserForbidden')
    expect(codeOf({ kind: 'integration', userId: USER, label: 'cloud:stripe-webhook' })).toBe(
      'audit.actorUserForbidden',
    )
  })

  it('refuses an integration with no label, which would leave nothing to say who it was', () => {
    expect(codeOf({ kind: 'integration' })).toBe('audit.actorLabelRequired')
  })

  it('refuses a label that could hold a name or an address', () => {
    expect(codeOf({ kind: 'system', label: 'Camille Dupont' })).toBe('audit.actorLabelInvalid')
    expect(codeOf({ kind: 'system', label: 'camille@example.com' })).toBe('audit.actorLabelInvalid')
  })

  it('accepts a label exactly at the length of the column CHECK and refuses one past it', () => {
    expect(codeOf({ kind: 'system', label: 'a'.repeat(AUDIT_LABEL_MAX_LENGTH) })).toBeNull()
    expect(codeOf({ kind: 'system', label: 'a'.repeat(AUDIT_LABEL_MAX_LENGTH + 1) })).toBe(
      'audit.actorLabelInvalid',
    )
  })

  it('refuses an empty label rather than storing a blank one', () => {
    expect(codeOf({ kind: 'system', label: '' })).toBe('audit.actorLabelInvalid')
  })

  it('refuses a kind that is not one of the four, such as one that arrived through a cast', () => {
    expect(codeOf({ kind: 'guest' as unknown as 'system' })).toBe('audit.actorKindInvalid')
  })
})
