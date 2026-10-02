import { describe, expect, it } from 'vitest'
import { asClientId, asUserId } from '../shared/ids'
import { AUDIT_ACTIONS, type AuditAction } from './auditAction'
import type { AuditDetailValue, AuditDetails, DetailKind } from './auditDetails'
import { AuditEntry, type NewAuditEntry } from './auditEntry'

const AT = new Date('2026-06-20T21:00:00.000Z')
const CLIENT = asClientId('client-1')

const CEILINGS = {
  maxEvents: 5,
  maxTotalBytes: null,
  maxEventQuotaBytes: null,
  maxRetentionDays: 90,
  clipsAllowed: true,
  liveAllowed: true,
  maxLiveDays: null,
  maxEventsPerPeriod: null,
  periodStartedAt: '2026-06-01T00:00:00.000Z',
}

const entryInput = (overrides: Partial<NewAuditEntry> = {}): NewAuditEntry => ({
  at: AT,
  actor: { kind: 'operator', userId: asUserId('user-op') },
  action: 'client.ceilingsChanged',
  subject: { type: 'client', id: 'client-1' },
  clientId: CLIENT,
  details: { before: CEILINGS, after: { ...CEILINGS, maxEvents: 6 } },
  ...overrides,
})

const codeOf = (input: NewAuditEntry): string | null => {
  const result = AuditEntry.create(input)
  return result.ok ? null : result.error.code
}

/** A value of every declared kind, so each action can be built without being written out. */
const sampleOf = (kind: DetailKind): AuditDetailValue => {
  switch (kind.type) {
    case 'integer':
      return 1
    case 'boolean':
      return true
    case 'instant':
      return '2026-06-20T21:00:00.000Z'
    case 'id':
      return 'id-1'
    case 'nullable':
      return sampleOf(kind.of)
    case 'object':
      return Object.fromEntries(
        Object.entries(kind.fields).map(([key, nested]) => [key, sampleOf(nested)]),
      )
  }
}

const sampleDetails = (action: AuditAction): AuditDetails =>
  sampleOf({ type: 'object', fields: AUDIT_ACTIONS[action].details }) as AuditDetails

const ACTIONS = Object.keys(AUDIT_ACTIONS) as AuditAction[]

describe('AuditEntry.create', () => {
  it('builds an entry carrying everything it was given', () => {
    const result = AuditEntry.create(entryInput())

    expect(result.ok && result.value.toProps()).toEqual({
      at: AT,
      actor: { kind: 'operator', userId: 'user-op', label: null },
      action: 'client.ceilingsChanged',
      subject: { type: 'client', id: 'client-1' },
      clientId: CLIENT,
      details: { before: CEILINGS, after: { ...CEILINGS, maxEvents: 6 } },
    })
  })

  it('keeps its own copy of the instant, so moving the caller’s date cannot move the entry', () => {
    const at = new Date(AT.getTime())

    const result = AuditEntry.create(entryInput({ at }))
    at.setUTCFullYear(1999)

    expect(result.ok && result.value.toProps().at.getTime()).toBe(AT.getTime())
  })

  it('keeps its own copy of the details, so editing them after the check cannot change what is recorded', () => {
    const details = { before: { ...CEILINGS }, after: { ...CEILINGS } }

    const result = AuditEntry.create(entryInput({ details }))
    details.after.maxEvents = 999_999

    expect(result.ok && result.value.toProps().details).toEqual({
      before: CEILINGS,
      after: CEILINGS,
    })
  })

  it('refuses an instant that is not a real date', () => {
    expect(codeOf(entryInput({ at: new Date(Number.NaN) }))).toBe('audit.atInvalid')
  })

  it('refuses a value that is not a date at all, such as one that arrived through a cast', () => {
    expect(codeOf(entryInput({ at: '2026-06-20' as unknown as Date }))).toBe('audit.atInvalid')
  })

  it('refuses an action nobody declared, so no entry exists without an allow-list for its details', () => {
    expect(codeOf(entryInput({ action: 'client.exploded' as unknown as AuditAction }))).toBe(
      'audit.actionUnknown',
    )
  })

  it('refuses an action about the wrong kind of subject', () => {
    expect(codeOf(entryInput({ subject: { type: 'event', id: 'client-1' } }))).toBe(
      'audit.subjectTypeMismatch',
    )
  })

  it('refuses a subject id that is an address or a sentence, because a subject is named by an id', () => {
    expect(
      codeOf(
        entryInput({ subject: { type: 'client', id: 'camille@example.com' }, clientId: CLIENT }),
      ),
    ).toBe('audit.subjectIdInvalid')
  })

  it('refuses an entry about a client that does not carry that client’s id, which would hide it from the client', () => {
    expect(codeOf(entryInput({ clientId: null }))).toBe('audit.clientIdMismatch')
    expect(codeOf(entryInput({ clientId: asClientId('client-2') }))).toBe('audit.clientIdMismatch')
  })

  it('refuses an actor that makes no sense, naming why', () => {
    expect(codeOf(entryInput({ actor: { kind: 'operator' } }))).toBe('audit.actorUserRequired')
  })

  it('refuses details outside the action’s allow-list, naming where and never what', () => {
    const result = AuditEntry.create(
      entryInput({ details: { before: CEILINGS, after: CEILINGS, caption: 'Une belle photo' } }),
    )

    expect(!result.ok && result.error.code).toBe('audit.detailsInvalid')
    expect(!result.ok && result.error.details).toEqual({
      path: 'caption',
      problem: 'unexpectedKey',
    })
  })
})

describe('what an audit entry may never carry (roadmap 10.8: no photo content, caption, guest name or token)', () => {
  // The names a leak actually arrives under. Not a deny-list the rule depends on, since the
  // allow-list refuses every undeclared key whatever it is called; these are the ones that
  // would be written by someone who did not know that.
  const FORBIDDEN_KEYS = [
    'caption',
    'photo',
    'photoContent',
    'content',
    'guestName',
    'displayName',
    'name',
    'email',
    'contactEmail',
    'slug',
    'token',
    'guestToken',
    'password',
    'filename',
    'note',
    'comment',
  ]

  it.each(ACTIONS)('builds %s from exactly its declared details', (action) => {
    const result = AuditEntry.create(
      entryInput({
        action,
        subject: { type: AUDIT_ACTIONS[action].subject, id: 'client-1' },
        details: sampleDetails(action),
      }),
    )

    expect(result.ok).toBe(true)
  })

  it.each(ACTIONS)(
    'refuses %s with any content key added, at the top level or inside a snapshot',
    (action) => {
      const base = sampleDetails(action)

      for (const key of FORBIDDEN_KEYS) {
        const atTop = { ...base, [key]: 'x' }
        const nested = Object.fromEntries(
          Object.entries(base).map(([side, snapshot]) => [
            side,
            { ...(snapshot as AuditDetails), [key]: 'x' },
          ]),
        )

        for (const details of [atTop, nested]) {
          const result = AuditEntry.create(
            entryInput({
              action,
              subject: { type: AUDIT_ACTIONS[action].subject, id: 'client-1' },
              details,
            }),
          )
          expect(!result.ok && result.error.code, `${action} + ${key}`).toBe('audit.detailsInvalid')
        }
      }
    },
  )

  it('refuses a declared key that holds text where a number is declared, so a caption cannot ride in a count', () => {
    const result = AuditEntry.create(
      entryInput({
        details: { before: CEILINGS, after: { ...CEILINGS, maxEvents: 'Camille & Sacha' } },
      }),
    )

    expect(!result.ok && result.error.details['path']).toBe('after.maxEvents')
  })

  it('refuses a declared instant that holds a guest’s name', () => {
    const result = AuditEntry.create(
      entryInput({
        details: { before: CEILINGS, after: { ...CEILINGS, periodStartedAt: 'Camille Dupont' } },
      }),
    )

    expect(!result.ok && result.error.details['path']).toBe('after.periodStartedAt')
  })
})
