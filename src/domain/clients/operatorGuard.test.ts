import { describe, expect, it } from 'vitest'
import {
  DEFAULT_OPERATOR_RESET_LINKS,
  OPERATOR_RESET_LINK_MODES,
  approvalVerdictFor,
  clientInvitationStillHonourable,
  isOperatorResetLinks,
  operatorInvitationNeedsApproval,
  operatorResetPlan,
} from './operatorGuard'

describe('R1: an operator invitation into a client that has events waits for an owner', () => {
  it('needs no approval while the client has no event, the case the operator handles alone', () => {
    expect(operatorInvitationNeedsApproval(0)).toBe(false)
  })

  it('needs approval from the first event, whatever its status', () => {
    expect(operatorInvitationNeedsApproval(1)).toBe(true)
    expect(operatorInvitationNeedsApproval(40)).toBe(true)
  })
})

describe('R1 again, when the invitation is spent: the client may have grown a first event since', () => {
  const base = { approved: false, writtenByOwnerOrSystem: false, clientEventCount: 0 }

  it('honours one nobody had to approve while the client still has no event', () => {
    expect(clientInvitationStillHonourable(base)).toBe(true)
  })

  it('stops honouring one nobody approved once the client has an event', () => {
    expect(clientInvitationStillHonourable({ ...base, clientEventCount: 1 })).toBe(false)
  })

  it('keeps honouring one an owner approved, however many events the client has', () => {
    expect(clientInvitationStillHonourable({ ...base, approved: true, clientEventCount: 9 })).toBe(
      true,
    )
  })

  it('keeps honouring one an owner or the system wrote, which R1 is not about', () => {
    expect(
      clientInvitationStillHonourable({
        ...base,
        writtenByOwnerOrSystem: true,
        clientEventCount: 9,
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

  it.each(OPERATOR_RESET_LINK_MODES)('accepts %s', (mode) => {
    expect(isOperatorResetLinks(mode)).toBe(true)
  })

  it.each(['', 'MAILONLY', 'copyLink', 'on', 'true', undefined, null, 1])(
    'refuses %j, which is never a guess at what was meant',
    (value) => {
      expect(isOperatorResetLinks(value)).toBe(false)
    },
  )
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
