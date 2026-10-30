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

  it('declares no detail that can carry text a person typed: only numbers, switches, instants and the name of a document', () => {
    // `termsVersion` is the one string kind: at most 32 characters of a fixed alphabet, written
    // from the box's configuration and never from a request (`auditDetails.ts` says why).
    const allowed = new Set(['integer', 'boolean', 'instant', 'termsVersion'])

    for (const action of ACTIONS) {
      const kinds = Object.values(AUDIT_ACTIONS[action].details).flatMap(leafKinds)
      for (const kind of kinds) {
        if (kind === 'reason') continue // the one exception, held by the test below
        expect(allowed.has(kind), `${action}: ${kind}`).toBe(true)
      }
    }
  })

  it('lets only the operator mandatory-reason acts carry the free-text reason, under the key reason', () => {
    // The decision of 2026-10-23: a change of ceilings carries a mandatory reason, and it is the
    // one field of the log a person types. The operator's "remove without viewing" levers (launch
    // review S5) are the second decision, made in the diff that edits this test: an act on content
    // the operator may not look at has to say why in the operator's own words. A further
    // declaration using the kind is a new decision, and not a key that rode along.
    const carrying = ACTIONS.filter((action) =>
      Object.values(AUDIT_ACTIONS[action].details).some((kind) =>
        leafKinds(kind).includes('reason'),
      ),
    )
    expect(carrying).toEqual([
      'client.ceilingsChanged',
      'photo.takenDown',
      'photo.restored',
      'event.takenDown',
      'event.restored',
      'event.purgeHeld',
      'event.purgeReleased',
    ])

    const details: DetailFields = AUDIT_ACTIONS['client.ceilingsChanged'].details
    expect(details['reason']).toEqual({ type: 'reason' })
    expect(Object.keys(details).filter((key) => details[key]?.type === 'reason')).toEqual([
      'reason',
    ])
  })

  it('declares no detail named like content a person wrote: a caption, a name, an address, a slug, a token', () => {
    // `reason` is not in this list because it is the one declared exception (G2-14), with its own
    // kind and its own bound, held by the test above; every other free-text name stays out.
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

  it('holds the snapshot of client.created to the same keys, so a client is never opened with a ceiling the log does not name', () => {
    const declared = AUDIT_ACTIONS['client.created'].details.ceilings
    const ceilingKeys = Object.keys(ClientCeilings.unlimited().toProps()).sort()

    expect(declared.type).toBe('object')
    expect(declared.type === 'object' && Object.keys(declared.fields).sort()).toEqual(ceilingKeys)
    expect(declared).toEqual(AUDIT_ACTIONS['client.ceilingsChanged'].details.before)
  })

  it('declares the same snapshot before and after, so the two sides are always comparable', () => {
    for (const action of ACTIONS) {
      const details: DetailFields = AUDIT_ACTIONS[action].details
      expect(details['before'], action).toEqual(details['after'])
    }
  })
})

describe('account.termsAccepted', () => {
  it('is about an account and says the version of the terms, and nothing else', () => {
    expect(AUDIT_ACTIONS['account.termsAccepted']).toEqual({
      subject: 'account',
      details: { version: { type: 'termsVersion' } },
    })
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
