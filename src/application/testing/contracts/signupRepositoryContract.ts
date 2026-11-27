import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asAccountTokenId, asClientId, asUserId } from '../../../domain/shared/ids'
import {
  createSignupRequest,
  type SignupRequest,
  type SignupStatus,
} from '../../../domain/signups/signupRequest'
import { EmailAddress } from '../../../domain/users/emailAddress'
import type { AccountTokenRepository } from '../../ports/accountTokenRepository'
import type { SignupRepository } from '../../ports/signupRepository'
import { anAccountToken } from '../builders'

/**
 * The behaviour every `SignupRepository` must have, run against the fake **and** SQLite (spec 31).
 *
 * It states the **semantics of the conditional updates** rather than a race: `better-sqlite3` is
 * synchronous, so a test of two simultaneous callers would be empty. What is asserted is what that
 * guarantees: the second of two claims, finalisations or confirmations with one token finds the row
 * already moved. Also the admission (daily ceiling first, no write on a silent answer, one `unconfirmed`
 * request per address), the token spent with the request in one step, and the sweep applying the domain's
 * retention rules.
 *
 * Both subjects seed `CONTRACT_ACCOUNTS` and `CONTRACT_CLIENTS` (the foreign keys of `decided_by`,
 * `client_id` and the invitation token).
 */

export interface SignupRepositorySubject {
  readonly repo: SignupRepository
  /** The store the confirmation and invitation tokens live in: the same one `repo` writes to. */
  readonly tokens: AccountTokenRepository
  readonly dispose?: () => Promise<void>
}

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const T0 = new Date('2026-12-01T10:00:00.000Z')
const at = (ms: number): Date => new Date(T0.getTime() + ms)

const address = (value: string): EmailAddress => {
  const parsed = EmailAddress.create(value)
  if (!parsed.ok) throw new Error(`invalid fixture: ${value}`)
  return parsed.value
}

const request = (
  id: string,
  email = 'camille@example.test',
  now: Date = T0,
  clientName = 'Mariage de Léa et Hugo',
): SignupRequest => {
  const made = createSignupRequest(
    { id, email: address(email), clientName, locale: 'fr', note: 'un mariage' },
    now,
  )
  if (!made.ok) throw new Error('invalid fixture')
  return made.value
}

/** A confirmation token as `admit` is handed it: purpose `emailVerification`, no account. */
const confirmationToken = (id: string, email = 'camille@example.test', now: Date = T0) =>
  anAccountToken({ id, purpose: 'emailVerification', email, userId: null, createdAt: now })

const BIG = 1_000

export const signupRepositoryContract = (
  name: string,
  makeSubject: () => Promise<SignupRepositorySubject>,
): void => {
  describe(`SignupRepository contract: ${name}`, () => {
    let subject: SignupRepositorySubject
    let repo: SignupRepository
    let tokens: AccountTokenRepository
    let counter = 0

    beforeEach(async () => {
      subject = await makeSubject()
      repo = subject.repo
      tokens = subject.tokens
      counter = 0
    })

    afterEach(async () => {
      await subject.dispose?.()
    })

    const nextId = (): string => `r${(counter += 1)}`

    /** Admits a request with its token, at `now`, and returns the pieces. */
    const admit = async (email = 'camille@example.test', now: Date = T0, maxPerDay = BIG) => {
      const n = nextId()
      const made = request(`req-${n}`, email, now)
      const token = confirmationToken(`tok-${n}`, email, now)
      const result = await repo.admit({ request: made, token, now, maxPerDay })
      return { made, token, result }
    }

    const toPending = async (email = 'camille@example.test', now: Date = T0) => {
      const { made, token } = await admit(email, now)
      const confirmed = await repo.confirm({
        tokenDigest: token.tokenDigest,
        now: at(now.getTime() - T0.getTime() + 5 * 60 * 1000),
        outcome: 'pending',
      })
      expect(confirmed.kind).toBe('confirmed')
      return made.id
    }

    const status = async (id: string): Promise<SignupStatus | undefined> =>
      (await repo.findById(id))?.status

    describe('admit', () => {
      it('stores a new request unconfirmed, with its confirmation token, and counts it', async () => {
        const { made, token, result } = await admit()

        expect(result).toEqual({ outcome: 'created', issuedToday: 1 })
        const stored = await repo.findById(made.id)
        expect(stored).toMatchObject({
          status: 'unconfirmed',
          note: 'un mariage',
          confirmedAt: null,
          claimedAt: null,
          clientId: null,
        })
        expect(stored?.email.value).toBe('camille@example.test')
        expect(stored?.clientName.value).toBe('Mariage de Léa et Hugo')
        const held = await tokens.findUsable(token.tokenDigest, 'emailVerification', T0)
        expect(held?.userId).toBeNull()
        expect(held?.email.value).toBe('camille@example.test')
      })

      it('writes nothing and says silent while the address waits for the operator', async () => {
        await toPending()
        const before = await tokens.countCreatedSince(
          address('camille@example.test'),
          'emailVerification',
          at(-DAY),
        )

        const { made, result } = await admit('camille@example.test', at(2 * HOUR))

        expect(result.outcome).toBe('silent')
        expect(await repo.findById(made.id)).toBeNull()
        expect(
          await tokens.countCreatedSince(
            address('camille@example.test'),
            'emailVerification',
            at(-DAY),
          ),
        ).toBe(before)
      })

      it('stays silent for an unconfirmed request whose mail is less than an hour old', async () => {
        await admit()

        const second = await admit('camille@example.test', at(30 * 60 * 1000))

        expect(second.result.outcome).toBe('silent')
      })

      it('resends after more than an hour: new token, old links revoked, one request, new content', async () => {
        const first = await admit()

        const second = await admit('camille@example.test', at(2 * HOUR))

        expect(second.result.outcome).toBe('resent')
        expect(await repo.findById(second.made.id)).toBeNull()
        expect(
          await tokens.findUsable(first.token.tokenDigest, 'emailVerification', at(2 * HOUR)),
        ).toBeNull()
        expect(
          await tokens.findUsable(second.token.tokenDigest, 'emailVerification', at(2 * HOUR)),
        ).not.toBeNull()
        const kept = await repo.findById(first.made.id)
        expect(kept?.status).toBe('unconfirmed')
      })

      it('lets a resend replace what was typed', async () => {
        const first = await admit()
        const n = nextId()
        const corrected = request(`req-${n}`, 'camille@example.test', at(2 * HOUR), 'Noces de Léa')
        await repo.admit({
          request: corrected,
          token: confirmationToken(`tok-${n}`, 'camille@example.test', at(2 * HOUR)),
          now: at(2 * HOUR),
          maxPerDay: BIG,
        })

        expect((await repo.findById(first.made.id))?.clientName.value).toBe('Noces de Léa')
      })

      it('stops at three confirmation mails per address in 24 hours', async () => {
        expect((await admit('camille@example.test', at(0))).result.outcome).toBe('created')
        expect((await admit('camille@example.test', at(2 * HOUR))).result.outcome).toBe('resent')
        expect((await admit('camille@example.test', at(4 * HOUR))).result.outcome).toBe('resent')

        expect((await admit('camille@example.test', at(6 * HOUR))).result.outcome).toBe('silent')
        expect((await admit('camille@example.test', at(25 * HOUR))).result.outcome).toBe('resent')
      })

      it('answers busy at the box ceiling, for a new address and for a known one alike', async () => {
        await admit('a@example.test', T0, 2)
        await admit('b@example.test', T0, 2)

        const fresh = await admit('c@example.test', T0, 2)
        const known = await admit('a@example.test', at(2 * HOUR), 2)

        expect(fresh.result).toEqual({ outcome: 'busy', issuedToday: 2 })
        expect(known.result.outcome).toBe('busy')
        expect(await repo.findById(fresh.made.id)).toBeNull()
      })

      it('counts the ceiling over the last 24 hours only', async () => {
        await admit('a@example.test', T0, 1)

        const next = await admit('b@example.test', at(25 * HOUR), 1)

        expect(next.result.outcome).toBe('created')
      })

      it('stays silent for 30 days after a refusal, then lets the address ask again', async () => {
        const id = await toPending()
        expect(await repo.refuse(id, asUserId('user-1'), at(HOUR))).toBe(true)

        const soon = await admit('camille@example.test', at(HOUR + 29 * DAY))
        const later = await admit('camille@example.test', at(HOUR + 30 * DAY))

        expect(soon.result.outcome).toBe('silent')
        expect(later.result.outcome).toBe('created')
      })

      it('lets an approved address ask again (it may be a moderator wanting a space)', async () => {
        const id = await toPending()
        await repo.claim(id, at(HOUR))
        await repo.finalize(id, {
          decidedBy: asUserId('user-1'),
          clientId: asClientId('client-1'),
          invitationTokenId: null,
          now: at(HOUR),
        })

        expect((await admit('camille@example.test', at(2 * HOUR))).result.outcome).toBe('created')
      })

      it('holds at most one unconfirmed request per address, however often it is resent', async () => {
        await admit()
        await admit('camille@example.test', at(2 * HOUR))
        await admit('camille@example.test', at(4 * HOUR))

        // Three rows would be three erasures: the sweep counts what is really held.
        expect((await repo.sweep(at(60 * HOUR))).erased).toBe(1)
      })
    })

    describe('peekConfirmation', () => {
      it('is null for a digest no confirmation token has', async () => {
        expect(await repo.peekConfirmation('0'.repeat(64), T0)).toBeNull()
      })

      it('says usable for a live link with a request waiting', async () => {
        const { token } = await admit()

        const peek = await repo.peekConfirmation(token.tokenDigest, at(HOUR))

        expect(peek?.state).toBe('usable')
        expect(peek?.email.value).toBe('camille@example.test')
      })

      it('says expired after the day, spent once used or revoked', async () => {
        const first = await admit()
        expect((await repo.peekConfirmation(first.token.tokenDigest, at(25 * HOUR)))?.state).toBe(
          'expired',
        )

        const second = await admit('autre@example.test')
        await repo.confirm({
          tokenDigest: second.token.tokenDigest,
          now: at(HOUR),
          outcome: 'pending',
        })
        expect((await repo.peekConfirmation(second.token.tokenDigest, at(2 * HOUR)))?.state).toBe(
          'spent',
        )

        const third = await admit('revoked@example.test')
        await admit('revoked@example.test', at(2 * HOUR))
        expect((await repo.peekConfirmation(third.token.tokenDigest, at(3 * HOUR)))?.state).toBe(
          'spent',
        )
      })

      it('reads a live link with no request left as spent', async () => {
        const { token } = await admit()
        const extra = confirmationToken('tok-extra', 'camille@example.test', at(HOUR))
        await repo.confirm({ tokenDigest: token.tokenDigest, now: at(HOUR), outcome: 'pending' })
        await tokens.save(extra)

        expect((await repo.peekConfirmation(extra.tokenDigest, at(2 * HOUR)))?.state).toBe('spent')
      })
    })

    describe('confirm', () => {
      it('spends the token and moves the request to pending, together', async () => {
        const { made, token } = await admit()

        const result = await repo.confirm({
          tokenDigest: token.tokenDigest,
          now: at(HOUR),
          outcome: 'pending',
        })

        expect(result.kind === 'confirmed' && result.request).toMatchObject({
          id: made.id,
          status: 'pending',
          confirmedAt: at(HOUR),
          claimedAt: null,
        })
        expect(await status(made.id)).toBe('pending')
        expect(await tokens.findUsable(token.tokenDigest, 'emailVerification', at(HOUR))).toBeNull()
      })

      it('goes straight to the claim, stamped, when asked', async () => {
        const { made, token } = await admit()

        const result = await repo.confirm({
          tokenDigest: token.tokenDigest,
          now: at(HOUR),
          outcome: 'approving',
        })

        expect(result.kind).toBe('confirmed')
        expect(await repo.findById(made.id)).toMatchObject({
          status: 'approving',
          claimedAt: at(HOUR),
        })
        expect(await repo.countPending()).toBe(0)
      })

      it('lets one confirmation through when the same link is pressed twice', async () => {
        const { token } = await admit()
        const input = { tokenDigest: token.tokenDigest, now: at(HOUR), outcome: 'pending' } as const

        expect((await repo.confirm(input)).kind).toBe('confirmed')
        expect((await repo.confirm(input)).kind).toBe('invalid')
      })

      it('refuses an unknown digest, an expired link and a revoked one, changing nothing', async () => {
        const first = await admit()
        expect(
          (await repo.confirm({ tokenDigest: '1'.repeat(64), now: T0, outcome: 'pending' })).kind,
        ).toBe('invalid')
        expect(
          (
            await repo.confirm({
              tokenDigest: first.token.tokenDigest,
              now: at(DAY),
              outcome: 'pending',
            })
          ).kind,
        ).toBe('invalid')
        expect(await status(first.made.id)).toBe('unconfirmed')

        const second = await admit('autre@example.test')
        await admit('autre@example.test', at(2 * HOUR))
        expect(
          (
            await repo.confirm({
              tokenDigest: second.token.tokenDigest,
              now: at(3 * HOUR),
              outcome: 'pending',
            })
          ).kind,
        ).toBe('invalid')
        expect(await status(second.made.id)).toBe('unconfirmed')
      })

      it('does not spend a live token whose address has no unconfirmed request', async () => {
        const { token } = await admit()
        await repo.confirm({ tokenDigest: token.tokenDigest, now: at(HOUR), outcome: 'pending' })
        const extra = confirmationToken('tok-extra', 'camille@example.test', at(HOUR))
        await tokens.save(extra)

        const result = await repo.confirm({
          tokenDigest: extra.tokenDigest,
          now: at(2 * HOUR),
          outcome: 'pending',
        })

        expect(result.kind).toBe('invalid')
        expect(
          await tokens.findUsable(extra.tokenDigest, 'emailVerification', at(2 * HOUR)),
        ).not.toBeNull()
      })
    })

    describe('claim, release, finalize and refuse', () => {
      const finalization = (
        invitationTokenId: ReturnType<typeof asAccountTokenId> | null = null,
      ) => ({
        decidedBy: asUserId('user-1'),
        clientId: asClientId('client-1'),
        invitationTokenId,
        now: at(2 * HOUR),
      })

      it('lets exactly one claim win', async () => {
        const id = await toPending()

        expect(await repo.claim(id, at(HOUR))).toBe(true)
        expect(await repo.claim(id, at(HOUR))).toBe(false)
        expect(await repo.findById(id)).toMatchObject({ status: 'approving', claimedAt: at(HOUR) })
      })

      it('refuses to claim what is not pending, or does not exist', async () => {
        const { made } = await admit('autre@example.test')

        expect(await repo.claim(made.id, T0)).toBe(false)
        expect(await repo.claim('nope', T0)).toBe(false)
      })

      it('gives a claim back to pending, once, clearing its stamp', async () => {
        const id = await toPending()
        await repo.claim(id, at(HOUR))

        expect(await repo.release(id)).toBe(true)
        expect(await repo.release(id)).toBe(false)
        expect(await repo.findById(id)).toMatchObject({ status: 'pending', claimedAt: null })
        expect(await repo.claim(id, at(2 * HOUR))).toBe(true)
      })

      it('finalizes only a claim, once, recording client, invitation and decider', async () => {
        const id = await toPending()
        expect(await repo.finalize(id, finalization())).toBe(false)
        await repo.claim(id, at(HOUR))
        const invitation = anAccountToken({
          id: 'inv-1',
          purpose: 'invitation',
          email: 'camille@example.test',
          userId: null,
          clientId: 'client-1',
          clientRole: 'owner',
        })
        await tokens.save(invitation)

        expect(await repo.finalize(id, finalization(invitation.id))).toBe(true)
        expect(await repo.finalize(id, finalization(invitation.id))).toBe(false)
        expect(await repo.findById(id)).toMatchObject({
          status: 'approved',
          claimedAt: null,
          decidedAt: at(2 * HOUR),
          decidedBy: 'user-1',
          clientId: 'client-1',
          invitationTokenId: 'inv-1',
        })
      })

      it('lets the system finalize, with no operator', async () => {
        const id = await toPending()
        await repo.claim(id, at(HOUR))

        expect(await repo.finalize(id, { ...finalization(), decidedBy: null })).toBe(true)
        expect((await repo.findById(id))?.decidedBy).toBeNull()
      })

      it('refuses a client, an operator or an invitation that does not exist', async () => {
        const id = await toPending()
        await repo.claim(id, at(HOUR))

        await expect(
          repo.finalize(id, { ...finalization(), clientId: asClientId('client-missing') }),
        ).rejects.toThrow()
        await expect(
          repo.finalize(id, { ...finalization(), decidedBy: asUserId('user-missing') }),
        ).rejects.toThrow()
        await expect(
          repo.finalize(id, {
            ...finalization(),
            invitationTokenId: asAccountTokenId('inv-missing'),
          }),
        ).rejects.toThrow()
        expect(await status(id)).toBe('approving')
      })

      it('refuses only a pending request, once, keeping no reason', async () => {
        const id = await toPending()

        expect(await repo.refuse(id, asUserId('user-1'), at(HOUR))).toBe(true)
        expect(await repo.refuse(id, asUserId('user-1'), at(HOUR))).toBe(false)
        expect(await repo.findById(id)).toMatchObject({
          status: 'refused',
          decidedAt: at(HOUR),
          decidedBy: 'user-1',
        })
      })

      it('does not refuse a claim in flight', async () => {
        const id = await toPending()
        await repo.claim(id, at(HOUR))

        expect(await repo.refuse(id, asUserId('user-1'), at(HOUR))).toBe(false)
        await expect(repo.refuse('nope', asUserId('user-missing'), at(HOUR))).resolves.toBe(false)
      })

      it('refuses with an operator that does not exist', async () => {
        const id = await toPending()

        await expect(repo.refuse(id, asUserId('user-missing'), at(HOUR))).rejects.toThrow()
        expect(await status(id)).toBe('pending')
      })
    })

    describe('listForOperator and countPending', () => {
      it('never lists an unconfirmed request, whatever is asked', async () => {
        await admit('unproven@example.test')
        await toPending('proven@example.test')

        const listed = await repo.listForOperator({
          statuses: ['unconfirmed', 'pending'],
          limit: 10,
        })

        expect(listed.map((row) => row.email.value)).toEqual(['proven@example.test'])
        expect(await repo.listForOperator({ statuses: ['unconfirmed'], limit: 10 })).toEqual([])
        expect(await repo.listForOperator({ statuses: [], limit: 10 })).toEqual([])
      })

      it('lists the asked states, newest confirmation first, up to the limit', async () => {
        const first = await toPending('a@example.test', at(0))
        const second = await toPending('b@example.test', at(HOUR))
        const third = await toPending('c@example.test', at(2 * HOUR))
        await repo.refuse(first, asUserId('user-1'), at(3 * HOUR))

        const pending = await repo.listForOperator({ statuses: ['pending'], limit: 10 })
        const limited = await repo.listForOperator({ statuses: ['pending', 'refused'], limit: 2 })

        expect(pending.map((row) => row.id)).toEqual([third, second])
        expect(limited.map((row) => row.id)).toEqual([third, second])
        expect(await repo.countPending()).toBe(2)
      })

      it('keeps only what was decided or made since the given instant', async () => {
        const old = await toPending('old@example.test', at(0))
        const recent = await toPending('new@example.test', at(10 * DAY))

        const listed = await repo.listForOperator({
          statuses: ['pending'],
          since: at(5 * DAY),
          limit: 10,
        })

        expect(listed.map((row) => row.id)).toEqual([recent])
        expect(listed.map((row) => row.id)).not.toContain(old)
      })

      it('refuses a limit that is not a positive integer', async () => {
        await expect(repo.listForOperator({ statuses: ['pending'], limit: 0 })).rejects.toThrow(
          RangeError,
        )
      })
    })

    describe('sweep', () => {
      it('erases an unconfirmed request 48 hours after it was made, not before', async () => {
        const { made } = await admit()

        expect((await repo.sweep(at(48 * HOUR - 1))).erased).toBe(0)
        expect(await repo.findById(made.id)).not.toBeNull()
        expect(await repo.sweep(at(48 * HOUR))).toEqual({
          expiredIds: [],
          releasedIds: [],
          erased: 1,
        })
        expect(await repo.findById(made.id)).toBeNull()
      })

      it('expires a pending request 30 days after it was made, reports it, and erases it', async () => {
        const id = await toPending()

        expect((await repo.sweep(at(30 * DAY - 1))).erased).toBe(0)
        const swept = await repo.sweep(at(30 * DAY))

        expect(swept).toEqual({ expiredIds: [id], releasedIds: [], erased: 1 })
        expect(await repo.findById(id)).toBeNull()
      })

      it('erases a refused request 30 days after the refusal', async () => {
        const id = await toPending()
        await repo.refuse(id, asUserId('user-1'), at(DAY))

        expect((await repo.sweep(at(DAY + 30 * DAY - 1))).erased).toBe(0)
        expect((await repo.sweep(at(DAY + 30 * DAY))).erased).toBe(1)
        expect(await repo.findById(id)).toBeNull()
      })

      it('gives a claim older than an hour back to pending, without erasing it', async () => {
        const id = await toPending()
        await repo.claim(id, at(HOUR))

        expect(await repo.sweep(at(2 * HOUR - 1))).toEqual({
          expiredIds: [],
          releasedIds: [],
          erased: 0,
        })
        expect(await repo.sweep(at(2 * HOUR))).toEqual({
          expiredIds: [],
          releasedIds: [id],
          erased: 0,
        })
        expect(await repo.findById(id)).toMatchObject({ status: 'pending', claimedAt: null })
        expect(await repo.countPending()).toBe(1)
      })

      it('erases an approved request once its invitation was accepted, and not before', async () => {
        const id = await toPending()
        await repo.claim(id, at(HOUR))
        const invitation = anAccountToken({
          id: 'inv-2',
          purpose: 'invitation',
          email: 'camille@example.test',
          userId: null,
          clientId: 'client-1',
          clientRole: 'owner',
          createdAt: at(HOUR),
        })
        await tokens.save(invitation)
        await repo.finalize(id, {
          decidedBy: null,
          clientId: asClientId('client-1'),
          invitationTokenId: invitation.id,
          now: at(HOUR),
        })

        expect((await repo.sweep(at(2 * HOUR))).erased).toBe(0)
        await tokens.consume(invitation.id, at(3 * HOUR))
        expect((await repo.sweep(at(4 * HOUR))).erased).toBe(1)
        expect(await repo.findById(id)).toBeNull()
      })

      it('erases an approved request whose invitation was never taken 24 hours after it expired', async () => {
        const id = await toPending()
        await repo.claim(id, at(HOUR))
        await repo.finalize(id, {
          decidedBy: null,
          clientId: asClientId('client-1'),
          invitationTokenId: null,
          now: at(HOUR),
        })

        expect((await repo.sweep(at(HOUR + 8 * DAY - 1))).erased).toBe(0)
        expect((await repo.sweep(at(HOUR + 8 * DAY))).erased).toBe(1)
      })

      it('sweeps every row of a mixed table in one pass', async () => {
        const stale = await admit('stale@example.test', at(0))
        const waiting = await toPending('waiting@example.test', at(0))
        const fresh = await admit('fresh@example.test', at(47 * HOUR))

        const swept = await repo.sweep(at(49 * HOUR))

        expect(swept.erased).toBe(1)
        expect(await repo.findById(stale.made.id)).toBeNull()
        expect(await repo.findById(waiting)).not.toBeNull()
        expect(await repo.findById(fresh.made.id)).not.toBeNull()
      })
    })
  })
}
