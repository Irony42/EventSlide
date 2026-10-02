import { describe, expect, it } from 'vitest'
import { ClientCeilings } from '../clients/clientCeilings'
import { AUDIT_ACTIONS, isAuditAction, type AuditAction } from './auditAction'
import { isAuditSubjectType } from './auditSubjectType'
import type { DetailFields, DetailKind } from './auditDetails'

const ACTIONS = Object.keys(AUDIT_ACTIONS) as AuditAction[]

/** Every leaf kind a declaration uses, however deeply it is nested. */
const leafKinds = (kind: DetailKind): DetailKind['type'][] => {
  switch (kind.type) {
    case 'nullable':
      return leafKinds(kind.of)
    case 'object':
      return Object.values(kind.fields).flatMap(leafKinds)
    default:
      return [kind.type]
  }
}

/** Every key name a declaration uses, however deeply it is nested. */
const keyNames = (fields: DetailFields): string[] =>
  Object.entries(fields).flatMap(([key, kind]) => [key, ...keyNamesOfKind(kind)])

const keyNamesOfKind = (kind: DetailKind): string[] => {
  if (kind.type === 'nullable') return keyNamesOfKind(kind.of)
  if (kind.type === 'object') return keyNames(kind.fields)
  return []
}

describe('AUDIT_ACTIONS', () => {
  it('declares only subjects the audit_log CHECK admits', () => {
    for (const action of ACTIONS) {
      expect(isAuditSubjectType(AUDIT_ACTIONS[action].subject), action).toBe(true)
    }
  })

  it('names every action <subject>.<something>, so a reader can tell what it is about', () => {
    for (const action of ACTIONS) {
      expect(action.startsWith(`${AUDIT_ACTIONS[action].subject}.`), action).toBe(true)
    }
  })

  // ---------------------------------------------------- the content-free rule --

  it('declares no detail that can carry text a person typed: only numbers, switches and instants', () => {
    const allowed = new Set(['integer', 'boolean', 'instant'])

    for (const action of ACTIONS) {
      const kinds = Object.values(AUDIT_ACTIONS[action].details).flatMap(leafKinds)
      for (const kind of kinds) expect(allowed.has(kind), `${action}: ${kind}`).toBe(true)
    }
  })

  it('declares no detail named like content a person wrote: a caption, a name, an address, a slug, a token', () => {
    // A free-text note on a change (G2-18's `reason`) is the one planned exception, and
    // arriving here with its own kind and its own bound is the point at which this list is
    // widened on purpose. It is not a word to be slipped into an existing declaration.
    const content = [
      'caption',
      'photo',
      'content',
      'guestName',
      'displayName',
      'name',
      'email',
      'contactEmail',
      'slug',
      'token',
      'tokenDigest',
      'password',
      'filename',
      'text',
      'message',
    ]

    for (const action of ACTIONS) {
      const used = keyNames(AUDIT_ACTIONS[action].details).map((key) => key.toLowerCase())
      for (const word of content)
        expect(used, `${action}: ${word}`).not.toContain(word.toLowerCase())
    }
  })

  // --------------------------------------------------------- the ceilings snapshot --

  it('holds the ceilings snapshot to exactly the keys of ClientCeilings, so a tenth ceiling cannot go unaudited', () => {
    const declared = AUDIT_ACTIONS['client.ceilingsChanged'].details.before
    const ceilingKeys = Object.keys(ClientCeilings.unlimited().toProps()).sort()

    expect(declared.type).toBe('object')
    expect(declared.type === 'object' && Object.keys(declared.fields).sort()).toEqual(ceilingKeys)
  })

  it('declares the same snapshot before and after, so the two sides are always comparable', () => {
    for (const action of ACTIONS) {
      const details: DetailFields = AUDIT_ACTIONS[action].details
      expect(details['before'], action).toEqual(details['after'])
    }
  })
})

describe('isAuditAction', () => {
  it.each(ACTIONS)('accepts %s', (action) => {
    expect(isAuditAction(action)).toBe(true)
  })

  it('refuses an action nobody declared', () => {
    expect(isAuditAction('client.exploded')).toBe(false)
  })

  it('refuses a name that merely exists on every object, such as toString or __proto__', () => {
    expect(isAuditAction('toString')).toBe(false)
    expect(isAuditAction('__proto__')).toBe(false)
  })

  it('refuses a non-string', () => {
    expect(isAuditAction(undefined)).toBe(false)
  })
})
