import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asAccountTokenId, asClientId, asEventId, asUserId } from '../../../domain/shared/ids'
import { EmailAddress } from '../../../domain/users/emailAddress'
import type { AccountTokenRepository } from '../../ports/accountTokenRepository'
import { AT, anAccountToken, atPlus } from '../builders'

/**
 * The shared `AccountTokenRepository` contract, run against the in-memory fake and the
 * SQLite adapter.
 *
 * What has to behave the same in both is everything that decides whether a stranger's link
 * changes who can sign in: which tokens are *usable* (and that the answer is exclusive at the
 * expiry), that a token is spent **exactly once however many requests carry it**, that an
 * approval gates a spend, and that the housekeeping calls touch what they say and nothing
 * else. A fake that was kinder than the table about any of these would let every use-case
 * test above it pass against a product that was broken.
 *
 * The accounts, events and clients named here must exist before the suite runs — `user_id`,
 * `created_by`, `approved_by`, `event_id` and `client_id` are foreign keys in the real table,
 * and the fake mirrors them. Both subjects seed {@link CONTRACT_ACCOUNTS},
 * {@link CONTRACT_EVENTS} and {@link CONTRACT_CLIENTS}.
 */

export const CONTRACT_ACCOUNTS = ['user-1', 'user-2', 'user-approver'] as const
export const CONTRACT_EVENTS = ['event-1', 'event-2'] as const
export const CONTRACT_CLIENTS = ['client-1', 'client-2'] as const

const email = (value: string): EmailAddress => {
  const parsed = EmailAddress.create(value)
  if (!parsed.ok) throw new Error(`invalid fixture email: ${value}`)
  return parsed.value
}

const HOST = email('hote@example.test')
const OTHER = email('autre@example.test')

/** A spendable reset token whose lifetime is the domain's own: one hour from {@link AT}. */
const FRESH_UNTIL = atPlus(60 * 60 * 1000)

export const accountTokenRepositoryContract = (
  name: string,
  makeSubject: () => Promise<{ repo: AccountTokenRepository; dispose?: () => Promise<void> }>,
): void => {
  describe(`AccountTokenRepository contract: ${name}`, () => {
    let repo: AccountTokenRepository
    let dispose: (() => Promise<void>) | undefined

    beforeEach(async () => {
      const subject = await makeSubject()
      repo = subject.repo
      dispose = subject.dispose
    })

    afterEach(async () => {
      await dispose?.()
    })

    const digestOf = (id: string): string => anAccountToken({ id }).tokenDigest

    // ------------------------------------------------------------ save / read --

    it('stores a token and finds it again by digest with every field intact', async () => {
      const token = anAccountToken({
        id: 'tok-everything',
        purpose: 'invitation',
        email: 'nouveau@example.test',
        userId: null,
        eventId: 'event-1',
        eventRole: 'moderator',
        delivery: 'link',
        requiresApproval: true,
        createdBy: 'user-1',
        approvedBy: 'user-approver',
        approvedAt: atPlus(1_000),
      })
      await repo.save(token)

      const found = await repo.findUsable(token.tokenDigest, 'invitation', atPlus(2_000))

      expect(found).toEqual(token)
    })

    it('stores an invitation to a client with its role, and finds it again intact', async () => {
      const token = anAccountToken({
        id: 'tok-client',
        purpose: 'invitation',
        email: 'nouveau@example.test',
        userId: null,
        clientId: 'client-1',
        clientRole: 'owner',
        delivery: 'mail',
        createdBy: 'user-1',
      })
      await repo.save(token)

      expect(await repo.findUsable(token.tokenDigest, 'invitation', atPlus(1_000))).toEqual(token)
    })

    it('stores the same token with every optional field empty', async () => {
      const token = anAccountToken({ id: 'tok-plain', createdBy: null })
      await repo.save(token)

      expect(await repo.findUsable(token.tokenDigest, 'passwordReset', AT)).toEqual(token)
    })

    it('refuses a second token with the same id', async () => {
      await repo.save(anAccountToken({ id: 'tok-1' }))

      await expect(
        repo.save(anAccountToken({ id: 'tok-1', tokenDigest: 'b'.repeat(64) })),
      ).rejects.toThrow(/UNIQUE/)
    })

    it('refuses a second token with the same digest, so a digest names one link', async () => {
      await repo.save(anAccountToken({ id: 'tok-1' }))

      await expect(
        repo.save(anAccountToken({ id: 'tok-2', tokenDigest: digestOf('tok-1') })),
      ).rejects.toThrow(/UNIQUE/)
    })

    it.each([
      ['the token itself, in base64url', 'AbCdEf-raw-token_in_base64url'],
      ['a digest in upper case', 'A'.repeat(64)],
      ['a digest that is one character short', 'a'.repeat(63)],
      ['an empty digest', ''],
    ])('refuses %s in place of a digest', async (_label, tokenDigest) => {
      // Built around the domain, which would refuse these first: the point is the table.
      const bad = { ...anAccountToken({ id: 'tok-1' }), tokenDigest }

      await expect(repo.save(bad)).rejects.toThrow(/CHECK/)
    })

    it('refuses a token for an account that does not exist', async () => {
      await expect(
        repo.save(anAccountToken({ id: 'tok-1', userId: 'user-nobody' })),
      ).rejects.toThrow(/FOREIGN KEY/)
    })

    it('refuses an invitation to an event that does not exist', async () => {
      await expect(
        repo.save(
          anAccountToken({
            id: 'tok-1',
            purpose: 'invitation',
            userId: null,
            eventId: 'event-nobody',
            eventRole: 'moderator',
          }),
        ),
      ).rejects.toThrow(/FOREIGN KEY/)
    })

    it('refuses an invitation to a client that does not exist', async () => {
      await expect(
        repo.save(
          anAccountToken({
            id: 'tok-1',
            purpose: 'invitation',
            userId: null,
            clientId: 'client-nobody',
            clientRole: 'owner',
          }),
        ),
      ).rejects.toThrow(/FOREIGN KEY/)
    })

    // ------------------------------------------------------------- findUsable --

    describe('findUsable', () => {
      it('finds nothing for a digest it never stored', async () => {
        await repo.save(anAccountToken({ id: 'tok-1' }))

        expect(await repo.findUsable('c'.repeat(64), 'passwordReset', AT)).toBeNull()
      })

      it('finds nothing when the token was issued for another purpose', async () => {
        const token = anAccountToken({ id: 'tok-1', purpose: 'passwordReset' })
        await repo.save(token)

        expect(await repo.findUsable(token.tokenDigest, 'invitation', AT)).toBeNull()
        expect(await repo.findUsable(token.tokenDigest, 'emailVerification', AT)).toBeNull()
      })

      it('finds a token up to the last millisecond before it expires', async () => {
        const token = anAccountToken({ id: 'tok-1' })
        await repo.save(token)

        const found = await repo.findUsable(
          token.tokenDigest,
          'passwordReset',
          new Date(FRESH_UNTIL.getTime() - 1),
        )

        expect(found?.id).toBe(token.id)
      })

      it('finds nothing at the instant it expires, which is exclusive', async () => {
        const token = anAccountToken({ id: 'tok-1' })
        await repo.save(token)

        expect(await repo.findUsable(token.tokenDigest, 'passwordReset', FRESH_UNTIL)).toBeNull()
      })

      it('finds nothing for a token that was spent', async () => {
        const token = anAccountToken({ id: 'tok-1' })
        await repo.save(token)
        await repo.consume(token.id, atPlus(1_000))

        expect(await repo.findUsable(token.tokenDigest, 'passwordReset', atPlus(2_000))).toBeNull()
      })

      it('finds nothing for a token that was revoked', async () => {
        const token = anAccountToken({ id: 'tok-1' })
        await repo.save(token)
        await repo.revokeOutstanding(HOST, 'passwordReset', atPlus(1_000))

        expect(await repo.findUsable(token.tokenDigest, 'passwordReset', atPlus(2_000))).toBeNull()
      })

      it('finds nothing for a token still waiting for approval, and finds it once approved', async () => {
        const token = anAccountToken({ id: 'tok-1', requiresApproval: true, createdBy: 'user-1' })
        await repo.save(token)

        expect(await repo.findUsable(token.tokenDigest, 'passwordReset', atPlus(1_000))).toBeNull()

        await repo.approve(token.id, asUserId('user-approver'), atPlus(2_000))

        expect((await repo.findUsable(token.tokenDigest, 'passwordReset', atPlus(3_000)))?.id).toBe(
          token.id,
        )
      })
    })

    // --------------------------------------------------------------- findById --

    describe('findById', () => {
      it('finds a token by its id with every field intact', async () => {
        const token = anAccountToken({
          id: 'tok-1',
          purpose: 'invitation',
          email: 'nouveau@example.test',
          userId: null,
          clientId: 'client-1',
          clientRole: 'owner',
          requiresApproval: true,
          createdBy: 'user-1',
        })
        await repo.save(token)

        expect(await repo.findById(token.id)).toEqual(token)
      })

      it('finds a token that can no longer be spent, which is what findUsable never does', async () => {
        const spent = anAccountToken({ id: 'tok-spent' })
        const revoked = anAccountToken({ id: 'tok-revoked' })
        const waiting = anAccountToken({ id: 'tok-waiting', requiresApproval: true })
        await repo.save(spent)
        await repo.save(revoked)
        await repo.save(waiting)
        await repo.consume(spent.id, atPlus(1_000))
        await repo.revokeOutstanding(HOST, 'passwordReset', atPlus(1_000))

        expect((await repo.findById(spent.id))?.consumedAt).toEqual(atPlus(1_000))
        expect((await repo.findById(revoked.id))?.revokedAt).toEqual(atPlus(1_000))
        expect((await repo.findById(waiting.id))?.approvedAt).toBeNull()
      })

      it('finds nothing for an id it never stored', async () => {
        expect(await repo.findById(asAccountTokenId('nobody'))).toBeNull()
      })
    })

    // ------------------------------------------------ countLiveClientInvitations --

    describe('countLiveClientInvitations', () => {
      const live = (id: string, over: Parameters<typeof anAccountToken>[0] = {}) =>
        anAccountToken({
          id,
          purpose: 'invitation',
          email: 'nouveau@example.test',
          userId: null,
          eventId: null,
          eventRole: null,
          clientId: 'client-1',
          clientRole: 'owner',
          delivery: 'link',
          createdBy: 'user-1',
          ...over,
        })

      const countFor = async (clientId: string, except: string, now = atPlus(1_000)) =>
        repo.countLiveClientInvitations(asClientId(clientId), now, email(except))

      it('counts the invitations into the client that could still be accepted, written to another address', async () => {
        await repo.save(live('tok-a', { email: 'a@example.test' }))
        await repo.save(live('tok-b', { email: 'b@example.test' }))

        expect(await countFor('client-1', 'c@example.test')).toBe(2)
      })

      it('leaves out the address it is told to, which is the one being re-sent its own link', async () => {
        await repo.save(live('tok-a', { email: 'a@example.test' }))
        await repo.save(live('tok-b', { email: 'b@example.test' }))

        expect(await countFor('client-1', 'a@example.test')).toBe(1)
      })

      it('counts an invitation that waits for an approval and one that does not', async () => {
        await repo.save(live('tok-free', { email: 'a@example.test' }))
        await repo.save(live('tok-waiting', { email: 'b@example.test', requiresApproval: true }))

        expect(await countFor('client-1', 'c@example.test')).toBe(2)
      })

      it('never counts another client’s invitation, an event’s or a reset', async () => {
        await repo.save(live('tok-mine', { email: 'a@example.test' }))
        await repo.save(live('tok-theirs', { email: 'b@example.test', clientId: 'client-2' }))
        await repo.save(
          anAccountToken({
            id: 'tok-reset',
            purpose: 'passwordReset',
            email: 'r@example.test',
            userId: 'user-1',
          }),
        )

        expect(await countFor('client-1', 'c@example.test')).toBe(1)
        expect(await countFor('client-2', 'c@example.test')).toBe(1)
      })

      it('stops counting what can no longer be accepted: spent, revoked and expired', async () => {
        await repo.save(live('tok-spent', { email: 'a@example.test' }))
        await repo.save(live('tok-revoked', { email: 'b@example.test' }))
        await repo.save(live('tok-expired', { email: 'c@example.test', expiresAt: atPlus(500) }))
        await repo.save(live('tok-ok', { email: 'd@example.test' }))
        await repo.consume(asAccountTokenId('tok-spent'), atPlus(10))
        await repo.revokeOutstandingInvitations(
          email('b@example.test'),
          { kind: 'client', clientId: asClientId('client-1'), role: 'owner' },
          atPlus(10),
        )

        expect(await countFor('client-1', 'z@example.test')).toBe(1)
      })

      it('counts an invitation up to the last millisecond before it expires, and not at that instant', async () => {
        await repo.save(live('tok-edge', { email: 'a@example.test', expiresAt: atPlus(500) }))

        expect(await countFor('client-1', 'z@example.test', atPlus(499))).toBe(1)
        expect(await countFor('client-1', 'z@example.test', atPlus(500))).toBe(0)
      })
    })

    // ---------------------------------------------------- listAwaitingApproval --

    describe('listAwaitingApproval', () => {
      const waiting = (id: string, over: Parameters<typeof anAccountToken>[0] = {}) =>
        anAccountToken({
          id,
          purpose: 'invitation',
          email: 'nouveau@example.test',
          userId: null,
          eventId: null,
          eventRole: null,
          clientId: 'client-1',
          clientRole: 'member',
          requiresApproval: true,
          delivery: 'link',
          createdBy: 'user-1',
          ...over,
        })

      const idsFor = async (clientId: string, now = atPlus(1_000), limit = 50) =>
        (await repo.listAwaitingApproval(asClientId(clientId), now, limit)).map((t) => t.id)

      it('lists the invitations into the client that wait for an owner, newest first', async () => {
        await repo.save(waiting('tok-old', { createdAt: atPlus(100) }))
        await repo.save(waiting('tok-new', { createdAt: atPlus(500) }))

        expect(await idsFor('client-1')).toEqual(['tok-new', 'tok-old'])
      })

      it('breaks a tie on the creation instant by id, still newest first', async () => {
        await repo.save(waiting('tok-a', { createdAt: atPlus(100) }))
        await repo.save(waiting('tok-b', { createdAt: atPlus(100) }))

        expect(await idsFor('client-1')).toEqual(['tok-b', 'tok-a'])
      })

      it('never lists another client’s invitation, however it is asked', async () => {
        await repo.save(waiting('tok-mine'))
        await repo.save(waiting('tok-theirs', { clientId: 'client-2' }))

        expect(await idsFor('client-1')).toEqual(['tok-mine'])
        expect(await idsFor('client-2')).toEqual(['tok-theirs'])
      })

      it('leaves out what an owner cannot approve any more: approved, revoked or expired', async () => {
        await repo.save(waiting('tok-ok'))
        await repo.save(waiting('tok-approved'))
        await repo.save(waiting('tok-revoked', { email: 'autre@example.test' }))
        await repo.save(waiting('tok-expired', { expiresAt: atPlus(500) }))
        await repo.approve(asAccountTokenId('tok-approved'), asUserId('user-approver'), atPlus(10))
        await repo.revokeOutstandingInvitations(
          email('autre@example.test'),
          { kind: 'client', clientId: asClientId('client-1'), role: 'member' },
          atPlus(10),
        )

        expect(await idsFor('client-1')).toEqual(['tok-ok'])
      })

      it('lists an invitation up to the last millisecond before it expires, and not at that instant', async () => {
        await repo.save(waiting('tok-edge', { expiresAt: atPlus(500) }))

        expect(await idsFor('client-1', atPlus(499))).toEqual(['tok-edge'])
        expect(await idsFor('client-1', atPlus(500))).toEqual([])
      })

      it('leaves out an invitation that never needed approval, an event invitation and a reset', async () => {
        await repo.save(waiting('tok-free', { requiresApproval: false }))
        await repo.save(
          waiting('tok-event', {
            clientId: null,
            clientRole: null,
            eventId: 'event-1',
            eventRole: 'moderator',
          }),
        )
        await repo.save(
          anAccountToken({ id: 'tok-reset', purpose: 'passwordReset', requiresApproval: true }),
        )

        expect(await idsFor('client-1')).toEqual([])
      })

      it('stops at the limit, keeping the newest', async () => {
        await repo.save(waiting('tok-1', { createdAt: atPlus(100) }))
        await repo.save(waiting('tok-2', { createdAt: atPlus(200) }))
        await repo.save(waiting('tok-3', { createdAt: atPlus(300) }))

        expect(await idsFor('client-1', atPlus(1_000), 2)).toEqual(['tok-3', 'tok-2'])
      })

      it.each([0, -1, 1.5, Number.NaN])(
        'rejects a limit of %s rather than guessing',
        async (limit) => {
          await expect(
            repo.listAwaitingApproval(asClientId('client-1'), atPlus(1), limit),
          ).rejects.toThrow(RangeError)
        },
      )
    })

    // ---------------------------------------------------------------- consume --

    describe('consume', () => {
      it('spends a usable token once: true the first time, false the second', async () => {
        const token = anAccountToken({ id: 'tok-1' })
        await repo.save(token)

        expect(await repo.consume(token.id, atPlus(1_000))).toBe(true)
        expect(await repo.consume(token.id, atPlus(2_000))).toBe(false)
      })

      it('lets exactly one of several simultaneous requests win', async () => {
        const token = anAccountToken({ id: 'tok-1' })
        await repo.save(token)

        const outcomes = await Promise.all(
          Array.from({ length: 8 }, () => repo.consume(token.id, atPlus(1_000))),
        )

        expect(outcomes.filter(Boolean)).toHaveLength(1)
      })

      it('refuses an unknown token', async () => {
        expect(await repo.consume(asAccountTokenId('nobody'), AT)).toBe(false)
      })

      it('refuses a token at the instant it expires, and spends it a millisecond before', async () => {
        const late = anAccountToken({ id: 'tok-late' })
        const early = anAccountToken({ id: 'tok-early', email: 'autre@example.test' })
        await repo.save(late)
        await repo.save(early)

        expect(await repo.consume(late.id, FRESH_UNTIL)).toBe(false)
        expect(await repo.consume(early.id, new Date(FRESH_UNTIL.getTime() - 1))).toBe(true)
      })

      it('refuses a revoked token', async () => {
        const token = anAccountToken({ id: 'tok-1' })
        await repo.save(token)
        await repo.revokeOutstanding(HOST, 'passwordReset', atPlus(1_000))

        expect(await repo.consume(token.id, atPlus(2_000))).toBe(false)
      })

      it('refuses a token that needs approval and has none, and spends it once approved', async () => {
        const token = anAccountToken({ id: 'tok-1', requiresApproval: true, createdBy: 'user-1' })
        await repo.save(token)

        expect(await repo.consume(token.id, atPlus(1_000))).toBe(false)

        await repo.approve(token.id, asUserId('user-approver'), atPlus(2_000))

        expect(await repo.consume(token.id, atPlus(3_000))).toBe(true)
      })

      it('spends only the token it was given', async () => {
        const mine = anAccountToken({ id: 'tok-mine' })
        const theirs = anAccountToken({ id: 'tok-theirs', email: 'autre@example.test' })
        await repo.save(mine)
        await repo.save(theirs)

        await repo.consume(mine.id, atPlus(1_000))

        expect(
          (await repo.findUsable(theirs.tokenDigest, 'passwordReset', atPlus(2_000)))?.id,
        ).toBe(theirs.id)
      })
    })

    // ---------------------------------------------------------------- approve --

    describe('approve', () => {
      const needsApproval = () =>
        anAccountToken({ id: 'tok-1', requiresApproval: true, createdBy: 'user-1' })

      it('records who approved and when, once', async () => {
        const token = needsApproval()
        await repo.save(token)

        expect(await repo.approve(token.id, asUserId('user-approver'), atPlus(1_000))).toBe(true)
        expect(await repo.approve(token.id, asUserId('user-2'), atPlus(2_000))).toBe(false)

        const found = await repo.findUsable(token.tokenDigest, 'passwordReset', atPlus(3_000))
        expect(found?.approvedBy).toBe('user-approver')
        expect(found?.approvedAt?.toISOString()).toBe(atPlus(1_000).toISOString())
      })

      it('refuses a token that never needed approval', async () => {
        const token = anAccountToken({ id: 'tok-1' })
        await repo.save(token)

        expect(await repo.approve(token.id, asUserId('user-approver'), atPlus(1_000))).toBe(false)
      })

      it('refuses an unknown token', async () => {
        expect(await repo.approve(asAccountTokenId('nobody'), asUserId('user-approver'), AT)).toBe(
          false,
        )
      })

      it('does not spend the token: approval makes it usable and nothing more', async () => {
        const token = needsApproval()
        await repo.save(token)
        await repo.approve(token.id, asUserId('user-approver'), atPlus(1_000))

        expect(await repo.consume(token.id, atPlus(2_000))).toBe(true)
      })

      it('refuses a token that is revoked, spent or expired', async () => {
        const revoked = anAccountToken({
          id: 'tok-revoked',
          requiresApproval: true,
          createdBy: 'user-1',
        })
        const expired = anAccountToken({
          id: 'tok-expired',
          email: 'autre@example.test',
          requiresApproval: true,
          createdBy: 'user-1',
        })
        await repo.save(revoked)
        await repo.save(expired)
        await repo.revokeOutstanding(HOST, 'passwordReset', atPlus(1_000))

        expect(await repo.approve(revoked.id, asUserId('user-approver'), atPlus(2_000))).toBe(false)
        expect(await repo.approve(expired.id, asUserId('user-approver'), FRESH_UNTIL)).toBe(false)
      })
    })

    // -------------------------------------------------------- revokeOutstanding --

    describe('revokeOutstanding', () => {
      it('revokes every spendable token for the address and purpose, and counts them', async () => {
        await repo.save(anAccountToken({ id: 'tok-1' }))
        await repo.save(anAccountToken({ id: 'tok-2' }))

        expect(await repo.revokeOutstanding(HOST, 'passwordReset', atPlus(1_000))).toBe(2)
        expect(await repo.findUsable(digestOf('tok-1'), 'passwordReset', atPlus(2_000))).toBeNull()
        expect(await repo.findUsable(digestOf('tok-2'), 'passwordReset', atPlus(2_000))).toBeNull()
      })

      it('leaves another address, another purpose and a spent token exactly as they were', async () => {
        await repo.save(anAccountToken({ id: 'tok-other-address', email: 'autre@example.test' }))
        await repo.save(
          anAccountToken({
            id: 'tok-other-purpose',
            purpose: 'emailVerification',
          }),
        )
        await repo.save(anAccountToken({ id: 'tok-spent' }))
        await repo.consume(asAccountTokenId('tok-spent'), atPlus(500))

        expect(await repo.revokeOutstanding(HOST, 'passwordReset', atPlus(1_000))).toBe(0)

        expect(
          await repo.findUsable(digestOf('tok-other-address'), 'passwordReset', atPlus(2_000)),
        ).not.toBeNull()
        expect(
          await repo.findUsable(digestOf('tok-other-purpose'), 'emailVerification', atPlus(2_000)),
        ).not.toBeNull()
      })

      it('does not count a token that has already expired or been revoked', async () => {
        await repo.save(anAccountToken({ id: 'tok-1' }))
        await repo.revokeOutstanding(HOST, 'passwordReset', atPlus(1_000))

        expect(await repo.revokeOutstanding(HOST, 'passwordReset', atPlus(2_000))).toBe(0)
        expect(await repo.revokeOutstanding(HOST, 'passwordReset', FRESH_UNTIL)).toBe(0)
      })

      it('also revokes a token still waiting for approval, since approving it would make it usable', async () => {
        const token = anAccountToken({ id: 'tok-1', requiresApproval: true, createdBy: 'user-1' })
        await repo.save(token)

        expect(await repo.revokeOutstanding(HOST, 'passwordReset', atPlus(1_000))).toBe(1)
        expect(await repo.approve(token.id, asUserId('user-approver'), atPlus(2_000))).toBe(false)
      })
    })

    // ------------------------------------------- revokeOutstandingInvitations --

    describe('revokeOutstandingInvitations', () => {
      const NEWCOMER = email('nouveau@example.test')

      const invite = (id: string, over: Parameters<typeof anAccountToken>[0] = {}) =>
        anAccountToken({
          id,
          purpose: 'invitation',
          email: 'nouveau@example.test',
          userId: null,
          eventId: 'event-1',
          eventRole: 'moderator',
          delivery: 'link',
          createdBy: 'user-1',
          ...over,
        })

      const toClient = { eventId: null, eventRole: null } as const

      const event = (id: string) => ({
        kind: 'event' as const,
        eventId: asEventId(id),
        role: 'moderator' as const,
      })
      const client = (id: string, role: 'owner' | 'member' = 'owner') => ({
        kind: 'client' as const,
        clientId: asClientId(id),
        role,
      })

      const stillWorks = async (id: string): Promise<boolean> =>
        (await repo.findUsable(digestOf(id), 'invitation', atPlus(2_000))) !== null

      it("revokes the address's outstanding invitations to that event, and counts them", async () => {
        await repo.save(invite('tok-1'))
        await repo.save(invite('tok-2'))

        expect(
          await repo.revokeOutstandingInvitations(NEWCOMER, event('event-1'), atPlus(1_000)),
        ).toBe(2)
        expect(await stillWorks('tok-1')).toBe(false)
        expect(await stillWorks('tok-2')).toBe(false)
      })

      it('revokes by client too, and an owner invitation supersedes a member one', async () => {
        await repo.save(
          invite('tok-member', { ...toClient, clientId: 'client-1', clientRole: 'member' }),
        )

        expect(
          await repo.revokeOutstandingInvitations(
            NEWCOMER,
            client('client-1', 'owner'),
            atPlus(1_000),
          ),
        ).toBe(1)
        expect(await stillWorks('tok-member')).toBe(false)
      })

      it('leaves another event, another client, another address and a reset exactly as they were', async () => {
        await repo.save(invite('tok-other-event', { eventId: 'event-2' }))
        await repo.save(
          invite('tok-other-client', { ...toClient, clientId: 'client-2', clientRole: 'owner' }),
        )
        await repo.save(invite('tok-other-address', { email: 'autre@example.test' }))
        await repo.save(
          anAccountToken({ id: 'tok-reset', email: 'nouveau@example.test', userId: 'user-1' }),
        )

        expect(
          await repo.revokeOutstandingInvitations(NEWCOMER, event('event-1'), atPlus(1_000)),
        ).toBe(0)
        expect(
          await repo.revokeOutstandingInvitations(NEWCOMER, client('client-1'), atPlus(1_000)),
        ).toBe(0)
        expect(await stillWorks('tok-other-event')).toBe(true)
        expect(await stillWorks('tok-other-client')).toBe(true)
        expect(await stillWorks('tok-other-address')).toBe(true)
        expect(
          await repo.findUsable(digestOf('tok-reset'), 'passwordReset', atPlus(2_000)),
        ).not.toBeNull()
      })

      it('leaves a token of another purpose alone even when a row gave it the same place', async () => {
        // Not reachable through the domain, which keeps a place off a reset; the statement
        // must not rely on that to stay inside invitations.
        const reset = {
          ...anAccountToken({ id: 'tok-reset', email: 'nouveau@example.test', userId: 'user-1' }),
          eventId: asEventId('event-1'),
          eventRole: 'moderator' as const,
        }
        await repo.save(reset)

        expect(
          await repo.revokeOutstandingInvitations(NEWCOMER, event('event-1'), atPlus(1_000)),
        ).toBe(0)
        expect(
          await repo.findUsable(digestOf('tok-reset'), 'passwordReset', atPlus(2_000)),
        ).not.toBeNull()
      })

      it('counts only what is still live: not a link that is spent, already revoked or expired', async () => {
        // One of each dead kind and one live link, all to the same address and event. The
        // first call must revoke exactly the live one: a statement that forgot to ask whether
        // a link was spent, or had expired, would count it too and stamp it revoked.
        await repo.save(invite('tok-revoked'))
        await repo.revokeOutstandingInvitations(NEWCOMER, event('event-1'), atPlus(100))
        await repo.save(invite('tok-spent', { createdAt: atPlus(200) }))
        await repo.consume(asAccountTokenId('tok-spent'), atPlus(500))
        await repo.save(invite('tok-expired', { createdAt: atPlus(200), expiresAt: atPlus(900) }))
        await repo.save(invite('tok-live', { createdAt: atPlus(200) }))

        const revoked = await repo.revokeOutstandingInvitations(
          NEWCOMER,
          event('event-1'),
          atPlus(1_000),
        )

        expect(revoked).toBe(1)
        expect(
          await repo.revokeOutstandingInvitations(NEWCOMER, event('event-1'), atPlus(1_100)),
        ).toBe(0)
      })

      it('does not count a link that expired by the time it was asked', async () => {
        await repo.save(invite('tok-1'))
        const week = 7 * 24 * 60 * 60 * 1000

        expect(
          await repo.revokeOutstandingInvitations(NEWCOMER, event('event-1'), atPlus(week)),
        ).toBe(0)
      })

      it('also revokes an invitation still waiting for approval, which an approval would make live', async () => {
        const token = invite('tok-1', { requiresApproval: true })
        await repo.save(token)

        expect(
          await repo.revokeOutstandingInvitations(NEWCOMER, event('event-1'), atPlus(1_000)),
        ).toBe(1)
        expect(await repo.approve(token.id, asUserId('user-approver'), atPlus(2_000))).toBe(false)
      })
    })

    // ------------------------------------------------------- countCreatedSince --

    describe('countCreatedSince', () => {
      it('counts what was issued after the instant, exclusive, for that address and purpose', async () => {
        await repo.save(anAccountToken({ id: 'tok-old', createdAt: atPlus(0) }))
        await repo.save(anAccountToken({ id: 'tok-edge', createdAt: atPlus(1_000) }))
        await repo.save(anAccountToken({ id: 'tok-new', createdAt: atPlus(2_000) }))

        expect(await repo.countCreatedSince(HOST, 'passwordReset', atPlus(1_000))).toBe(1)
        expect(await repo.countCreatedSince(HOST, 'passwordReset', atPlus(999))).toBe(2)
      })

      it('still counts a token that was spent or revoked: the mail went out either way', async () => {
        await repo.save(anAccountToken({ id: 'tok-spent' }))
        await repo.save(anAccountToken({ id: 'tok-revoked', createdAt: atPlus(10) }))
        await repo.consume(asAccountTokenId('tok-spent'), atPlus(100))
        await repo.revokeOutstanding(HOST, 'passwordReset', atPlus(200))

        expect(await repo.countCreatedSince(HOST, 'passwordReset', atPlus(-1))).toBe(2)
      })

      it('counts nothing for another address or another purpose', async () => {
        await repo.save(anAccountToken({ id: 'tok-1' }))

        expect(await repo.countCreatedSince(OTHER, 'passwordReset', atPlus(-1))).toBe(0)
        expect(await repo.countCreatedSince(HOST, 'invitation', atPlus(-1))).toBe(0)
      })
    })

    // ----------------------------------------------------------- deleteExpired --

    describe('deleteExpired', () => {
      it('deletes what expired before the instant, exclusive, and says how many', async () => {
        await repo.save(anAccountToken({ id: 'tok-dead' }))
        await repo.save(anAccountToken({ id: 'tok-edge', email: 'autre@example.test' }))
        await repo.save(
          anAccountToken({
            id: 'tok-live',
            email: 'autre@example.test',
            createdAt: atPlus(10 * 60 * 1000),
          }),
        )
        // `tok-dead` and `tok-edge` both expire at FRESH_UNTIL; `tok-live` an hour after it
        // was issued ten minutes later.

        expect(await repo.deleteExpired(FRESH_UNTIL)).toBe(0)
        expect(await repo.deleteExpired(new Date(FRESH_UNTIL.getTime() + 1))).toBe(2)
        expect(
          (await repo.findUsable(digestOf('tok-live'), 'passwordReset', FRESH_UNTIL))?.id,
        ).toBe(asAccountTokenId('tok-live'))
      })

      it('deletes a spent or revoked token once it has expired, and keeps it until then', async () => {
        await repo.save(anAccountToken({ id: 'tok-spent' }))
        await repo.consume(asAccountTokenId('tok-spent'), atPlus(100))

        expect(await repo.deleteExpired(atPlus(1_000))).toBe(0)
        expect(await repo.deleteExpired(new Date(FRESH_UNTIL.getTime() + 1))).toBe(1)
      })

      it('lets the digest be issued again once its row is gone', async () => {
        await repo.save(anAccountToken({ id: 'tok-1' }))
        await repo.deleteExpired(new Date(FRESH_UNTIL.getTime() + 1))

        await expect(repo.save(anAccountToken({ id: 'tok-1' }))).resolves.toBeUndefined()
      })
    })
  })
}
