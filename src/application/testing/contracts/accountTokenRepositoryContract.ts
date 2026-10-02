import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asAccountTokenId, asUserId } from '../../../domain/shared/ids'
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
 * The accounts and the event named here must exist before the suite runs — `user_id`,
 * `created_by`, `approved_by` and `event_id` are foreign keys in the real table, and the fake
 * mirrors them. Both subjects seed {@link CONTRACT_ACCOUNTS} and {@link CONTRACT_EVENTS}.
 */

export const CONTRACT_ACCOUNTS = ['user-1', 'user-2', 'user-approver'] as const
export const CONTRACT_EVENTS = ['event-1'] as const

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
