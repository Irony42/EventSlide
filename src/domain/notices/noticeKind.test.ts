import { describe, expect, it } from 'vitest'
import { familyOf, isNoticeKind, MAIL_FAMILIES, NOTICE_KINDS } from './noticeKind'

describe('noticeKind', () => {
  it('knows every kind it lists and nothing else', () => {
    for (const kind of NOTICE_KINDS) expect(isNoticeKind(kind)).toBe(true)
    expect(isNoticeKind('rsvpDigest')).toBe(false)
    expect(isNoticeKind(3)).toBe(false)
    expect(isNoticeKind(null)).toBe(false)
  })

  it('leaves the warning before the replies are erased with no family: no switch turns it off', () => {
    expect(familyOf('rsvpErasure')).toBeNull()
  })

  it.each([
    ['rsvpDeadline', 'rsvp'],
    ['rsvpStopped', 'rsvp'],
    ['rsvpFull', 'rsvp'],
    ['eventClosed', 'event'],
    ['windowEnding', 'event'],
    ['jobDone', 'event'],
  ] as const)('puts %s in the %s family', (kind, family) => {
    expect(familyOf(kind)).toBe(family)
  })

  it('lists the three families', () => {
    expect([...MAIL_FAMILIES]).toEqual(['rsvp', 'event', 'announcement'])
  })
})
