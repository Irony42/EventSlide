import { describe, expect, it } from 'vitest'
import { fr } from '../../lib/i18n/fr'
import { aSiteAuditEntry, aSiteClient } from '../../testing/siteFixtures'
import { auditSentence, reasonOf, shortId, standingOf } from './siteLabels'

describe('a client’s standing', () => {
  it('is active when the server set neither a suspension nor a purge date', () => {
    expect(standingOf(aSiteClient())).toBe('active')
  })

  it('is suspended when the server set a suspension', () => {
    expect(standingOf(aSiteClient({ suspendedAt: '2026-06-21T10:00:00.000Z' }))).toBe('suspended')
  })

  it('is being wound down when there is a purge date, which outranks the suspension that came with it', () => {
    // An offboarded client is suspended as well, and reading "Suspended" would tell the operator
    // there is a freeze to lift, when what is happening is the end of an engagement.
    const client = aSiteClient({
      suspendedAt: '2026-06-21T10:00:00.000Z',
      purgeAfter: '2026-07-21T10:00:00.000Z',
    })

    expect(standingOf(client)).toBe('offboarding')
  })
})

describe('a line of the log, in words', () => {
  it('says what every action the server writes means', () => {
    const sentence = auditSentence(aSiteAuditEntry({ action: 'client.ceilingsChanged' }), fr)

    expect(sentence).toBe(fr.site.actions['client.ceilingsChanged'])
  })

  it('says an invitation is waiting for an owner when its details say so', () => {
    const entry = aSiteAuditEntry({
      action: 'invitation.issued',
      details: { pendingApproval: true },
    })

    expect(auditSentence(entry, fr)).toBe(fr.site.actionInvitationIssuedPending)
  })

  it('says an invitation was issued when it was not waiting', () => {
    const entry = aSiteAuditEntry({
      action: 'invitation.issued',
      details: { pendingApproval: false },
    })

    expect(auditSentence(entry, fr)).toBe(fr.site.actions['invitation.issued'])
  })

  it('says "an action was recorded" for a name this build does not know, rather than hiding the line', () => {
    expect(auditSentence(aSiteAuditEntry({ action: 'something.new' }), fr)).toBe(
      fr.site.actionOther,
    )
  })

  it('never resolves an action to something on the object prototype', () => {
    // The action is a string the server wrote. `constructor` is not a sentence.
    for (const action of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(auditSentence(aSiteAuditEntry({ action }), fr)).toBe(fr.site.actionOther)
    }
  })

  it('reads the operator’s reason when the line carries one, and nothing otherwise', () => {
    expect(reasonOf(aSiteAuditEntry({ details: { reason: 'Capacité' } }))).toBe('Capacité')
    expect(reasonOf(aSiteAuditEntry({ details: { reason: '' } }))).toBeNull()
    expect(reasonOf(aSiteAuditEntry({ details: { reason: 3 } }))).toBeNull()
    expect(reasonOf(aSiteAuditEntry())).toBeNull()
  })
})

describe('an id, shortened', () => {
  it('keeps the first eight characters, which tell two rows apart and name nobody', () => {
    expect(shortId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).toBe('aaaaaaaa')
  })
})
