import { describe, expect, it } from 'vitest'
import { asAccountTokenId, asClientId, asUserId } from '../shared/ids'
import { EmailAddress } from '../users/emailAddress'
import {
  SIGNUP_CLIENT_NAME_MAX,
  SIGNUP_NOTE_MAX,
  SIGNUP_STATUSES,
  claimSignupRequest,
  confirmSignupRequest,
  confirmationOutcome,
  createSignupRequest,
  expireSignupRequest,
  finalizeSignupRequest,
  isSignupStatus,
  signupConfirmationNext,
  signupListedAt,
  refuseSignupRequest,
  releaseSignupRequest,
  type SignupFormInput,
  type SignupRequest,
  type SignupStatus,
} from './signupRequest'

const NOW = new Date('2026-12-01T12:00:00.000Z')
const LATER = new Date('2026-12-02T12:00:00.000Z')

const email = (() => {
  const parsed = EmailAddress.create('camille@example.test')
  if (!parsed.ok) throw new Error('invalid fixture')
  return parsed.value
})()

const form = (over: Partial<SignupFormInput> = {}): SignupFormInput => ({
  id: 'req-1',
  email,
  clientName: 'Mariage de Léa et Hugo',
  locale: 'fr',
  ...over,
})

const fresh = (): SignupRequest => {
  const made = createSignupRequest(form(), NOW)
  if (!made.ok) throw new Error('invalid fixture')
  return made.value
}

const inStatus = (status: SignupStatus): SignupRequest => ({ ...fresh(), status })

const code = (result: { ok: boolean; error?: { code: string } }): string | null =>
  result.ok ? null : (result.error?.code ?? null)

describe('createSignupRequest', () => {
  it('makes an unconfirmed request with nothing decided and no client', () => {
    const made = createSignupRequest(form({ note: 'Un mariage', eventDate: '2027-06-12' }), NOW)

    expect(made.ok && made.value).toMatchObject({
      id: 'req-1',
      status: 'unconfirmed',
      note: 'Un mariage',
      eventDate: '2027-06-12',
      locale: 'fr',
      createdAt: NOW,
      confirmedAt: null,
      decidedAt: null,
      decidedBy: null,
      clientId: null,
      invitationTokenId: null,
    })
    expect(made.ok && made.value.clientName.value).toBe('Mariage de Léa et Hugo')
  })

  describe('the space name', () => {
    it('is folded to one line', () => {
      const made = createSignupRequest(form({ clientName: ' Les   Pieds\nAgiles ' }), NOW)
      expect(made.ok && made.value.clientName.value).toBe('Les Pieds Agiles')
    })

    it('refuses an empty one and a non-string', () => {
      expect(code(createSignupRequest(form({ clientName: '  ' }), NOW))).toBe('clientName.empty')
      expect(code(createSignupRequest(form({ clientName: 7 }), NOW))).toBe('clientName.invalid')
    })

    it('accepts 80 characters and refuses 81, counting code points', () => {
      const ok80 = createSignupRequest(
        form({ clientName: 'é'.repeat(SIGNUP_CLIENT_NAME_MAX) }),
        NOW,
      )
      const bad = createSignupRequest(
        form({ clientName: '😀'.repeat(SIGNUP_CLIENT_NAME_MAX + 1) }),
        NOW,
      )
      expect(ok80.ok).toBe(true)
      expect(code(bad)).toBe('signup.clientName.tooLong')
    })
  })

  describe('the note', () => {
    it('is optional: absent, null and blank all become null', () => {
      for (const note of [undefined, null, '   ']) {
        const made = createSignupRequest(form({ note }), NOW)
        expect(made.ok && made.value.note).toBeNull()
      }
    })

    it('is folded to one line', () => {
      const made = createSignupRequest(form({ note: 'a\nb' }), NOW)
      expect(made.ok && made.value.note).toBe('a b')
    })

    it('accepts 300 characters and refuses 301', () => {
      expect(createSignupRequest(form({ note: 'x'.repeat(SIGNUP_NOTE_MAX) }), NOW).ok).toBe(true)
      expect(code(createSignupRequest(form({ note: 'x'.repeat(SIGNUP_NOTE_MAX + 1) }), NOW))).toBe(
        'signup.note.tooLong',
      )
    })

    it('refuses a non-string', () => {
      expect(code(createSignupRequest(form({ note: 4 }), NOW))).toBe('signup.note.invalid')
    })
  })

  describe('the event date', () => {
    it('is optional: absent, null and empty become null', () => {
      for (const eventDate of [undefined, null, '']) {
        const made = createSignupRequest(form({ eventDate }), NOW)
        expect(made.ok && made.value.eventDate).toBeNull()
      }
    })

    it('refuses what is not a calendar day', () => {
      for (const eventDate of ['2027-02-30', 'demain', 20270101]) {
        expect(code(createSignupRequest(form({ eventDate }), NOW))).toBe('signup.eventDate.invalid')
      }
    })

    it('accepts yesterday and refuses the day before', () => {
      expect(createSignupRequest(form({ eventDate: '2026-11-30' }), NOW).ok).toBe(true)
      expect(code(createSignupRequest(form({ eventDate: '2026-11-29' }), NOW))).toBe(
        'signup.eventDate.outOfRange',
      )
    })

    it('accepts the same day two years ahead and refuses the next', () => {
      expect(createSignupRequest(form({ eventDate: '2028-12-01' }), NOW).ok).toBe(true)
      expect(code(createSignupRequest(form({ eventDate: '2028-12-02' }), NOW))).toBe(
        'signup.eventDate.outOfRange',
      )
    })
  })

  it('refuses a language the product does not speak', () => {
    expect(code(createSignupRequest(form({ locale: 'pt' }), NOW))).toBe('signup.locale.invalid')
    expect(code(createSignupRequest(form({ locale: undefined }), NOW))).toBe(
      'signup.locale.invalid',
    )
  })
})

describe('isSignupStatus', () => {
  it.each(SIGNUP_STATUSES)('recognises %s', (status) => {
    expect(isSignupStatus(status)).toBe(true)
  })

  it('refuses anything else', () => {
    expect(isSignupStatus('done')).toBe(false)
    expect(isSignupStatus(null)).toBe(false)
  })
})

describe('confirmationOutcome', () => {
  it('goes straight to the claim only in open with the disk guard satisfied', () => {
    expect(confirmationOutcome('open', true)).toBe('approving')
  })

  it('waits for an operator when the disk guard holds the request back', () => {
    expect(confirmationOutcome('open', false)).toBe('pending')
  })

  it('always waits for an operator in review, guard or no guard', () => {
    expect(confirmationOutcome('review', true)).toBe('pending')
    expect(confirmationOutcome('review', false)).toBe('pending')
  })
})

describe('transitions', () => {
  const ALL = SIGNUP_STATUSES
  const approval = {
    decidedBy: asUserId('op-1'),
    clientId: asClientId('c-1'),
    invitationTokenId: asAccountTokenId('t-1'),
  }

  const allowed = (
    from: readonly SignupStatus[],
    run: (request: SignupRequest) => { ok: boolean },
  ): void => {
    for (const status of ALL) {
      expect(run(inStatus(status)).ok, `from ${status}`).toBe(from.includes(status))
    }
  }

  it('confirms only an unconfirmed request, and stamps when', () => {
    allowed(['unconfirmed'], (r) => confirmSignupRequest(r, LATER, 'pending'))
    const pending = confirmSignupRequest(fresh(), LATER, 'pending')
    const approving = confirmSignupRequest(fresh(), LATER, 'approving')
    expect(pending.ok && pending.value).toMatchObject({ status: 'pending', confirmedAt: LATER })
    expect(approving.ok && approving.value).toMatchObject({
      status: 'approving',
      claimedAt: LATER,
    })
    expect(pending.ok && pending.value.claimedAt).toBeNull()
  })

  it('claims only a pending request', () => {
    allowed(['pending'], (r) => claimSignupRequest(r, LATER))
    const claimed = claimSignupRequest(inStatus('pending'), LATER)
    expect(claimed.ok && claimed.value).toMatchObject({ status: 'approving', claimedAt: LATER })
  })

  it('releases only a claim, back to pending', () => {
    allowed(['approving'], releaseSignupRequest)
    const released = releaseSignupRequest({ ...inStatus('approving'), claimedAt: NOW })
    expect(released.ok && released.value).toMatchObject({ status: 'pending', claimedAt: null })
  })

  it('finalises only a claim, recording the client, the invitation and who decided', () => {
    allowed(['approving'], (r) => finalizeSignupRequest(r, LATER, approval))
    const done = finalizeSignupRequest(
      { ...inStatus('approving'), claimedAt: NOW },
      LATER,
      approval,
    )
    expect(done.ok && done.value).toMatchObject({
      status: 'approved',
      claimedAt: null,
      decidedAt: LATER,
      decidedBy: 'op-1',
      clientId: 'c-1',
      invitationTokenId: 't-1',
    })
  })

  it('lets the system finalise: no operator, no invitation id yet', () => {
    const done = finalizeSignupRequest(inStatus('approving'), LATER, {
      decidedBy: null,
      clientId: asClientId('c-1'),
      invitationTokenId: null,
    })
    expect(done.ok && done.value).toMatchObject({ decidedBy: null, invitationTokenId: null })
  })

  it('refuses only a pending request, and keeps no reason', () => {
    allowed(['pending'], (r) => refuseSignupRequest(r, LATER, asUserId('op-1')))
    const refused = refuseSignupRequest(inStatus('pending'), LATER, asUserId('op-1'))
    expect(refused.ok && refused.value).toMatchObject({
      status: 'refused',
      decidedAt: LATER,
      decidedBy: 'op-1',
    })
  })

  it('expires only a pending request', () => {
    allowed(['pending'], (r) => expireSignupRequest(r, LATER))
    const expired = expireSignupRequest(inStatus('pending'), LATER)
    expect(expired.ok && expired.value).toMatchObject({ status: 'expired', decidedAt: LATER })
  })

  it('names the states of an illegal move, as a conflict', () => {
    const result = claimSignupRequest(inStatus('approved'), LATER)
    expect(!result.ok && result.error.kind).toBe('conflict')
    expect(!result.ok && result.error.code).toBe('signup.illegalTransition')
    expect(!result.ok && result.error.details).toEqual({ from: 'approved', to: 'approving' })
  })

  it('does not change the request it was given', () => {
    const request = inStatus('pending')
    claimSignupRequest(request, LATER)
    expect(request.status).toBe('pending')
  })
})

describe('signupConfirmationNext', () => {
  it('says review in review mode, whatever happened', () => {
    expect(signupConfirmationNext('review', 'pending')).toBe('review')
    expect(signupConfirmationNext('review', 'approving')).toBe('review')
  })

  it('says mail in open mode when the account is opening or opened', () => {
    expect(signupConfirmationNext('open', 'approving')).toBe('mail')
    expect(signupConfirmationNext('open', 'approved')).toBe('mail')
  })

  it('says held in open mode when the request is back in the queue', () => {
    expect(signupConfirmationNext('open', 'pending')).toBe('held')
  })

  it('agrees with confirmationOutcome: a guard that fails is held, one that passes is mail', () => {
    expect(signupConfirmationNext('open', confirmationOutcome('open', false))).toBe('held')
    expect(signupConfirmationNext('open', confirmationOutcome('open', true))).toBe('mail')
  })
})

describe('signupListedAt', () => {
  it('is the confirmation, or the creation while there is none', () => {
    expect(signupListedAt(fresh())).toEqual(NOW)
    expect(signupListedAt({ ...fresh(), confirmedAt: LATER })).toEqual(LATER)
  })
})
