import { describe, expect, it } from 'vitest'
import {
  DEFAULT_OPERATOR_RESET_LINKS,
  OPERATOR_RESET_LINK_MODES,
  approvalVerdictFor,
  clientInvitationStillHonourable,
  operatorInvitationNeedsApproval,
  operatorResetPlan,
} from './operatorGuard'

describe('R1: an operator invitation into a client with an event or a member waits for an owner', () => {
  const NOTHING = { eventCount: 0, memberCount: 0, otherLiveInvitationCount: 0 }

  it('needs no approval for a client that holds nothing, the case the operator handles alone', () => {
    expect(operatorInvitationNeedsApproval(NOTHING)).toBe(false)
  })

  it('needs approval from the first event, whatever its status', () => {
    expect(operatorInvitationNeedsApproval({ ...NOTHING, eventCount: 1 })).toBe(true)
    expect(operatorInvitationNeedsApproval({ ...NOTHING, eventCount: 40, memberCount: 3 })).toBe(
      true,
    )
  })

  it('needs approval from the first member, before there is any event to take', () => {
    expect(operatorInvitationNeedsApproval({ ...NOTHING, memberCount: 1 })).toBe(true)
  })

  it('needs approval as soon as another invitation into the client is waiting, so an empty client admits exactly one', () => {
    expect(operatorInvitationNeedsApproval({ ...NOTHING, otherLiveInvitationCount: 1 })).toBe(true)
    expect(operatorInvitationNeedsApproval({ ...NOTHING, otherLiveInvitationCount: 5 })).toBe(true)
  })
})

describe('R1 again, when the invitation is spent: the client may have grown a member or an event since', () => {
  const base = {
    approvedByAStandingOwner: false,
    writtenByAStandingOwner: false,
    eventCount: 0,
    memberCount: 0,
  }

  it('honours one nobody had to approve while the client still holds nothing', () => {
    expect(clientInvitationStillHonourable(base)).toBe(true)
  })

  it('stops honouring one nobody approved once the client has an event', () => {
    expect(clientInvitationStillHonourable({ ...base, eventCount: 1 })).toBe(false)
  })

  it('stops honouring one nobody approved once the client has a member', () => {
    expect(clientInvitationStillHonourable({ ...base, memberCount: 1 })).toBe(false)
  })

  it('keeps honouring one an owner who still stands approved, whatever the client holds', () => {
    expect(
      clientInvitationStillHonourable({
        ...base,
        approvedByAStandingOwner: true,
        eventCount: 9,
        memberCount: 4,
      }),
    ).toBe(true)
  })

  it('keeps honouring one an owner who still stands wrote, which R1 is not about', () => {
    expect(
      clientInvitationStillHonourable({
        ...base,
        writtenByAStandingOwner: true,
        eventCount: 9,
        memberCount: 4,
      }),
    ).toBe(true)
  })
})

describe('who may approve what waits for an owner', () => {
  it('lets an owner of the client who does not operate the box', () => {
    expect(approvalVerdictFor({ siteRole: 'none', clientRole: 'owner' })).toBe('ok')
  })

  it('answers a non-member like a stranger, an operator included', () => {
    expect(approvalVerdictFor({ siteRole: 'none', clientRole: null })).toBe('stranger')
    expect(approvalVerdictFor({ siteRole: 'operator', clientRole: null })).toBe('stranger')
  })

  it('refuses an operator even when the client made them an owner', () => {
    expect(approvalVerdictFor({ siteRole: 'operator', clientRole: 'owner' })).toBe('operator')
    expect(approvalVerdictFor({ siteRole: 'operator', clientRole: 'member' })).toBe('operator')
  })

  it('refuses a member who is not an owner', () => {
    expect(approvalVerdictFor({ siteRole: 'none', clientRole: 'member' })).toBe('notOwner')
  })
})

describe('OPERATOR_RESET_LINKS', () => {
  it('defaults to mailOnly, the posture in which no link is ever shown to an operator', () => {
    expect(DEFAULT_OPERATOR_RESET_LINKS).toBe('mailOnly')
  })

  it('has the two words the configuration names, and the default is the first', () => {
    expect(OPERATOR_RESET_LINK_MODES).toEqual(['mailOnly', 'copyLinkWithOwnerApproval'])
  })
})

describe('R2: what an operator-initiated reset does', () => {
  const approved = { ownerApproved: true }
  const waiting = { ownerApproved: false }

  it.each(OPERATOR_RESET_LINK_MODES)('mails the link in %s whenever the box can mail', (mode) => {
    expect(operatorResetPlan({ mode, mailerCanDeliver: true, ...waiting })).toBe('mail')
    expect(operatorResetPlan({ mode, mailerCanDeliver: true, ...approved })).toBe('mail')
  })

  it('refuses on a box with no relay under mailOnly, approval or none', () => {
    expect(operatorResetPlan({ mode: 'mailOnly', mailerCanDeliver: false, ...waiting })).toBe(
      'refused',
    )
    expect(operatorResetPlan({ mode: 'mailOnly', mailerCanDeliver: false, ...approved })).toBe(
      'refused',
    )
  })

  it('waits for an owner on a box with no relay under the opt-in', () => {
    expect(
      operatorResetPlan({
        mode: 'copyLinkWithOwnerApproval',
        mailerCanDeliver: false,
        ...waiting,
      }),
    ).toBe('needsApproval')
  })

  it('hands the operator a link only on a box with no relay, under the opt-in, once an owner approved', () => {
    expect(
      operatorResetPlan({
        mode: 'copyLinkWithOwnerApproval',
        mailerCanDeliver: false,
        ...approved,
      }),
    ).toBe('link')
  })
})
